# Mutation instrumentation smoke

Pinned runner: `mutmut==3.8.0`; configuration is copied from
`testing/scripts/prepare_mutation.py`. The source allowlist is exactly
`app/services/schedule.py` and `app/services/garmin_extract.py`; the support
package is copied beneath `mutants/app` for the test import path. The local
smoke workspace was `testing/.artifacts/mutation-smoke-A`.

The unmutated selected tests passed, mutmut's built-in forced-fail test passed,
and the selected `app.services.schedule.x__parse_schedule__mutmut_1` was killed.
Its diff replaces `parts = [p.strip().lower() for p in raw.split(",")]` with
`parts = None`, which makes public schedule lookups fail. The forced-fail check
guards against accidentally importing the original checkout and mistaking
uninstrumented tests for survivor evidence. This was a one-mutant setup check,
not the later A/B/C score. The subsequent full stages use fresh workspaces.

Initial filter syntax `app.services.schedule.day_type_for_weekday*` matched no
mutants because mutmut 3.8.0 names generated functions with `x_...__mutmut_N`.
The corrected exact identifier above ran successfully. No instrumentation or
environment failure was counted as a kill in the full comparison.
