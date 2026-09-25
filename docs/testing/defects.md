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
