"""observation provenance: licence class, attribution, source refresh time, staleness and completeness flags

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-24 12:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('observation', sa.Column('origin_source', sa.String(length=200), nullable=True))
    op.add_column('observation', sa.Column('licence_class', sa.String(length=40), nullable=True))
    op.add_column('observation', sa.Column('attribution_text', sa.Text(), nullable=True))
    op.add_column('observation', sa.Column('source_refreshed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('observation', sa.Column('staleness_flag', sa.String(length=20), nullable=True))
    op.add_column('observation', sa.Column('completeness_flag', sa.String(length=20), nullable=True))
    op.create_check_constraint('ck_observation_staleness', 'observation', "staleness_flag IS NULL OR staleness_flag IN ('fresh', 'stale', 'unknown')")
    op.create_check_constraint('ck_observation_completeness', 'observation', "completeness_flag IS NULL OR completeness_flag IN ('complete', 'partial', 'estimated', 'absent')")


def downgrade() -> None:
    op.drop_constraint('ck_observation_completeness', 'observation')
    op.drop_constraint('ck_observation_staleness', 'observation')
    for c in ('completeness_flag', 'staleness_flag', 'source_refreshed_at', 'attribution_text', 'licence_class', 'origin_source'):
        op.drop_column('observation', c)
