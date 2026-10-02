"""Disposable browser-test API with controlled speech and interpretation providers."""

import os
import tempfile
from pathlib import Path

os.environ.update(DATABASE_URL="sqlite://", LOGFIRE_TOKEN="", LLM_API_KEY="test",
                  LLM_BASE_URL="http://127.0.0.1:9/v1", ATHLETE_TIMEZONE="Europe/Skopje",
                  BACKEND_CORS_ORIGINS='["http://127.0.0.1:13002"]',
                  USDA_MCP_SCRIPT="/nonexistent/test-only.py")

from app.api import voice
from app.core import database
from app.core.database import Base, get_db
from app.main import app
from app.services import generation
from sqlalchemy import JSON, BigInteger, Integer, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker

_temp = tempfile.TemporaryDirectory(prefix="coach-voice-browser-")
engine = create_engine(f"sqlite:///{Path(_temp.name) / 'test.sqlite'}", connect_args={"check_same_thread": False})
for table in Base.metadata.tables.values():
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
voice.SessionLocal = Session


async def transcribe_audio(data: bytes, filename: str) -> str:
    return "Save yogurt pot, 150 grams, 90 calories, 6 grams protein, 12 grams carbs, 2 grams fat"


async def interpret_voice(transcript: str, catalog: list[dict]) -> dict:
    if "ate" in transcript.lower():
        food = next(item for item in catalog if item["name"].casefold() == "kefir pot")
        return {"intent": "log_consumption", "portions": [{"food_id": food["id"], "servings": 0.5}]}
    return {"intent": "save_food", "food": {
        "name": "Kefir pot" if "kefir" in transcript.lower() else "Yogurt pot",
        "basis": "per_serving", "basis_grams": 150, "serving_name": "pot", "serving_size_g": 150,
        "kcal": 90, "protein_g": 6, "carbs_g": 12, "fat_g": 2, "fiber_g": None,
    }}


voice.transcribe_audio = transcribe_audio
voice.interpret_voice = interpret_voice
