"""Track diary revisions and repeated-meal requests."""

from alembic import op
import sqlalchemy as sa

revision = "0007_nutrition_log_revision"
down_revision = "0006_saved_foods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("nutrition_log", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("nutrition_log", sa.Column("repeat_request_id", sa.String(100)))
    op.create_unique_constraint("uq_nutrition_log_repeat_request_id", "nutrition_log", ["repeat_request_id"])


def downgrade() -> None:
    op.drop_constraint("uq_nutrition_log_repeat_request_id", "nutrition_log", type_="unique")
    op.drop_column("nutrition_log", "repeat_request_id")
    op.drop_column("nutrition_log", "version")
