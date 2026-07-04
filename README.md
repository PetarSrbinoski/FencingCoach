# FencingCoach AI

A personal coaching app for fencing. It helps with training notes, nutrition logs, Garmin sync, and chat-based check-ins.

The live version is hosted on my home server.

## What it includes

- Home dashboard: readiness overview, key metrics, next competition, quick coach chat, one-click Garmin sync
- Garmin data sync
- Nutrition logging
- Workout tracking
- Coach chat

See [FUNCTIONALITIES.md](./FUNCTIONALITIES.md) for a full breakdown of the coach
agent's capabilities and every app feature.

## Architecture

High-level overview of how the pieces fit together — a Next.js frontend talking
to a FastAPI backend, which fans out to PydanticAI agents, background workers, a
Postgres database, and external services (LLM, USDA MCP, Garmin Connect).

![Architecture diagram](./docs/diagram.png)

## Tech stack

- Frontend: Next.js
- Backend: FastAPI
- Database: PostgreSQL
- AI: PydanticAI agents with Ollama or another OpenAI-compatible model
- Sync: Garmin Connect integration for activity and health data

## Agent layer

- Shared `CoachDeps` keeps the DB session, live context snapshot, and extra runtime data in one place
- A cached OpenAI-compatible model factory is reused across agents
- Chat uses message history, live context injection, and `WebSearch` for lookup support
- Nutrition and meal-plan agents return structured Pydantic output and can call USDA MCP tools (local stdio subprocess, [rpassafaro/usda-api-mcp](https://github.com/rpassafaro/usda-api-mcp)) plus web search
- Brief and mental agents are text-only, but still use the same prompt and output cleanup flow

## Run locally

```bash
cp .env.example .env
docker compose up -d --build
```

Then open:

- Frontend: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

See [AGENTS.md](./AGENTS.md) for a full setup/run guide (useful for coding agents or a fresh dev environment).

## Notes

- Single-user app with no authentication — only expose it over Tailscale, never LAN/public internet
- Set `GARMIN_EMAIL` and `GARMIN_PASSWORD` in `.env`
- If you use a remote model, set `LLM_BASE_URL` and `LLM_API_KEY`
- If you use Ollama, pull a model and set `LLM_MODEL` to match
