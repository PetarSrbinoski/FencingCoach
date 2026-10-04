"""Recipe snapshots and durable review workflows."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017_recipes_and_drafts"
down_revision = "0016_voice_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_key", sa.String(400), nullable=False, unique=True),
        sa.Column("composition", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.String(32), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "nutrition_drafts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("payload", postgresql.JSONB()),
        sa.Column("error", sa.Text()),
        sa.Column("revision", sa.String(32), nullable=False),
        sa.Column("accepted_actions", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("nutrition_drafts")
    op.drop_table("recipes")
