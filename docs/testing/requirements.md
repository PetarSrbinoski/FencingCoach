# Requirement ledger

This ledger separates planned behavior from what source inspection suggests and
from what a test has actually shown. Existing `backend/tests/` are prior repository tests,
not evidence for the independent project baseline.

| ID | Requirement from plan | Project evidence |
| --- | --- | --- |
| SCH-01 | Seven recognized weekly day types | `testing/baseline/test_schedule.py`; generated schedule properties |
| SCH-02 | Normalize case/space and preserve weekday order | Schedule baseline and properties |
| DAY-01 | Manual day type precedes automatic selection | Target baseline and API/browser day-type workflow |
| DAY-02 | Replacing/clearing affects only selected day | Target property and API/browser day-type workflow |
| NUT-01 | Calories and macros agree within rounding tolerance | Target baseline and weight/type property |
| NUT-02 | Maintenance needs enough usable history | Target 4/5-day baseline |
| NUT-03 | Maintenance uses preceding 14 days | Target window baseline and history property |
| NUT-04 | Profile, phase, and day type affect targets | Target baseline and generated weight/type property |
| GAR-01 | Distinguish missing, invalid, valid readings | Garmin baseline/properties and retained-payload regression |
| GAR-02 | Scalar plausibility bounds are inclusive | Garmin baseline and bounded properties |
| GAR-03 | Supported fallback paths preserve meaning | Garmin baseline/properties and sleep/body-battery regressions |
| API-01 | Day-type overrides persist and replace per date | `testing/integration/test_workflows_api.py` and Chromium day-type flow |
| API-02 | Workout override replaces and clears | Workout API integration test |
| API-03 | Estimate creates a job without saving a meal | Smoke plus reviewed-meal API/browser checks |
| API-04 | Reviewed values save, total, delete correctly | Reviewed-meal API/browser checks |
| API-05 | Estimate failures terminate and unknown IDs return 404 | Failure/recovery API/browser checks |

Issue 01 also establishes infrastructure requirements: a disposable migrated
PostgreSQL 16 database, controlled external boundaries, a real nutrition page
in Chromium, and isolated collection. The API smoke checks database health,
today's targets, synthetic estimate completion, its persisted job row, and no
nutrition log. The browser smoke checks that real targets load and a controlled
estimate reaches review. A passing run is recorded in `evidence/` only after
execution; writing a test is not execution evidence. The first successful run
is [20260925T093139Z-43024.json](evidence/20260925T093139Z-43024.json): one
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

## Contracts selected before baseline assertions (issues 02–04)

| ID | Testable rule | Basis and boundary |
| --- | --- | --- |
| SCH-01 | Exactly seven comma-separated entries, each from rest/gym/fencing/double/competition; empty and unknown entries fail. | Existing configuration contract; lengths 0, 6, 7, 8. |
| SCH-02 | Index 0 is Monday and 6 Sunday; valid case and surrounding whitespace normalize without reordering. | Public schedule lookup/description contract. |
| GAR-01 | Absent/null/nonnumeric scalar candidates yield `missing`; numeric candidates within plausible bounds yield `ok`; outside yield `implausible`. | Extractor status/value contract; numeric-string and boolean acceptance remain observed behavior rather than prescribed policy. |
| GAR-02 | Published scalar bounds are inclusive; zero is allowed for some kinds, but not HRV. Payload-only metrics can be `ok` without a scalar. | Boundaries from `PLAUSIBLE_RANGES`; status and intensity payloads are structurally distinct. |
| GAR-03 | A secondary path is used when the preferred candidate is absent; when the preferred candidate is present, its result wins, even if invalid. | Current precedence contract to characterize; whether invalid preferred data should fall through remains an open policy question. |
| NUT-01 | Returned kcal agrees with 4/4/9 macros within 0.5 kcal plus 0.05 floating-point allowance from one-decimal macro rounding. | Nutrition target output contract. |
| NUT-02 | At least five usable `ok` calorie days select measured maintenance; four or fewer use the formula. | Current service rule, tested with inputs where target energy is above macro floor. |
| NUT-03 | The preceding fourteen days include day −14, exclude day −15 and today; missing values and non-`ok` rows do not count. | Current rolling-window rule. |
| NUT-04 | Valid profile weights, competition phases and day types influence targets; absent profile falls back to 89 kg. | Public service behavior. |
| DAY-01/02 | A manual day type wins for its date; unrelated dates keep automatic selection. | Existing override precedence. Mixed strength and fencing on a rest day remains unspecified. |

Input design: schedule partitions are valid/invalid token, accepted/rejected
length, normalized/raw spelling, and first/last weekday. A compact control-flow
example is: seven tokens → validate each → map in order → look up Monday and
Sunday; its invalid-token sibling exits before mapping. This demonstrates those
edges only; branch coverage is not edge-pair or all-definition-use-path coverage.
Garmin partitions are absent/null/nonnumeric/in-range/out-of-range, preferred
present/absent, and scalar/payload-only; endpoints and immediately adjacent
values are selected. Nutrition partitions are profile present/absent, measured
history threshold 4/5, window endpoints, and manual/automatic day selection.

The frozen baseline implements SCH-01/02 in `testing/baseline/test_schedule.py`,
GAR-01/02/03 in `testing/baseline/test_garmin.py`, and NUT-01/02/03/04 plus
DAY-01/02 in `testing/baseline/test_targets.py`. The explicit selection passed
24 cases on 25 September 2026. Its [machine-readable result](evidence/baseline-20260925T095243Z-48489.json)
contains the suite/source hashes; [JUnit](evidence/baseline-20260925T095243Z-48489-junit.xml)
and [scoped branch coverage](evidence/baseline-20260925T095243Z-48489-coverage.json)
are retained separately. The source had 43/60 branches covered in the three
measured service files. These are baseline observations, not evidence of
edge-pair or all-definition-use-path coverage.
