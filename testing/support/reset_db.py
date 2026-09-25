"""Remove committed test data and seed one synthetic athlete."""

from __future__ import annotations

import os

from app.core.database import Base, SessionLocal, engine
from app.models import AthleteProfile  # imports all model tables into Base metadata
from sqlalchemy import text
from sqlalchemy.engine import make_url


def validate_destination() -> None:
    url = make_url(str(engine.url))
    if (
        os.environ.get("TEST_DB_GUARD") != "isolated-fencingcoach"
        or url.database != "coachapp_testing"
        or url.host not in {"db", "127.0.0.1"}
        or url.username != "coach_test"
        or (
            url.host == "127.0.0.1"
            and url.port != int(os.environ.get("TEST_DB_PORT", "15432"))
        )
    ):
        raise RuntimeError("refusing to reset a database outside the isolated test stack")
    with engine.connect() as connection:
        if connection.scalar(text("SELECT current_database()")) != "coachapp_testing":
            raise RuntimeError("connected database does not match the test destination")
        if connection.scalar(text("SELECT count(*) FROM alembic_version")) != 1:
            raise RuntimeError("test database has not been migrated")


def reset_and_seed() -> None:
    validate_destination()
    preparer = engine.dialect.identifier_preparer
    names = ", ".join(preparer.quote(table.name) for table in Base.metadata.sorted_tables)
    with SessionLocal.begin() as db:
        db.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))
        db.add(
            AthleteProfile(
                name="Synthetic Fencer",
                sport="fencing-epee",
                level="club",
                weight_kg=70.0,
                body_comp_goal="maintain",
            )
        )


if __name__ == "__main__":
    reset_and_seed()
