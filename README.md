# FencingCoach AI

Self-hosted AI performance coach for an elite épéeist. Phase 1 scaffolding:
end-to-end Docker stack (Next.js + FastAPI + PostgreSQL + Ollama), Garmin
Connect sync (unofficial library), and a configurable OpenAI-compatible
LLM client.

## Stack

| Layer       | Tech                                             |
|-------------|--------------------------------------------------|
| Frontend    | Next.js 14 (App Router) + Tailwind               |
| Backend     | FastAPI + SQLAlchemy 2.0 + Alembic               |
| DB          | PostgreSQL 16                                    |
| LLM         | Any OpenAI-compatible endpoint (Ollama default)  |
| Garmin      | `garminconnect` (token persisted to volume)      |
| Worker      | APScheduler — recent sync every 15 min, full nightly |

## Quick start

```bash
cp .env.example .env
# Fill in: APP_PASSWORD, GARMIN_EMAIL, GARMIN_PASSWORD,
#          and (if remote LLM) LLM_BASE_URL + LLM_API_KEY
docker compose up -d --build
```

Then:

- **Backend docs:** http://localhost:8000/docs
- **Frontend:**     http://localhost:3000
- **DB:**           `postgres://coach@localhost:5432/coachapp`

### Pull a local model (only if using Ollama)

```bash
docker compose exec llm ollama pull qwen3:8b
# or whatever fits your VRAM, e.g. gemma2:9b, llama3.1:8b, qwen2.5:7b
```

Set `LLM_MODEL` in `.env` to match.

### Switch LLM provider

Edit `.env` and restart `backend`:

```env
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# NVIDIA NIM
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_API_KEY=nvapi-...
LLM_MODEL=meta/llama-3.1-70b-instruct

# OpenRouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=anthropic/claude-3.5-sonnet
```

```bash
docker compose restart backend garmin-sync
```

## Verify end-to-end

```bash
# 1. Health check (DB + LLM)
curl http://localhost:8000/health

# 2. Login → token
TOKEN=$(curl -s -X POST http://localhost:8000/auth/token \
  -d "username=athlete&password=$APP_PASSWORD" | jq -r .access_token)

# 3. Talk to the coach (round-trips through the LLM)
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Quick check — are you online?"}'

# 4. Garmin login + sync
curl -X POST http://localhost:8000/garmin/login \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"email\":\"$GARMIN_EMAIL\",\"password\":\"$GARMIN_PASSWORD\"}"

curl -X POST "http://localhost:8000/garmin/sync/recent?days=2" \
  -H "Authorization: Bearer $TOKEN"
```

## Layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/                     FastAPI app
│   ├── app/
│   │   ├── api/                 route handlers
│   │   ├── core/                config, db, security
│   │   ├── models/              SQLAlchemy ORM
│   │   ├── schemas/             Pydantic
│   │   ├── services/            llm.py, garmin.py, prompts.py
│   │   └── workers/             garmin_sync (APScheduler)
│   ├── alembic/                 migrations
│   └── requirements.txt
├── frontend/                    Next.js app
│   └── src/
│       ├── app/                 pages: /, /login, /chat, /garmin
│       └── lib/api.ts           typed API client
├── llm/
│   ├── Modelfile                optional Ollama model definition
│   └── prompts/coach.py         coach system prompt (canonical copy in backend)
└── scripts/                     (Phase 3: USDA food import, etc.)
```

## Phase 1 scope

Implemented:

- [x] Docker Compose: `db`, `backend`, `garmin-sync`, `frontend`, `llm`
- [x] PostgreSQL schema for all Phase 1+ tables (athlete, garmin_metrics, activities,
      nutrition_log, nutrition_plans, training_plans, workout_log, competitions,
      coach_conversations/messages, daily_briefs, data_summaries)
- [x] Alembic migrations
- [x] Single-user JWT auth via env-configured credentials
- [x] Garmin OAuth (via `garminconnect`) + token persistence + scheduled sync
- [x] Configurable OpenAI-compatible LLM client (Ollama / OpenAI / NVIDIA / OpenRouter / …)
- [x] `/chat` endpoint persisting conversations, system-prompt-loaded coach
- [x] Minimal frontend: dashboard health view, login, chat, Garmin connect/sync

## Phase 2 scope

Implemented:

- [x] **Readiness scoring** — composite 0-100 from HRV-vs-baseline (35%), sleep (25%),
      Body Battery (15%), acute-vs-chronic load ratio (15%), days since rest (10%).
      Component breakdown returned for transparency.
      `services/readiness.py`, `GET /readiness/today|/{day}`.
- [x] **RAG context packing** — `services/context.py` builds a token-budget-aware
      snapshot (readiness, last 7d metrics, this-week activities, nutrition,
      upcoming competitions, training plan, profile) and injects it into chat +
      brief prompts. tiktoken used for budgeting; falls back gracefully without it.
- [x] **Daily brief generation** — `services/brief.py` + `POST /brief/today` runs
      the coach prompt + DAILY_BRIEF_PROMPT against context, persists to
      `daily_briefs`. Idempotent upsert per day.
- [x] **Nutrition logging** — `services/nutrition.py` calls the LLM in
      JSON-only mode to estimate kcal / macros / key micros (iron, vit D,
      B12, magnesium, zinc, omega-3) from free-text. Persisted to
      `nutrition_log` with confidence + parsed items.
      `POST /nutrition/log`, `GET /nutrition/log`, `GET /nutrition/totals/{day}`.
- [x] **Time-series endpoints** — `GET /metrics/{kind}?days=` for any tracked
      Garmin metric, `GET /activities/recent`. Powers all dashboard charts.
- [x] **Context-aware chat** — `/chat` now injects fresh context every turn so
      the coach always sees current state.
- [x] **Frontend rewrite** — Today (readiness gauge + brief + intake + 4 sparklines),
      Weekly (load bars, kcal bars, 28d sparklines, activities table),
      Nutrition (text logging w/ LLM estimation, today + 7-day history). All
      charts are dependency-free SVG.

## Phase 3 scope

- [x] **Dynamic periodization** (`services/periodization.py`) — phase computed
      each call from days-to-next-A-event: `general → build → peak → taper →
      comp_week → recovery`. No fixed mesocycles; adapts to irregular comp
      schedule.
- [x] **Periodized nutrition targets** (`services/targets.py`,
      `GET /targets/today|/{day}`) — carbs g/kg vary by training-day type
      (rest/easy/hard/comp) × phase modifier; protein 2.0–2.4 g/kg; fat fills
      to maintenance × goal modifier; athlete-baseline micros.
- [x] **Meal-plan generation + shopping list** (`services/mealplan.py`,
      `POST /mealplan/today|/{day}|/week`, `GET /shopping/week|/range`) — LLM
      builds daily plan to hit targets and persists it; shopping list aggregates
      ingredients across days.
- [x] **Adaptive training engine** (`services/training.py`,
      `GET /training/today|/session/{day}`) — Tue strength/Thu power templates
      modified by phase × current readiness band (volume & intensity).
- [x] **Workout logging + 1RM tracking + plateau detection**
      (`POST/GET/DELETE /training/log`, `GET /training/progress/{exercise}`) —
      Epley estimated 1RM; 4-week vs prior-4-week plateau check.
- [x] **Competition CRUD** (`/competitions` full CRUD + result patch).
- [x] **Context expansion** — `services/context.py` now also injects current
      phase, today's targets, and plateau alerts into every chat turn.
- [x] **Frontend** — new `/training` (today's session, set logger, 1RM chart),
      `/competitions` (list/add/edit), `/nutrition` enhanced (target compliance
      bars, meal plan view, weekly shopping list), Today page shows phase badge
      and target hints.

Not yet (Phase 4+):

- Mental coaching module
- Long-term data summarization (6-month detail → summaries)
- USDA food DB import for nutrition cross-reference
