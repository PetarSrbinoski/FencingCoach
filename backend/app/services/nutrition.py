"""Nutrition estimation.

Takes free-text food entries ("200g chicken breast with 1 cup of rice and
broccoli") and estimates macros + key micros via the LLM. Returns a
structured object that the API layer persists to `nutrition_log`.

Strategy:
- Use a strict JSON-mode prompt. Many OpenAI-compatible servers honor
  `response_format={"type": "json_object"}` (OpenAI, vLLM, Ollama recent),
  but some don't. We always parse defensively and fall back to extracting
  the first JSON object substring.
- The LLM is instructed to be a registered sports dietitian, give point
  estimates, and never refuse — if the input is too vague it returns its
  best guess and a `confidence` field.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.services.llm import get_llm

log = logging.getLogger(__name__)


NUTRITION_SYSTEM_PROMPT = (
    "detailed thinking off\n\n"
    + """You are a precise sports-nutrition macro estimator for an
elite épée fencer. Given a free-text food description, output a single JSON object —
no prose, no markdown — with this exact schema:

{
  "kcal": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fiber_g": number,
  "micros": {
    "iron_mg": number,
    "vitamin_d_iu": number,
    "b12_mcg": number,
    "magnesium_mg": number,
    "zinc_mg": number,
    "omega3_g": number
  },
  "items": [{"name": string, "qty_g": number}],
  "confidence": "low" | "medium" | "high",
  "notes": string
}

Rules:
- Use USDA reference values. Round kcal to nearest 5, macros to 0.5 g, micros to 1 unit.
- If a quantity is missing, assume an athlete-sized portion (e.g. 200 g protein source,
  150 g cooked rice, 1 medium fruit) and note the assumption in `notes`.
- Never refuse. Always produce numbers; lower `confidence` if uncertain.
- USE WEB SEARCH TOOL TO IMPROVE ESTIMATES!
- Do not include preamble or trailing text. JSON object only."""
)


@dataclass
class NutritionEstimate:
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None
    micros: dict[str, float]
    items: list[dict[str, Any]]
    confidence: str
    notes: str
    raw: dict[str, Any]


def _extract_json(s: str) -> dict[str, Any]:
    """Parse JSON; on failure, find the first {...} block."""
    s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON object found in LLM output: {s[:200]}")
    return json.loads(m.group(0))


def estimate(text: str) -> NutritionEstimate:
    if not text.strip():
        raise ValueError("empty food description")

    llm = get_llm()
    messages = [
        {"role": "system", "content": NUTRITION_SYSTEM_PROMPT},
        {"role": "user", "content": text.strip()},
    ]
    # Some providers ignore response_format silently — that's fine.
    try:
        resp = llm.chat(messages, temperature=0.1)
    except Exception as e:  # noqa: BLE001
        log.error("LLM call failed for nutrition estimate: %s", e)
        raise

    try:
        data = _extract_json(resp.content)
    except Exception as e:  # noqa: BLE001
        log.warning(
            "Bad nutrition JSON from LLM (%s); content=%r", e, resp.content[:300]
        )
        # Best-effort minimal fallback
        data = {
            "kcal": 0,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 0,
            "fiber_g": 0,
            "micros": {},
            "items": [],
            "confidence": "low",
            "notes": f"parse-failed: {e}",
        }

    micros = data.get("micros") or {}
    return NutritionEstimate(
        kcal=float(data.get("kcal") or 0),
        protein_g=float(data.get("protein_g") or 0),
        carbs_g=float(data.get("carbs_g") or 0),
        fat_g=float(data.get("fat_g") or 0),
        fiber_g=float(data.get("fiber_g")) if data.get("fiber_g") is not None else None,
        micros={k: float(v) for k, v in micros.items() if isinstance(v, (int, float))},
        items=data.get("items") or [],
        confidence=str(data.get("confidence") or "medium"),
        notes=str(data.get("notes") or ""),
        raw=data,
    )
