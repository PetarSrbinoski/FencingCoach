"""Persist reviewable voice drafts without retaining audio."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_voice_drafts"
down_revision = "0015_coach_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_drafts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("transcript", sa.Text()),
        sa.Column("interpretation", postgresql.JSONB()),
        sa.Column("revision", sa.String(32), nullable=False),
        sa.Column("accepted_action_id", sa.Integer()),
    )


def downgrade() -> None:
    op.drop_table("voice_drafts")
