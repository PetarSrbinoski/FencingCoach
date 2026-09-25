#!/usr/bin/env bash
# Fair, fresh A/B/C mutation run in its own generated source/test workspace.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
stage="${1:?Expected A, B or C}"
case "$stage" in A|B|C) ;; *) exit 2 ;; esac
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
workspace="$repo_root/testing/.artifacts/mutation-$stage-$run_id"
evidence="$repo_root/docs/testing/evidence/mutation-$stage-$run_id"
mkdir -p "$evidence"
uv run --project "$repo_root" --frozen python "$repo_root/testing/scripts/prepare_mutation.py" \
  "$stage" "$workspace" >"$evidence/experiment.json"
cp "$workspace/pyproject.toml" "$evidence/mutmut-config.toml"
started="$(date +%s)"
cd "$workspace"
"$repo_root/.venv/bin/mutmut" --version >"$evidence/version.txt"
set +e
timeout 300 "$repo_root/.venv/bin/mutmut" run --max-children 2 >"$evidence/run.log" 2>&1
result=$?
set -e
printf '%s\n' "$result" >"$evidence/exit-code.txt"
printf '%s\n' "$(( $(date +%s) - started ))" >"$evidence/runtime-seconds.txt"
"$repo_root/.venv/bin/mutmut" results --all true >"$evidence/results.txt" 2>&1 || true
"$repo_root/.venv/bin/mutmut" export-cicd-stats >"$evidence/export.log" 2>&1 || true
if [[ -f mutants/mutmut-cicd-stats.json ]]; then
  cp mutants/mutmut-cicd-stats.json "$evidence/stats.json"
fi
tar -czf "$evidence/mutant-source.tar.gz" \
  mutants/app/services/schedule.py mutants/app/services/garmin_extract.py
tar -czf "$evidence/selected-tests.tar.gz" tests pytest.ini pyproject.toml
echo "Evidence: $evidence"
exit "$result"
