"""garmin_metric_extraction_status

Adds `status` (ok/missing/implausible) and `detail` to garmin_metrics so
extraction coverage/diagnostics can be computed from existing rows instead
of losing provenance when a field fails to parse.

Revision ID: 0002_garmin_status
Revises: 0001_baseline
Create Date: 2026-07-03 21:54:14.563495
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002_garmin_status"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default only needed to backfill any existing rows; the ORM
    # itself only has a client-side default, so drop it right after.
    op.add_column(
        "garmin_metrics",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ok"),
    )
    op.add_column("garmin_metrics", sa.Column("detail", sa.Text(), nullable=True))
    op.alter_column("garmin_metrics", "status", server_default=None)


def downgrade() -> None:
    op.drop_column("garmin_metrics", "detail")
    op.drop_column("garmin_metrics", "status")
