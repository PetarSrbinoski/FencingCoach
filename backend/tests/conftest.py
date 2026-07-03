"""Shared test fixtures.

Uses an in-memory SQLite database to avoid needing PostgreSQL.
Patches the database module before any model imports.
"""

from __future__ import annotations

import os
from datetime import date, timedelta

# Override DATABASE_URL before any app imports
os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from app.core.database import Base
from app.models import (
    MentalEntry,
    NutritionLog,
    USDAFood,
    WorkoutLog,
)
from sqlalchemy import JSON, BigInteger, Integer, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def db():
    """Create a fresh in-memory DB session for each test.

    Maps PostgreSQL JSONB columns to JSON for SQLite compatibility.
    Uses `StaticPool` + `check_same_thread=False` so the same in-memory DB
    is reachable from FastAPI TestClient's worker thread too (API-level
    tests that exercise real endpoints via dependency-override `get_db`).
    """
    engine = create_engine(
        "sqlite://",
        echo=False,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    # Enable foreign keys for SQLite
    @event.listens_for(engine, "connect")
    def _set_fk(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    # Remap JSONB -> JSON and BigInteger PKs -> Integer for SQLite
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()
            # SQLite doesn't auto-increment BigInteger PKs
            if isinstance(col.type, BigInteger) and col.primary_key:
                col.type = Integer()
                col.autoincrement = True

    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seed_mental_entries(db: Session):
    """Seed the DB with sample mental entries."""
    today = date.today()
    entries = []
    for i in range(7):
        day = today - timedelta(days=i)
        entry = MentalEntry(
            day=day,
            entry_type="check_in" if i % 2 == 0 else "reflection",
            mood_score=6 + (i % 3),
            energy_score=5 + (i % 4),
            focus_score=7 - (i % 2),
            confidence_score=6 + (i % 2),
            content=f"Test entry for day {day.isoformat()}" if i % 2 else None,
        )
        db.add(entry)
        entries.append(entry)
    db.commit()
    return entries


@pytest.fixture
def seed_nutrition_logs(db: Session):
    """Seed the DB with sample nutrition logs."""
    today = date.today()
    logs = []
    for i in range(10):
        day = today - timedelta(days=i)
        log_entry = NutritionLog(
            day=day,
            meal="lunch",
            raw_text=f"Test meal {i}",
            kcal=500 + i * 50,
            protein_g=30 + i * 2,
            carbs_g=60 + i * 3,
            fat_g=20 + i,
            fiber_g=5.0,
            estimated_by="llm",
        )
        db.add(log_entry)
        logs.append(log_entry)
    db.commit()
    return logs


@pytest.fixture
def seed_workout_logs(db: Session):
    """Seed the DB with sample workout logs."""
    today = date.today()
    logs = []
    for i in range(10):
        day = today - timedelta(days=i * 2)
        for s in range(3):
            log_entry = WorkoutLog(
                day=day,
                exercise="Back Squat",
                set_number=s + 1,
                reps=5,
                weight_kg=100 + i * 2.5,
                rpe=7.0 + (s * 0.5),
            )
            db.add(log_entry)
            logs.append(log_entry)
    db.commit()
    return logs


@pytest.fixture
def seed_usda_foods(db: Session):
    """Seed the DB with sample USDA foods."""
    foods = [
        USDAFood(
            fdc_id=171705,
            description="Chicken breast, roasted",
            description_lower="chicken breast, roasted",
            data_type="SR Legacy",
            category="Poultry Products",
            nutrients={
                "kcal": 165,
                "protein_g": 31,
                "carbs_g": 0,
                "fat_g": 3.6,
                "fiber_g": 0,
            },
            serving_size_g=100,
        ),
        USDAFood(
            fdc_id=168880,
            description="Rice, white, long-grain, cooked",
            description_lower="rice, white, long-grain, cooked",
            data_type="SR Legacy",
            category="Cereal Grains and Pasta",
            nutrients={
                "kcal": 130,
                "protein_g": 2.7,
                "carbs_g": 28.2,
                "fat_g": 0.3,
                "fiber_g": 0.4,
            },
            serving_size_g=100,
        ),
        USDAFood(
            fdc_id=170393,
            description="Broccoli, cooked, boiled, drained",
            description_lower="broccoli, cooked, boiled, drained",
            data_type="SR Legacy",
            category="Vegetables and Vegetable Products",
            nutrients={
                "kcal": 35,
                "protein_g": 2.4,
                "carbs_g": 7.2,
                "fat_g": 0.4,
                "fiber_g": 3.3,
            },
            serving_size_g=100,
        ),
        USDAFood(
            fdc_id=173410,
            description="Egg, whole, cooked, hard-boiled",
            description_lower="egg, whole, cooked, hard-boiled",
            data_type="SR Legacy",
            category="Dairy and Egg Products",
            nutrients={
                "kcal": 155,
                "protein_g": 12.6,
                "carbs_g": 1.1,
                "fat_g": 10.6,
                "fiber_g": 0,
            },
            serving_size_g=100,
        ),
    ]
    for f in foods:
        db.add(f)
    db.commit()
    return foods
