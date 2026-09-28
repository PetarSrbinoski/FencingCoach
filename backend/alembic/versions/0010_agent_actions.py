"""Coach action receipts and resource revisions for guarded undo."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_agent_actions"
down_revision = "0009_competition_nutrition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("saved_foods", "competitions", "workout_overrides"):
        op.add_column(table, sa.Column("revision", sa.String(32), nullable=True))
        op.execute(f"UPDATE {table} SET revision = md5(random()::text || clock_timestamp()::text)")
        op.alter_column(table, "revision", nullable=False)
    op.create_table(
        "agent_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("resource_id", sa.String(100), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("before", postgresql.JSONB()),
        sa.Column("after", postgresql.JSONB()),
        sa.Column("conversation_id", sa.Integer()),
        sa.Column("message_id", sa.BigInteger()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("undone_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_agent_actions_created", "agent_actions", ["created_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_agent_actions_created", table_name="agent_actions")
    op.drop_table("agent_actions")
    for table in ("saved_foods", "competitions", "workout_overrides"):
        op.drop_column(table, "revision")
