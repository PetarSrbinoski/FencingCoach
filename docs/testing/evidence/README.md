# Compact execution evidence

The isolated smoke wrapper writes one JSON file per run here. It contains
actual revisions, versions, selected tests, settings, duration, and result
counts. Full Playwright HTML reports, traces, screenshots, logs, and JUnit XML
remain in the ignored local `testing/.artifacts/` directory.
