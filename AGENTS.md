# Agent setup guide (this is completely ai generated)

How to get FencingCoach AI running from a clean checkout. Written for a coding
agent (or a human) that needs to set up and start the app without prior context.

## What this is

Single-user fencing coach app. Next.js frontend + FastAPI backend + Postgres +
an LLM (via any OpenAI-compatible endpoint) + Garmin Connect sync. No auth —
see README "Notes".

## 1. Prerequisites

- Docker + Docker Compose (this is the only supported way to run the full stack)
- For backend-only dev without Docker: Python 3.12 + `uv`
- For frontend-only dev without Docker: Node 20+

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`. Minimum to get something working:

- `POSTGRES_*` — fine to leave as-is for local dev
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — any OpenAI-compatible provider
  (Ollama, OpenAI, NVIDIA NIM, OpenRouter, Together.ai — see comments in
  `.env.example`). Chat, nutrition estimation, and briefs won't work without this.
- `GARMIN_EMAIL`, `GARMIN_PASSWORD` — only needed if you want Garmin sync to work.
  The app still runs without it, just no metrics data.
- Everything else has a sane default — don't touch unless you know you need to.

## 3. Start everything

```bash
docker compose up -d --build
```

This starts 6 containers: `db` (Postgres), `backend` (FastAPI, runs Alembic
migrations on boot), `garmin-sync`, `summarization`, `brief` (background
workers), and `frontend` (Next.js).

Check it came up:

```bash
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/docs   # expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/       # expect 200
```

- Frontend: http://localhost:3000
- API docs (Swagger): http://localhost:8000/docs

Logs: `docker compose logs -f backend` (swap service name as needed).

## 4. Common tasks

Rebuild+restart a single service after changing its code (fast, doesn't touch
the DB or other services):

```bash
docker compose up -d --build backend    # or: frontend, garmin-sync, ...
```

Backend runs with `--reload` and a bind-mounted volume, so most backend
changes hot-reload without a rebuild. Frontend does **not** hot-reload in
Docker (production build) — rebuild the `frontend` service to see changes.

Stop everything: `docker compose down` (add `-v` to also wipe the Postgres volume).

## 5. Backend dev without Docker (optional)

```bash
cd backend
uv sync                       # or: pip install -r requirements.txt -r requirements-dev.txt
# point DATABASE_URL at a reachable Postgres (e.g. localhost if you expose db's port)
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

## 6. Frontend dev without Docker (optional)

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

## 7. Quality gates

Run from the repo root:

```bash
pytest                                       # backend tests
ruff check backend/app backend/tests         # lint
mypy backend/app backend/tests               # type check
```

Frontend:

```bash
cd frontend
npm run lint
npx tsc --noEmit                             # type check
npm run build                                # production build sanity check
```

## 8. Project layout (orientation)

```
backend/app/api/          FastAPI routers (one file per resource, e.g. chat.py, garmin.py, metrics.py)
backend/app/agents/       PydanticAI agents (chat, nutrition, mealplan, brief, mental)
backend/app/services/     Business logic (readiness, targets, periodization, garmin sync, ...)
backend/app/models/       SQLAlchemy models
backend/alembic/          Migrations
backend/tests/            Pytest suite

frontend/src/app/         Next.js App Router pages — one folder per route (page.tsx = entry)
frontend/src/lib/api.ts   Typed API client, single source of truth for backend endpoints
frontend/src/components/  Shared UI (components/ui/*), chart primitives (charts.tsx)
```

Routes: `/` (dashboard), `/training`, `/nutrition`, `/competitions`, `/weekly`,
`/chat` (coach chat), `/garmin` (sync/status), `/profile`.

## 9. Deploying

No CI/CD — deploy is manual: `git pull` on the target host, then
`docker compose up -d --build` (or `--build <service>` to only rebuild what changed).
