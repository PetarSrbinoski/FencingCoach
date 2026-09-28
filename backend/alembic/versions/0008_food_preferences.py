"""Keep soft food preferences separate from hard dietary restrictions."""

from alembic import op
import sqlalchemy as sa

revision = "0008_food_preferences"
down_revision = "0007_nutrition_log_revision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("athlete_profile", sa.Column("food_preferences", sa.Text()))


def downgrade() -> None:
    op.drop_column("athlete_profile", "food_preferences")
