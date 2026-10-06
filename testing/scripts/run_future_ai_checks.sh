#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd)"
export TEST_COMPOSE_PROJECT="fencingcoach-testing-future-ai-$$"
export TEST_DB_PORT=15439
export TEST_BACKEND_PORT=18009
export TEST_FRONTEND_PORT=13009
export TEST_ATHLETE_DAY=2026-10-05
export TEST_DB_GUARD=isolated-fencingcoach
export ATHLETE_TIMEZONE=UTC
export DATABASE_URL="postgresql+psycopg://coach_test:disposable_test_password@127.0.0.1:$TEST_DB_PORT/coachapp_testing"
export TEST_RECIPE_DATABASE_URL="$DATABASE_URL"
export LLM_API_KEY= LOGFIRE_TOKEN= GARMIN_EMAIL= GARMIN_PASSWORD= USDA_API_KEY=
export PYTHONPATH="$task_root/backend:$task_root"
export NEXT_PUBLIC_API_BASE_URL="http://localhost:$TEST_BACKEND_PORT"
export BACKEND_CORS_ORIGINS='["http://localhost:13009"]'
export TEST_ARTIFACT_DIR="$task_root/testing/.artifacts/future-ai"
mkdir -p "$TEST_ARTIFACT_DIR"
task_container="$TEST_COMPOSE_PROJECT-db"
backend_pid= frontend_pid=
finish() {
  result=$?
  trap - EXIT
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$frontend_pid" ]]; then kill -- "-$frontend_pid" 2>/dev/null || true; fi
  docker stop "$task_container" >/dev/null 2>&1 || true
  exit "$result"
}
trap finish EXIT
docker run --rm -d --name "$task_container" -p "127.0.0.1:$TEST_DB_PORT:5432" \
  -e POSTGRES_USER=coach_test -e POSTGRES_PASSWORD=disposable_test_password \
  -e POSTGRES_DB=coachapp_testing postgres:16-alpine
for attempt in $(seq 1 30); do
  if docker exec "$task_container" pg_isready -U coach_test -d coachapp_testing >/dev/null 2>&1; then break; fi
  sleep 1
done
cd /tmp
"$task_root/.venv/bin/python" - <<'PY'
import os
from pathlib import Path
from alembic.config import Config
from alembic import command
root = Path(os.environ["PYTHONPATH"].split(":")[1])
config = Config(str(root / "backend/alembic.ini"))
config.set_main_option("script_location", str(root / "backend/alembic"))
command.upgrade(config, "head")
command.current(config)
command.downgrade(config, "0016_voice_drafts")
command.upgrade(config, "head")
PY
"$task_root/.venv/bin/python" -m pytest -c "$task_root/pyproject.toml" "$task_root/testing/integration/test_recipe_transactions.py" -q
"$task_root/.venv/bin/python" -m uvicorn testing.support.future_ai_app:app --host 127.0.0.1 --port "$TEST_BACKEND_PORT" >"$TEST_ARTIFACT_DIR/backend.log" 2>&1 &
backend_pid=$!
cd "$task_root/frontend"
setsid ./node_modules/.bin/next dev -p "$TEST_FRONTEND_PORT" >"$TEST_ARTIFACT_DIR/frontend.log" 2>&1 &
frontend_pid=$!
for attempt in $(seq 1 60); do
  if curl --fail --silent "http://localhost:$TEST_FRONTEND_PORT/nutrition" >/dev/null && curl --fail --silent "http://127.0.0.1:$TEST_BACKEND_PORT/docs" >/dev/null; then break; fi
  sleep 1
done
./node_modules/.bin/playwright test --config=playwright.future-ai.config.ts
