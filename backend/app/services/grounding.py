"""Heuristic grounding check for coach replies.

The coach is instructed (see `services.prompts.COACH_SYSTEM_PROMPT`, rule 8)
to never fabricate a number when citing the athlete's own data (HRV, sleep,
RHR, Body Battery, readiness, VO2max, training load, weight, kcal/macros).
This module provides a lightweight, best-effort check: it flags sentences
that reference one of those metrics alongside a number that doesn't appear
anywhere in the context snapshot the model was given.

This is intentionally narrow and heuristic, not a general fact-checker:
- It only looks at sentences containing a recognized metric keyword, so it
  does not (and should not) flag the coach's own prescriptive numbers
  (sets/reps/%1RM/target macros) — those are legitimate recommendations,
  not claims about existing data.
- It's a plain substring/number match, so it can both miss real
  fabrications (if the number happens to coincidentally appear elsewhere
  in context) and produce false positives (e.g. a rounded or re-derived
  number). Treat its output as a "double-check this" signal for the UI/
  logs, not a hard block.
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
