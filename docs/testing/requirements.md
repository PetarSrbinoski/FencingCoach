# Requirement ledger

This ledger separates planned behavior from what source inspection suggests and
from what a test has actually shown. Existing `backend/tests/` are prior repository tests,
not evidence for the independent project baseline.

| ID | Requirement from plan | Project evidence at issue 01 |
| --- | --- | --- |
| SCH-01 | Seven recognized weekly day types | Pending issue 02 |
| SCH-02 | Normalize case/space and preserve weekday order | Pending issue 02 |
| DAY-01 | Manual day type precedes automatic selection | Pending issue 09 |
| DAY-02 | Replacing/clearing affects only the selected day | Pending issue 09 |
| NUT-01 | Calories and macros agree within rounding tolerance | Pending issue 04 |
| NUT-02 | Maintenance needs enough usable history | Pending issue 04 |
| NUT-03 | Maintenance uses the preceding 14 days | Pending issue 04 |
| NUT-04 | Profile, phase, and day type affect targets | Pending issue 04 |
| GAR-01 | Distinguish missing, invalid, and valid readings | Pending issue 03 |
| GAR-02 | Scalar plausibility bounds are inclusive | Pending issue 03 |
| GAR-03 | Supported fallback paths preserve meaning | Pending issue 03 |
| API-01 | Day-type overrides persist and replace per date | Pending issue 09 |
| API-02 | Workout override replaces and clears | Pending issue 12 |
| API-03 | Estimate creates a job without saving a meal | Isolated API/database smoke in issue 01; fuller cases pending issue 10 |
| API-04 | Reviewed values save, total, and delete correctly | Pending issue 10 |
| API-05 | Estimate failures terminate and unknown IDs return 404 | Pending issue 11 |

Issue 01 also establishes infrastructure requirements: a disposable migrated
PostgreSQL 16 database, controlled external boundaries, a real nutrition page
in Chromium, and isolated collection. The API smoke checks database health,
today's targets, synthetic estimate completion, its persisted job row, and no
nutrition log. The browser smoke checks that real targets load and a controlled
estimate reaches review. A passing run is recorded in `evidence/` only after
execution; writing a test is not execution evidence. The first successful run
is [20260925T091801Z-38984.json](evidence/20260925T091801Z-38984.json): one
API/database test and one Chromium test passed, with zero legacy tests collected.

## Observed implementation behavior, not yet a confirmed requirement

- The nutrition endpoint creates a pending row and runs estimation through a
  background task; meal logging is a separate endpoint.
- Directly imported `athlete_today` bindings occur in API and service modules,
  so the isolated launcher fixes those bindings at their consuming sites.
- The current settings class normally reads `.env`; the test image omits that
  file and the launcher rejects one if present.

## Open behavior questions

- How should a `maintain` body-composition goal map to target calculations?
- What day type should a rest day with both strength and fencing activity use?
- Which Garmin numeric strings, booleans, and malformed payloads are supported?

These questions remain open for the later behavior tickets. Issue 01 does not
change production behavior to resolve them.
