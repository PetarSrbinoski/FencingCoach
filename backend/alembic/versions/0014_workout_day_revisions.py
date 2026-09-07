"""Guard workout undo across later resets to automatic sessions."""

from alembic import op
import sqlalchemy as sa

revision = "0014_workout_day_revisions"
down_revision = "0013_food_prep_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workout_day_revisions",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("revision", sa.String(32), nullable=False),
    )
    op.add_column("agent_actions", sa.Column("resource_revision", sa.String(32)))
    op.execute("INSERT INTO workout_day_revisions (day, revision) SELECT day, revision FROM workout_overrides")
    op.execute("""UPDATE agent_actions SET resource_revision = after->>'revision'
                  WHERE kind = 'workout' AND after IS NOT NULL""")


def downgrade() -> None:
    op.drop_column("agent_actions", "resource_revision")
    op.drop_table("workout_day_revisions")
