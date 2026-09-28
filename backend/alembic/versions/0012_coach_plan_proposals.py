"""Pending coach nutrition previews with explicit application receipts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_coach_plan_proposals"
down_revision = "0011_competition_meals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coach_plan_proposals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("preview", postgresql.JSONB(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("conversation_id", sa.Integer()),
        sa.Column("message_id", sa.BigInteger()),
        sa.Column("applied_plan_id", sa.Integer()),
        sa.Column("action_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("coach_plan_proposals")
