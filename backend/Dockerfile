FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Install dependencies into a venv OUTSIDE the app dir so the compose
# bind-mount (./backend:/app) doesn't shadow it at runtime.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

# pyproject.toml + uv.lock live at the repo root (single source of truth),
# so the compose build context for this image is the repo root, not ./backend.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Local USDA MCP server (rpassafaro/usda-api-mcp) — spawned as a stdio
# subprocess by the nutrition/mealplan agents (see app/agents/nutrition.py,
# app/agents/mealplan.py, settings.USDA_MCP_SCRIPT). Cloned at build time
# rather than vendored into this repo (upstream has no LICENSE file).
RUN git clone --depth 1 https://github.com/rpassafaro/usda-api-mcp.git /opt/usda-api-mcp

COPY backend/ ./

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
