"""Accepted competition target versions and dated assignments."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_competition_nutrition"
down_revision = "0008_food_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "competition_nutrition_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("event_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("input_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("days", postgresql.JSONB(), nullable=False),
        sa.Column("policy_version", sa.String(60), nullable=False),
        sa.Column("preview_token", sa.String(64), nullable=False),
        sa.Column("acceptance_id", sa.String(100), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "nutrition_target_assignments",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("targets", postgresql.JSONB(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("nutrition_target_assignments")
    op.drop_table("competition_nutrition_plans")
