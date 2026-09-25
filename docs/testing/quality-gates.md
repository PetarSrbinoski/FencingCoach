# Quality-gate record — 25 September 2026

All commands below were run locally on `skitTesting`. Project measurements use
their own selectors and are not conflated with the repository suite.

| Command | Observed result |
| --- | --- |
| `bash testing/scripts/run_backend_tests.sh baseline` | 24 passed; JUnit, coverage JSON/XML/HTML, and 43/60 scoped branches retained. |
| `bash testing/scripts/run_backend_tests.sh expanded` | 37 passed; JUnit, coverage JSON/XML/HTML, and 53/60 scoped branches retained. |
| `cd testing && uv run --project .. --frozen pytest -c ../pytest.project.ini --collect-only -q` | 45 project cases collected across baseline, properties, integration and regression; no legacy cases. |
| `bash testing/scripts/run_e2e.sh` | Five API/database and four Chromium tests passed; zero retries/flaky cases. An earlier red browser run for UI-01 is retained separately. |
| `bash testing/scripts/run_mutation_stage.sh A/B/C` | All three completed within 300 seconds; 466 identical IDs and source hash; 248/265/287 killed respectively. |
| `timeout 150 uv run --frozen pytest -q` | Repository suite: **248 passed**, four deprecation warnings, 3.52 seconds; exit 0. This is a separate legacy regression check. |
| `uv run --frozen ruff check backend/app backend/tests llm testing` | Passed after sorting one new regression-test import block. |
| `uv run --frozen mypy backend/app backend/tests llm testing` | Passed: 111 source files checked. |
| `npx tsc --noEmit` in `frontend` | Passed. |
| `npm run build` in `frontend` | Passed; all nine static routes built. The isolated Docker frontend also built successfully. |
| `CI=1 timeout 30 npm run lint` in `frontend` | Exit 1: Next.js launched interactive ESLint setup because no ESLint config exists. This is not a lint pass. No config/dependency was added merely to suppress the prompt. |
| `uv run --frozen python testing/scripts/render_report.py` | Produced a three-page PDF. PyMuPDF confirmed no text blocks outside any page; all 17 file links target existing local evidence. Every page was visually inspected via rendered contact sheet. |

The initial attempt at the ordinary repository pytest suite during issue 01
stalled near an asynchronous chat test, but the final bounded run above passed
all 248 cases. This replaces that earlier uncertain result rather than
retroactively describing it as a pass. No live model, Garmin provider, or
medical correctness gate was run.
