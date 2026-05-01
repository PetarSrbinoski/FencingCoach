"""initial schema

Revision ID: 0001_init
Revises:
Create Date: 2026-04-30
"""

from __future__ import annotations

from alembic import op

from app.core.database import Base
from app.models import *  # noqa: F401,F403

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # For the initial migration we let SQLAlchemy create all tables from
    # the ORM metadata. Subsequent schema changes use proper Alembic
    # autogenerate diffs.
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
