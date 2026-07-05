"""Daily-brief output-format prompt — the user-turn prompt sent to
`app.agents.brief`'s agent (which uses `llm.prompts.coach.COACH_SYSTEM_PROMPT`
as its base instructions)."""

from llm.prompts.common import THINKING_OFF

DAILY_BRIEF_PROMPT = (
    THINKING_OFF
    + """Generate today's daily brief for the athlete. Format as:

READINESS: <green|amber|red> — one-sentence rationale grounded in HRV / sleep / Body Battery / recent load.
TODAY: bullet list — training plan (gym or fencing or rest), key targets, timing.
NUTRITION: kcal target, protein/carbs/fat targets, two example meal slots tied to today's training.
RECOVERY: 1–2 specific actions (sleep window, pre-bed routine, mobility, etc.).
WATCH: 1 thing to monitor today (e.g. RPE in last gym set, late-fencing leg fatigue).

Keep it under 180 words. Be specific. Use the data, not platitudes."""
)
