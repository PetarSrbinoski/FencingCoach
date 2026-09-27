# Tests

Tests first added September 25–26, 2026 live here. Older backend tests remain in
`backend/tests/`, including files that were edited more recently.

- `backend/`: generation lifecycle, saved foods, and opt-in live LLM evaluations.
  Run `uv run pytest testing/backend` from the repository root. The default
  `uv run pytest` includes these and the older backend tests.
- `frontend/`: job observer unit tests. Run `npm test --prefix frontend` after
  installing the frontend dependencies.
- `frontend/e2e/`: browser tests, using the frontend's Playwright dependencies
  and config. Run the isolated stack with `bash testing/scripts/run_e2e.sh`.
- `baseline/`, `properties/`, `regression/`, `integration/`: independent project
  tests selected by `pytest.project.ini`. These run separately from the backend
  tests, which use SQLite fixtures.

To run live LLM evaluations against the configured provider:

```bash
RUN_LIVE_LLM_EVALS=1 uv run pytest testing/backend/test_live_llm_responses.py -q -s
```
