#!/usr/bin/env bash
set -euo pipefail
export TEST_COMPOSE_PROJECT="fencingcoach-testing-$(date -u +%s)-$$"
source "$(dirname "$0")/compose.sh"
export TEST_ATHLETE_DAY="${TEST_ATHLETE_DAY:-$(date -u +%F)}"
export TEST_BACKEND_PORT="${TEST_BACKEND_PORT:-18000}"
export TEST_FRONTEND_PORT="${TEST_FRONTEND_PORT:-13000}"
export TEST_DB_PORT="${TEST_DB_PORT:-15432}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$REPO_ROOT/testing/.artifacts/uv-cache}"

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
export TEST_ARTIFACT_DIR="$REPO_ROOT/testing/.artifacts/$run_id"
evidence_dir="$REPO_ROOT/docs/testing/evidence"
mkdir -p "$TEST_ARTIFACT_DIR" "$evidence_dir"
started_at="$(date +%s)"
stack_owned=0

finish() {
  status=$?
  trap - EXIT
  if [[ "$stack_owned" == 1 ]]; then
    if [[ "$status" != 0 ]]; then
      "${COMPOSE[@]}" logs --no-color >"$TEST_ARTIFACT_DIR/compose.log" 2>&1 || true
    fi
    "${COMPOSE[@]}" down --volumes --remove-orphans || true
  fi
  for retained in backend-smoke.xml playwright.json collection.txt; do
    if [[ -f "$TEST_ARTIFACT_DIR/$retained" ]]; then
      cp "$TEST_ARTIFACT_DIR/$retained" "$evidence_dir/$run_id-$retained"
    fi
  done
  uv run --frozen python "$REPO_ROOT/testing/scripts/collect_evidence.py" \
    --artifact-dir "$TEST_ARTIFACT_DIR" \
    --output "$evidence_dir/$run_id.json" \
    --started-at "$started_at" \
    --exit-code "$status" || true
  echo "Evidence: $evidence_dir/$run_id.json"
  echo "Detailed artifacts: $TEST_ARTIFACT_DIR"
  exit "$status"
}
trap finish EXIT

cd "$REPO_ROOT"
"${COMPOSE[@]}" build backend frontend
stack_owned=1
"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" run --rm backend alembic upgrade head
"${COMPOSE[@]}" up -d backend frontend

wait_for() {
  local url="$1"
  for _ in $(seq 1 120); do
    if curl --fail --silent --output /dev/null "$url"; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}
wait_for "http://127.0.0.1:$TEST_BACKEND_PORT/docs"
wait_for "http://localhost:$TEST_FRONTEND_PORT/nutrition"

cd "$REPO_ROOT/testing"
uv run --project "$REPO_ROOT" --frozen pytest -c "$REPO_ROOT/pytest.project.ini" --collect-only -q >"$TEST_ARTIFACT_DIR/collection.txt"
if grep -q 'backend/tests/' "$TEST_ARTIFACT_DIR/collection.txt"; then
  echo "Legacy tests leaked into project collection" >&2
  exit 1
fi

bash "$REPO_ROOT/testing/scripts/reset_db.sh"
uv run --project "$REPO_ROOT" --frozen pytest -c "$REPO_ROOT/pytest.project.ini" "$REPO_ROOT/testing/integration" \
  -q --junitxml="$TEST_ARTIFACT_DIR/backend-smoke.xml"

cd "$REPO_ROOT/frontend"
npx playwright test --config=playwright.config.ts
