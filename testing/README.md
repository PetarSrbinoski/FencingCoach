# Isolated nutrition smoke test

From the repository root, run `bash testing/scripts/run_e2e.sh`. Prerequisites:
Docker with Compose, `uv`, Node 20+, and the pinned frontend dependencies from
`npm ci` in `frontend/`. Install the matching Chromium once with
`cd frontend && npx playwright install chromium`.

The wrapper creates a uniquely named Compose project with PostgreSQL 16,
applies Alembic migrations to its empty database, starts the test backend and
real frontend, waits for both, and runs an API/database smoke check and a
Chromium nutrition-page smoke check. It tears down only its own project and
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
uv run --frozen pytest -c pytest.project.ini --collect-only -q
uv run pytest  # unchanged repository regression suite
```

The first command collects only `testing/` and imports no legacy fixtures or
cases. At source revision `b981e64a3712cb415eaf176d3cfa53c7765fe2fc`,
this independent suite had zero tests; the repository already had its own
tests in `backend/tests/`. The smoke runner saves collection and test output
locally under ignored `testing/.artifacts/`, plus a compact JSON evidence file
in `docs/testing/evidence/`. A failed browser run keeps a trace, screenshot,
HTML report, and Compose logs in the local artifact directory.
