"""Versioned reviewed meals linked to accepted target versions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_competition_meals"
down_revision = "0010_agent_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "competition_meal_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("target_plan_id", sa.Integer(), nullable=False),
        sa.Column("target_version", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("meals", postgresql.JSONB(), nullable=False),
        sa.Column("totals", postgresql.JSONB(), nullable=False),
        sa.Column("warnings", postgresql.JSONB(), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("preview_token", sa.String(64), nullable=False),
        sa.Column("acceptance_id", sa.String(100), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("acceptance_id", "day", name="uq_competition_meal_acceptance_day"),
    )
    op.create_index("ix_competition_meal_plans_day", "competition_meal_plans", ["day", "active"])


def downgrade() -> None:
    op.drop_index("ix_competition_meal_plans_day", table_name="competition_meal_plans")
    op.drop_table("competition_meal_plans")
