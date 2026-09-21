#!/usr/bin/env bash
# Run the independent service suite against an empty migrated PostgreSQL stack.
set -euo pipefail
export TEST_COMPOSE_PROJECT="fencingcoach-testing-service-$(date -u +%s)-$$"
source "$(dirname "$0")/compose.sh"
export TEST_DB_PORT="${TEST_DB_PORT:-15432}"
export TEST_BACKEND_PORT="${TEST_BACKEND_PORT:-18000}"
export TEST_ATHLETE_DAY="${TEST_ATHLETE_DAY:-2026-09-27}"
export TEST_DB_GUARD=isolated-fencingcoach
export DATABASE_URL="postgresql+psycopg://coach_test:disposable_test_password@127.0.0.1:$TEST_DB_PORT/coachapp_testing"
export ATHLETE_TIMEZONE=UTC
export WEEKLY_SCHEDULE=fencing,gym,fencing,gym,fencing,fencing,rest
export UV_CACHE_DIR="${UV_CACHE_DIR:-$REPO_ROOT/testing/.artifacts/uv-cache}"

stage="${1:-baseline}"
case "$stage" in
  baseline) selection=("$REPO_ROOT/testing/baseline") ;;
  expanded) selection=("$REPO_ROOT/testing/baseline" "$REPO_ROOT/testing/properties") ;;
  *) echo "Expected stage baseline or expanded" >&2; exit 2 ;;
esac

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
artifact_dir="$REPO_ROOT/testing/.artifacts/$stage-$run_id"
evidence_file="$REPO_ROOT/docs/testing/evidence/$stage-$run_id.json"
mkdir -p "$artifact_dir"
started_at="$(date +%s)"
stack_owned=0
finish() {
  result=$?
  trap - EXIT
  if [[ "$stack_owned" == 1 ]]; then
    if [[ "$result" != 0 ]]; then
      "${COMPOSE[@]}" logs --no-color >"$artifact_dir/compose.log" 2>&1 || true
    fi
    "${COMPOSE[@]}" down --volumes --remove-orphans || true
  fi
  for retained in junit.xml coverage.json collection.txt pytest.txt; do
    if [[ -f "$artifact_dir/$retained" ]]; then
      cp "$artifact_dir/$retained" "$REPO_ROOT/docs/testing/evidence/$stage-$run_id-$retained"
    fi
  done
  uv run --project "$REPO_ROOT" --frozen python "$REPO_ROOT/testing/scripts/collect_stage.py" \
    "$stage" "$started_at" "$result" "$artifact_dir" "$evidence_file" || true
  echo "Evidence: $evidence_file"
  exit "$result"
}
trap finish EXIT

cd "$REPO_ROOT"
"${COMPOSE[@]}" build backend
stack_owned=1
"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" run --rm backend alembic upgrade head

cd "$REPO_ROOT/testing" # Settings' relative .env cannot see the private repo file.
uv run --project "$REPO_ROOT" --frozen pytest -c "$REPO_ROOT/pytest.project.ini" \
  "${selection[@]}" --collect-only -q >"$artifact_dir/collection.txt"
if rg -q 'backend/tests/' "$artifact_dir/collection.txt"; then
  echo "Legacy cases entered project collection" >&2
  exit 1
fi
uv run --project "$REPO_ROOT" --frozen pytest -c "$REPO_ROOT/pytest.project.ini" \
  "${selection[@]}" -q \
  --junitxml="$artifact_dir/junit.xml" \
  --cov=app.services.schedule --cov=app.services.garmin_extract \
  --cov=app.services.targets --cov-branch \
  --cov-report="json:$artifact_dir/coverage.json" \
  --cov-report=term | tee "$artifact_dir/pytest.txt"
