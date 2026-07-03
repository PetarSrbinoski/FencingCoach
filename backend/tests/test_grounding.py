"""Tests for the heuristic coach-reply grounding check."""

from __future__ import annotations

from app.services.grounding import find_ungrounded_claims


def test_no_context_means_nothing_flagged():
    reply = "Your HRV was 42 last night."
    assert find_ungrounded_claims(reply, "") == []


def test_grounded_number_not_flagged():
    context = "## Readiness\nHRV: 55ms, Sleep: 7.2h"
    reply = "Your HRV was 55 last night, which is solid."
    assert find_ungrounded_claims(reply, context) == []


def test_fabricated_number_is_flagged():
    context = "## Readiness\nHRV: 55ms, Sleep: 7.2h"
    reply = "Your HRV was 82 last night, well above baseline."
    flagged = find_ungrounded_claims(reply, context)
    assert len(flagged) == 1
    assert "82" in flagged[0]


def test_prescriptive_numbers_not_flagged():
    """Sets/reps/%1RM are the coach's own output, not data claims."""
    context = "## Readiness\nHRV: 55ms"
    reply = "Do 3 sets of 8 reps at 75% of your 1RM today."
    assert find_ungrounded_claims(reply, context) == []


def test_multiple_sentences_only_flags_the_bad_one():
    context = "## Readiness\nHRV: 55ms, Sleep: 7.2h"
    reply = (
        "Your sleep was 7.2 hours, right on target. "
        "Do 3 sets of 8 reps today. "
        "Your resting heart rate was 38 this morning."
    )
    flagged = find_ungrounded_claims(reply, context)
    assert len(flagged) == 1
    assert "38" in flagged[0]


def test_kcal_claim_checked_against_context():
    context = "Targets: 3200 kcal, 200g protein"
    reply = "You're targeting 3200 kcal today based on your recent expenditure."
    assert find_ungrounded_claims(reply, context) == []

    reply_wrong = "You're targeting 4000 kcal today based on your recent expenditure."
    flagged = find_ungrounded_claims(reply_wrong, context)
    assert len(flagged) == 1


def test_empty_reply_returns_empty():
    assert find_ungrounded_claims("", "some context") == []
