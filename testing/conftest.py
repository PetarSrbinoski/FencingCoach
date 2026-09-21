"""Fixtures for the independent project suite; legacy fixtures are never imported."""

from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session


@pytest.fixture
def migrated_db() -> Iterator[Session]:
    """Reset committed test rows and offer a real PostgreSQL session."""
    from app.core.database import SessionLocal

    from testing.support.reset_db import reset_and_seed

    reset_and_seed()
    with SessionLocal() as db:
        yield db
