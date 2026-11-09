"""simulator and import content

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-09 06:53:14.899909
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('sim_run',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('scenario_id', sa.String(length=40), nullable=False),
    sa.Column('seed', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('active_slot', sa.Integer(), nullable=True),
    sa.Column('offset_hours', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('emitted', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_by', sa.String(length=200), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("(status = 'ended') = (active_slot IS NULL)", name='ck_sim_run_slot'),
    sa.CheckConstraint("status IN ('running', 'paused', 'ended')", name='ck_sim_run_status'),
    sa.CheckConstraint('offset_hours >= 0 AND emitted >= 0', name='ck_sim_run_counts'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('active_slot', name='uq_sim_one_active_run')
    )
    op.create_table('sim_log',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('run_id', sa.String(length=40), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['run_id'], ['sim_run.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sim_log_run', 'sim_log', ['run_id', 'id'], unique=False)
    op.add_column('import_record', sa.Column('applied', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('import_record', sa.Column('content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('import_record', 'content')
    op.drop_column('import_record', 'applied')
    op.drop_index('ix_sim_log_run', table_name='sim_log')
    op.drop_table('sim_log')
    op.drop_table('sim_run')
