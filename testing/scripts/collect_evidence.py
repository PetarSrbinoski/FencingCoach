"""Write compact, factual metadata for one isolated smoke run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import time
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[2]


def command_output(*args: str) -> str:
    try:
        result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return "unavailable"
    return result.stdout.strip() or result.stderr.strip()


def suite_hash() -> str:
    files = [ROOT / "pytest.project.ini", ROOT / "compose.testing.yml"]
    files.extend(
        path
        for path in (ROOT / "testing").rglob("*")
        if path.is_file()
        and ".artifacts" not in path.parts
        and "__pycache__" not in path.parts
        and path.suffix not in {".pyc"}
    )
    files.extend((ROOT / "frontend/e2e").rglob("*.ts"))
    files.append(ROOT / "frontend/playwright.config.ts")
    files.append(ROOT / "frontend/package-lock.json")
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--started-at", type=int, required=True)
    parser.add_argument("--exit-code", type=int, required=True)
    args = parser.parse_args()

    collection_file = args.artifact_dir / "collection.txt"
    collected = (
        [line for line in collection_file.read_text().splitlines() if line.startswith("testing/")]
        if collection_file.exists()
        else []
    )
    backend_file = args.artifact_dir / "backend-smoke.xml"
    backend = None
    if backend_file.exists():
        root = ElementTree.parse(backend_file).getroot()
        suite = root.find("testsuite") if root.tag == "testsuites" else root
        assert suite is not None
        backend = {key: suite.attrib.get(key) for key in ("tests", "failures", "errors", "skipped", "time")}
    browser_file = args.artifact_dir / "playwright.json"
    browser = None
    if browser_file.exists():
        browser = json.loads(browser_file.read_text()).get("stats")

    details = {
        "source_revision": command_output("git", "rev-parse", "HEAD"),
        "suite_sha256": suite_hash(),
        "working_tree_status": command_output("git", "status", "--short"),
        "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(args.started_at)),
        "duration_seconds": int(time.time()) - args.started_at,
        "environment": {
            "os": platform.platform(),
            "python": platform.python_version(),
            "docker_compose": command_output("docker-compose", "version"),
            "playwright": json.loads((ROOT / "frontend/package.json").read_text())["devDependencies"]["@playwright/test"],
            "postgres_image": "postgres:16-alpine",
            "browser": "Chromium",
        },
        "command": "bash testing/scripts/run_e2e.sh",
        "scope": ["testing/integration/test_smoke_api.py", "frontend/e2e/nutrition-smoke.spec.ts"],
        "settings": {
            "athlete_day": os.environ.get("TEST_ATHLETE_DAY"),
            "backend_port": os.environ.get("TEST_BACKEND_PORT"),
            "frontend_port": os.environ.get("TEST_FRONTEND_PORT"),
            "db_port": os.environ.get("TEST_DB_PORT"),
            "database": "coachapp_testing",
        },
        "collected_tests": collected,
        "legacy_tests_collected": any("backend/tests/" in item for item in collected),
        "backend": backend,
        "browser": browser,
        "exit_code": args.exit_code,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(details, indent=2) + "\n")


if __name__ == "__main__":
    main()
