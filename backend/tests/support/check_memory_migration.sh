#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
container="coach-memory-migration-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_USER=coach_test \
  -e POSTGRES_PASSWORD=disposable_test_password -e POSTGRES_DB=coach_memory_testing \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U coach_test -d coach_memory_testing >/dev/null 2>&1; then break; fi
  sleep 1
done
port="$(docker port "$container" 5432/tcp | cut -d: -f2)"
export DATABASE_URL="postgresql+psycopg://coach_test:disposable_test_password@127.0.0.1:${port}/coach_memory_testing"
export PYTHONPATH="$repo_root/backend:$repo_root"
cd "$repo_root/backend"
"$repo_root/.venv/bin/python" "$repo_root/backend/tests/support/verify_memory_migration.py"
