""" 
  Create Date: 2026-05-01
"""

from __future__ import annotations

from alembic import op

revision = "0003_mental_usda_summaries"
down_revision = "0002_day_type_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0001_init already creates all ORM tables through Base.metadata.create_all().
    # So here we only keep safe SQL that will not crash if things already exist.

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute("""
    CREATE TABLE IF NOT EXISTS mental_entries (
        id BIGSERIAL PRIMARY KEY,
        day DATE NOT NULL,
        entry_type VARCHAR(20) NOT NULL,
        mood_score INTEGER,
        energy_score INTEGER,
        focus_score INTEGER,
        confidence_score INTEGER,
        content TEXT,
        tags JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
    """)
    op.execute("""
    CREATE TABLE IF NOT EXISTS usda_foods (
        id BIGSERIAL PRIMARY KEY,
        fdc_id BIGINT,
        description TEXT NOT NULL,
        brand_owner TEXT,
        data_type VARCHAR(80),
        food_category TEXT,
        nutrients JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS ix_mental_entries_day
    ON mental_entries (day)
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS ix_usda_foods_description_trgm
    ON usda_foods USING gin (description gin_trgm_ops)
    """)


def downgrade() -> None:
    # Keep safe for dev. Do not drop tables automatically.
    pass