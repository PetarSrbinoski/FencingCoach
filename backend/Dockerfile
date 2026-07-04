FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY requirements.txt ./
RUN uv pip install --system -r requirements.txt

# Local USDA MCP server (rpassafaro/usda-api-mcp) — spawned as a stdio
# subprocess by the nutrition/mealplan agents (see app/agents/nutrition.py,
# app/agents/mealplan.py, settings.USDA_MCP_SCRIPT). Cloned at build time
# rather than vendored into this repo (upstream has no LICENSE file).
RUN git clone --depth 1 https://github.com/rpassafaro/usda-api-mcp.git /opt/usda-api-mcp

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
