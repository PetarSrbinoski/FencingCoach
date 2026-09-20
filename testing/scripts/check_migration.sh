#!/usr/bin/env bash
# Focused regression loop: migrate a fresh, disposable PostgreSQL database.
set -euo pipefail
export TEST_COMPOSE_PROJECT="fencingcoach-testing-migration-$(date -u +%s)-$$"
source "$(dirname "$0")/compose.sh"
cd "$REPO_ROOT"
trap '"${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null' EXIT
"${COMPOSE[@]}" build backend >/dev/null
"${COMPOSE[@]}" up -d db >/dev/null
"${COMPOSE[@]}" run --rm backend alembic upgrade head
"${COMPOSE[@]}" run --rm backend alembic current | grep '0005_async_chat_and_nutrition_jobs'
