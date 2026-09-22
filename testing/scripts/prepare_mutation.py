"""Make independent, reproducible mutmut workspaces for A/B/C.

The mutation population is intentionally limited to schedule and Garmin
extractors; nutrition targets and all persistence/browser tests are omitted
from these scores. A/B/C use the same selected source files and runner config.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ("schedule.py", "garmin_extract.py")
BASELINE = ("test_schedule.py", "test_garmin.py")
PROPERTIES = ("test_schedule_properties.py", "test_garmin_properties.py")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("A", "B", "C"))
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    if workspace.exists():
        raise SystemExit(f"Refusing to reuse mutation workspace: {workspace}")
    workspace.mkdir(parents=True)
    shutil.copytree(ROOT / "backend/app", workspace / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    tests = workspace / "tests"
    tests.mkdir()
    names = list(BASELINE)
    for name in BASELINE:
        shutil.copy2(ROOT / "testing/baseline" / name, tests / name)
    if args.stage in ("B", "C"):
        names += list(PROPERTIES)
        for name in PROPERTIES:
            shutil.copy2(ROOT / "testing/properties" / name, tests / name)
    if args.stage == "C":
        for path in (ROOT / "testing/regression").glob("test_*.py"):
            names.append(path.name)
            shutil.copy2(path, tests / path.name)
    (workspace / "pytest.ini").write_text("[pytest]\ntestpaths = tests\naddopts = --strict-markers\nmarkers =\n    baseline: independent examples\n    property: generated properties\n    regression: mutation-guided cases\n")
    (workspace / "pyproject.toml").write_text(
        '[tool.mutmut]\n'
        'source_paths = ["app/services/schedule.py", "app/services/garmin_extract.py"]\n'
        'also_copy = ["app", "tests", "pytest.ini"]\n'
        'pytest_add_cli_args = ["-c", "pytest.ini", "-q"]\n'
        'pytest_add_cli_args_test_selection = ["tests"]\n'
        'max_stack_depth = 8\n'
        'on_dependency_change = "rerun"\n'
    )
    digest = hashlib.sha256()
    for name in SOURCE:
        digest.update(name.encode())
        digest.update((ROOT / "backend/app/services" / name).read_bytes())
    suite_digest = hashlib.sha256()
    for path in sorted(tests.glob("test_*.py")):
        suite_digest.update(path.name.encode())
        suite_digest.update(path.read_bytes())
    meta = {
        "stage": args.stage,
        "source_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "mutation_source_sha256": digest.hexdigest(),
        "suite_sha256": suite_digest.hexdigest(),
        "source_allowlist": [f"app/services/{name}" for name in SOURCE],
        "selected_tests": names,
        "excluded": "nutrition-target examples/properties, API, browser, legacy tests",
        "tool": "mutmut==3.8.0",
        "workspace": str(workspace),
    }
    (workspace / "experiment.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
