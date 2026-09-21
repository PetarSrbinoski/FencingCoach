"""Compact revision, version, and run metadata for service experiment stages."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import coverage
import hypothesis
import mutmut
import pytest
import pytest_cov


def _sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(str(path).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    stage, started, result, artifact, output = sys.argv[1:]
    root = Path(__file__).resolve().parents[2]
    artifacts = Path(artifact)
    suite_files = list((root / "testing" / "baseline").glob("test_*.py"))
    if stage == "expanded":
        suite_files += list((root / "testing" / "properties").glob("test_*.py"))
    source_files = [
        root / "backend/app/services/schedule.py",
        root / "backend/app/services/garmin_extract.py",
        root / "backend/app/services/targets.py",
    ]
    junit = artifacts / "junit.xml"
    counts: dict[str, str] = {}
    if junit.exists():
        node = ET.parse(junit).getroot()
        suite = node.find("testsuite") if node.tag == "testsuites" else node
        if suite is not None:
            counts = {k: suite.attrib.get(k, "0") for k in ("tests", "failures", "errors", "skipped", "time")}
    cov_file = artifacts / "coverage.json"
    coverage_total = None
    if cov_file.exists():
        coverage_total = json.loads(cov_file.read_text())["totals"]
    meta = {
        "stage": stage,
        "source_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "source_sha256": _sha256(source_files),
        "suite_sha256": _sha256(suite_files),
        "selected_files": [str(p.relative_to(root)) for p in suite_files],
        "excluded": "backend/tests and API/browser cases",
        "runtime_seconds": round(time.time() - int(started), 2),
        "exit_code": int(result),
        "junit": counts,
        "coverage_totals": coverage_total,
        "tool_versions": {
            "pytest": pytest.__version__,
            "pytest_cov": pytest_cov.__version__,
            "coverage": coverage.__version__,
            "hypothesis": hypothesis.__version__,
            "mutmut": getattr(mutmut, "__version__", "3.8.0 (pinned)"),
        },
        "artifact_dir": str(artifacts.relative_to(root)),
        "command": f"bash testing/scripts/run_backend_tests.sh {stage}",
    }
    Path(output).write_text(json.dumps(meta, indent=2) + "\n")


if __name__ == "__main__":
    main()
