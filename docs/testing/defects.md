# Confirmed defects

## MIG-01: revision 0005 could not be recorded on a fresh PostgreSQL database

- **Requirement:** Issue 01 requires Alembic migrations to complete on an empty
  PostgreSQL 16 database before API/browser tests.
- **Source revision:** `b981e64a3712cb415eaf176d3cfa53c7765fe2fc`.
- **Minimal reproduction:** `bash testing/scripts/check_migration.sh` with the
  migration unchanged. It creates a uniquely named test Compose project,
  migrates an empty PostgreSQL 16 database, and removes that project afterward.
- **Expected:** `alembic upgrade head` records revision
  `0005_async_chat_and_nutrition_jobs`.
- **Actual before fix:** PostgreSQL raised `StringDataRightTruncation: value too
  long for type character varying(32)` while Alembic updated
  `alembic_version.version_num`. Revision 0005's identifier has 34 characters.
- **Cause:** Alembic 1.14 creates `version_num` as `VARCHAR(32)`. The
  `version_table_column` argument in this repository's `env.py` did not change
  that column; Alembic's installed implementation does not use it.
- **Fix:** Revision 0005 widens `version_num` to `VARCHAR(64)` inside its upgrade
  transaction, before Alembic records the revision. The unused environment
  argument was removed. A fresh migration check remains in
  `testing/scripts/check_migration.sh`.
- **Impact:** Fresh PostgreSQL deployments could not complete migrations or
  start the backend. This is a production migration defect discovered while
  creating the isolated smoke environment, not an application calculation
  finding or a mutation result.

## UI-01: nutrition controls lacked accessible names

- **Requirement:** DAY-01/02 and API-03/04 browser workflows should identify
  the day-type selector and editable review fields by their visible names.
- **Source revision:** local base `d24a34d750fc31ca96438c082934f608fd108497`
  with the browser workflow tests added; the tested tree is identified by
  `source_tree_sha256` in the [red evidence](evidence/20260925T100120Z-50988.json).
- **Minimal reproduction:** `bash testing/scripts/run_e2e.sh` with the page's
  original unlabelled selector and review inputs. The day-type scenario waits
  for `getByRole('combobox', { name: 'Day type' })`; the meal scenario waits for
  `getByRole('textbox', { name: 'Kcal' })`. The [failed Playwright JSON](evidence/accessibility-red-20260925/playwright.json)
  and [trace/screenshot](evidence/accessibility-red-20260925/) are retained.
- **Expected / actual:** The visible Day type, Kcal, and Protein g controls
  should have accessible names; both role/name lookups timed out after 30 s.
  The estimate failure/recovery browser scenario and API cases passed, so the
  issue was localized to naming rather than persistence.
- **Fix:** Add `aria-label="Day type"` to the select trigger and associate each
  review label with its input via `htmlFor`/`id`. The [green rerun](evidence/20260925T100425Z-52708.json)
  passed all five API and four Chromium tests with no retries; TypeScript also
  passed. This improves assistive-technology identification and gives the
  browser tests stable semantic locators.
- **Impact:** Visual use remained possible, but assistive technology could not
  identify these controls by the text shown on screen. This is a frontend
  accessibility finding, not a mutation result.
