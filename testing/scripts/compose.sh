#!/usr/bin/env bash
# Source this file from testing scripts to select only the disposable stack.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_COMPOSE_PROJECT="${TEST_COMPOSE_PROJECT:-fencingcoach-testing}"
if [[ "$TEST_COMPOSE_PROJECT" != fencingcoach-testing* ]]; then
  echo "Refusing non-testing Compose project name: $TEST_COMPOSE_PROJECT" >&2
  exit 2
fi
export TEST_COMPOSE_PROJECT
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is required" >&2
  exit 2
fi
COMPOSE+=(--env-file "$REPO_ROOT/testing/empty.env" -f "$REPO_ROOT/compose.testing.yml" -p "$TEST_COMPOSE_PROJECT")
