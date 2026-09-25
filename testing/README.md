# Independent FencingCoach testing project

From the repository root, run `bash testing/scripts/run_e2e.sh`. Prerequisites:
Docker with Compose, `uv`, Node 20+, and the pinned frontend dependencies from
`npm ci` in `frontend/`. Install the matching Chromium once with
`cd frontend && npx playwright install chromium`.

The wrapper creates a uniquely named Compose project with PostgreSQL 16,
applies Alembic migrations to its empty database, starts the test backend and
real frontend, waits for both, and runs the API/database and Chromium
nutrition workflows. It tears down only its own project and
volume at exit. Ports default to backend 18000, frontend 13000, and database
15432; set `TEST_BACKEND_PORT`, `TEST_FRONTEND_PORT`, or `TEST_DB_PORT` to use
other loopback ports. The script fixes the athlete day to the current UTC date
for that run and fixes the browser clock to noon UTC on that date.

The test backend reads only variables declared in `compose.testing.yml`; it
contains no private `.env` file or Garmin, summary, or brief worker. Nutrition
estimation uses a synthetic result, or a controlled error for text beginning
with `FAIL:`. USDA enrichment is stubbed. The real endpoints, background job,
PostgreSQL persistence, and frontend remain active. This checks application
orchestration, not live model or external-provider quality.

Project collection is separate from the repository suite:

```bash
(cd testing && uv run --project .. --frozen pytest -c ../pytest.project.ini --collect-only -q)
uv run pytest  # unchanged repository regression suite
```

The first command collects only `testing/` and imports no legacy fixtures or
cases. At source revision `b981e64a3712cb415eaf176d3cfa53c7765fe2fc`,
this independent suite had zero tests; the repository already had its own
tests in `backend/tests/`. The workflow runner saves collection and test output
locally under ignored `testing/.artifacts/`, plus a compact JSON evidence file
in `docs/testing/evidence/`. A failed browser run keeps a trace, screenshot,
HTML report, and Compose logs in the local artifact directory.
Backend stage runners retain JUnit, coverage JSON, branch-coverage XML and
browser-readable coverage HTML beside their compact evidence record.

## Completed project stages

From the repo root, `uv sync --frozen` prepares Python tools. Run `npm ci` and
`npx playwright install chromium` once in `frontend/`. Docker Compose is
required for migrated-DB and browser checks. These wrappers create and remove
their own disposable PostgreSQL 16 database:

```bash
bash testing/scripts/run_backend_tests.sh baseline
bash testing/scripts/run_backend_tests.sh expanded
bash testing/scripts/run_e2e.sh
```

`baseline` selects only `testing/baseline/` (24 pytest cases). `expanded`
selects those frozen files plus `testing/properties/` (37 pytest cases): four
schedule, six Garmin and three nutrition property functions. Their repeatable
settings use 100 generated examples for each pure property and 20/15/15 for
DB properties, a configured maximum of 1,050 examples distinct from pytest case
count. Each generated DB example resets committed rows inside its own body.
No generated failure was found in the reported run. For wider exploration,
increase the per-test `max_examples` and retain that run separately; a
Hypothesis seed can replay a discovered failure.

The e2e wrapper now runs five API/database cases and four Chromium cases. It
uses the same synthetic estimate and controlled `FAIL:` exception as the
original smoke, plus fresh database state and browser context per workflow.
It archives API JUnit and Playwright JSON under `docs/testing/evidence/`, with
traces/screenshots in local artifacts on failure. Retries are zero.

Mutation stages use a deliberately narrower schedule/Garmin pure selection:

```bash
bash testing/scripts/run_mutation_stage.sh A
bash testing/scripts/run_mutation_stage.sh B
bash testing/scripts/run_mutation_stage.sh C
```

Each fresh workspace copies the same two allowlisted source files and support
package, then mutmut 3.8.0 runs with two workers and a 300-second limit. A
uses their frozen examples, B adds their properties, and C adds the GAR-01/03
regressions. Nutrition-target, API/browser, and legacy tests are outside the
mutation score. Stage evidence contains the config, all mutant IDs and raw
outcomes, generated source archive, tool version, log, and runtime. Run stages
sequentially so durations remain comparable.

Repository checks remain separate from project measurements:

```bash
uv run pytest
uv run ruff check backend/app backend/tests llm testing
uv run mypy backend/app backend/tests llm testing
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

The original Next.js `npm run lint` task asks for interactive ESLint setup
because this repository has no ESLint configuration. The repository pytest
suite is separate from project measurements; its final bounded run passed
248 cases. See [quality-gate evidence](../docs/testing/quality-gates.md).
