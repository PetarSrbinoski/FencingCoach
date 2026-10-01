"""Editable coach memory and durable action deduplication."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_coach_memory"
down_revision = "0014_workout_day_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coach_memories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("provenance", sa.String(20), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("expires_on", sa.Date()),
        sa.Column("revision", sa.String(32), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("agent_actions", sa.Column("request_key", sa.String(150)))
    op.add_column("agent_actions", sa.Column("request_fingerprint", sa.String(64)))
    op.create_unique_constraint("uq_agent_actions_request_key", "agent_actions", ["request_key"])


def downgrade() -> None:
    op.drop_constraint("uq_agent_actions_request_key", "agent_actions", type_="unique")
    op.drop_column("agent_actions", "request_fingerprint")
    op.drop_column("agent_actions", "request_key")
    op.drop_table("coach_memories")
