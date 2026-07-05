"""Heuristic grounding check for coach replies — flags sentences that cite
a data metric (HRV, sleep, RHR, etc.) alongside a number not present in the
context snapshot. Best-effort substring match, not a general fact-checker;
treat its output as a "double-check this" signal, not a hard block.
"""

from __future__ import annotations

import re

# Metric keywords whose adjacent numeric claims should be traceable to the
# context snapshot. Deliberately does not include generic training-Rx terms
# (sets, reps, RPE, %1RM) since those are the coach's own output.
GROUNDING_KEYWORDS: tuple[str, ...] = (
    "hrv",
    "sleep",
    "resting heart rate",
    "resting hr",
    "rhr",
    "body battery",
    "readiness",
    "vo2",
    "training load",
    "kcal",
    "calorie",
    "weight",
)

_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def find_ungrounded_claims(reply: str, context: str) -> list[str]:
    """Return sentences from `reply` that cite a metric with a number not
    present anywhere in `context`. Empty list if context wasn't provided
    (nothing to check against) or nothing looks ungrounded.
    """
    if not context or not reply:
        return []

    context_numbers = set(_NUMBER_RE.findall(context))
    flagged: list[str] = []
    for sentence in _SENTENCE_RE.split(reply):
        low = sentence.lower()
        if not any(kw in low for kw in GROUNDING_KEYWORDS):
            continue
        numbers = _NUMBER_RE.findall(sentence)
        if any(n not in context_numbers for n in numbers):
            flagged.append(sentence.strip())
    return flagged
