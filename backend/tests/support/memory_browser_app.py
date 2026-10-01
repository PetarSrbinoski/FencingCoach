"""Disposable browser-test API with SQLite and a controlled external chat model.

Run only with the memory Playwright config. No production data/providers used.
"""

import os
import tempfile
from pathlib import Path

os.environ.update(DATABASE_URL="sqlite://", LOGFIRE_TOKEN="", LLM_API_KEY="test",
                  LLM_BASE_URL="http://127.0.0.1:9/v1", ATHLETE_TIMEZONE="Europe/Skopje",
                  BACKEND_CORS_ORIGINS='["http://127.0.0.1:13001"]',
                  USDA_MCP_SCRIPT="/nonexistent/test-only.py")

from app.agents import coach
from app.core import database
from app.core.database import Base, get_db
from app.main import app
from app.services import generation
from pydantic_ai.messages import (
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import JSON, BigInteger, Integer, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker

_temp = tempfile.TemporaryDirectory(prefix="coach-memory-browser-")
engine = create_engine(f"sqlite:///{Path(_temp.name) / 'test.sqlite'}", connect_args={"check_same_thread": False})
for table in Base.metadata.tables.values():
    if table.name in {"coach_messages", "coach_conversations"}:
        table.dialect_options["sqlite"]["autoincrement"] = True
    for column in table.columns:
        if isinstance(column.type, JSONB):
            column.type = JSON()
        if isinstance(column.type, BigInteger) and column.primary_key:
            column.type = Integer()
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)


def get_test_db():
    with Session() as db:
        yield db


app.dependency_overrides[get_db] = get_test_db
generation.SessionLocal = Session
database.SessionLocal = Session


def provider(messages, info):
    latest = messages[-1]
    if any(isinstance(part, ToolReturnPart) for part in latest.parts):
        return ModelResponse(parts=[TextPart("Saved a tentative preference. Review it in What my coach knows.")])
    if any(isinstance(part, UserPromptPart) and "usually eat rice" in str(part.content) for part in latest.parts):
        return ModelResponse(parts=[ToolCallPart("remember_context", {
            "memory": {"content": "Prefers rice for lunch"}, "provenance": "inferred",
            "evidence": "I usually eat rice for lunch",
        })])
    return ModelResponse(parts=[TextPart("Ready to review your preferences.")])


coach.get_active_model = lambda: FunctionModel(provider)
