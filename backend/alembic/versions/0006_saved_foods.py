"""Personal food library with supplied nutrients per 100 g."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_saved_foods"
down_revision = "0005_async_chat_and_nutrition_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_foods",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_key", sa.String(400), nullable=False, unique=True),
        sa.Column("kcal", sa.Float()),
        sa.Column("protein_g", sa.Float()),
        sa.Column("carbs_g", sa.Float()),
        sa.Column("fat_g", sa.Float()),
        sa.Column("fiber_g", sa.Float()),
        sa.Column("micros", postgresql.JSONB(), nullable=False),
        sa.Column("serving_name", sa.String(80)),
        sa.Column("serving_size_g", sa.Float()),
    )


def downgrade() -> None:
    op.drop_table("saved_foods")
