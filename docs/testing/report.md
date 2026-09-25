# Систематско тестирање на FencingCoach со примена на тестирање базирано на својства, мутациско тестирање и тестирање од крај до крај

**Project status:** in progress. Student index number(s): pending. Final source
and test revision links: pending. Planned submission: 28 September 2026,
23:59 Europe/Skopje.

## Application and experiment scope

FencingCoach is a single-user Next.js and FastAPI application backed by
PostgreSQL. This project establishes an independently developed testing suite
at `testing/` and `frontend/e2e/`. At the starting source revision
`b981e64a3712cb415eaf176d3cfa53c7765fe2fc`, the project suite had zero
tests; the repository already had tests in `backend/tests/`. Those legacy tests
remain a separate regression suite and are excluded from project measurements.

Issue 01 builds the disposable environment and nutrition-page smoke checks.
The backend and frontend are real. The test backend substitutes nutrition
estimation and USDA enrichment, fixes the athlete date, and has no access to
personal credentials or scheduled workers. The smoke checks do not measure
model accuracy, Garmin sync, nutrition advice quality, or mutation detection.

## Requirements and test design

See [requirements.md](requirements.md). Partitions, boundaries, worked
examples, and generated properties: pending later tickets.

## Environment and reproducibility

See [testing/README.md](../../testing/README.md). The runner builds a uniquely
named Compose project, migrates an empty PostgreSQL 16 database, runs one
API/database test and one Chromium smoke test, and removes its own containers
and volume. Run-specific settings, versions, collection, duration, and results
are recorded under `evidence/` after execution.

## Measurements

| Stage | Cases | Branch coverage | Mutation results | Runtime | Findings |
| --- | --- | --- | --- | --- | --- |
| A: example baseline | Pending | Pending | Pending | Pending | Pending |
| B: plus properties | Pending | Pending | Pending | Pending | Pending |
| C: plus regressions | Pending | Pending | Pending | Pending | Pending |

API and browser smoke results are reported in the run evidence, separate from
the later mutation comparison. No score or improvement is claimed in advance.

The isolated issue 01 smoke run on 25 September 2026 passed one API/database
test and one Chromium test. Project collection contained one test and no legacy
tests. It took 60 seconds including cached image builds and stack teardown.
See the [run evidence](evidence/20260925T091801Z-38984.json). The migration-only
regression check also passed on a fresh PostgreSQL database after the fix
described in [defects.md](defects.md).

## Defects, limitations, and references

Confirmed defects and counterexamples: pending. Mutation survivor analysis:
pending. Browser workflow evidence beyond connectivity: pending issues 09–11.
The source, tests, tools, supplied course material, contributions, and final
demonstration script will be linked and described in the final report.

The repository regression suite remained separately collected (248 tests).
Its full run was interrupted after no progress near
`backend/tests/test_chat_api.py::test_chat_accepted_then_poll_returns_reply`;
that single test also exceeded a 40-second bound when run alone. Therefore no
full-suite pass or failure count is claimed for the repository suite. Project
smoke results above are from the isolated PostgreSQL stack.
