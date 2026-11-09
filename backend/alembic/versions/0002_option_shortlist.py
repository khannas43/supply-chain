"""option shortlist

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-09 06:45:16.681027
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('option_shortlist',
    sa.Column('option_id', sa.String(length=40), nullable=False),
    sa.Column('shortlisted_by_id', sa.String(length=100), nullable=False),
    sa.Column('shortlisted_by_name', sa.String(length=200), nullable=False),
    sa.Column('shortlisted_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['option_id'], ['response_option.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('option_id')
    )


def downgrade() -> None:
    op.drop_table('option_shortlist')
