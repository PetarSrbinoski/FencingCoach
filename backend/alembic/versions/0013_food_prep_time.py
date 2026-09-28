"""Optional preparation time for constrained meal drafts."""

from alembic import op
import sqlalchemy as sa

revision = "0013_food_prep_time"
down_revision = "0012_coach_plan_proposals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("saved_foods", sa.Column("prep_time_min", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("saved_foods", "prep_time_min")
