"""ingestion tables

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-09 07:03:26.023097
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('outbox',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('topic', sa.String(length=60), nullable=False),
    sa.Column('key', sa.String(length=100), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('available_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('pending', 'done', 'dead')", name='ck_outbox_status'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('topic', 'key', name='uq_outbox_topic_key')
    )
    op.create_index('ix_outbox_ready', 'outbox', ['status', 'available_at'], unique=False)
    op.create_table('ingestion',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('evidence_id', sa.String(length=40), nullable=False),
    sa.Column('object_key', sa.String(length=500), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('scenario_run', sa.String(length=100), nullable=True),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'received'"), nullable=False),
    sa.Column('records', sa.Integer(), nullable=True),
    sa.Column('mapping_version', sa.String(length=60), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.CheckConstraint("mode IN ('live', 'replay', 'simulated')", name='ck_ingestion_mode'),
    sa.CheckConstraint("status IN ('received', 'processed', 'failed')", name='ck_ingestion_status'),
    sa.ForeignKeyConstraint(['evidence_id'], ['evidence.id'], ),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_id', 'sha256', name='uq_ingestion_source_sha')
    )
    op.create_table('observation',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('ingestion_id', sa.String(length=40), nullable=False),
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('record_id', sa.String(length=100), nullable=False),
    sa.Column('record_sha256', sa.String(length=64), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('event_type', sa.String(length=60), nullable=False),
    sa.Column('country', sa.String(length=100), nullable=False),
    sa.Column('value', sa.Numeric(precision=18, scale=4), nullable=True),
    sa.Column('headline', sa.Text(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('confidence_pct', sa.Integer(), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('scenario_run', sa.String(length=100), nullable=True),
    sa.Column('mapping_version', sa.String(length=60), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('outcome', sa.String(length=30), nullable=False),
    sa.Column('alert_id', sa.String(length=40), nullable=True),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_observation_commodity'),
    sa.CheckConstraint("mode IN ('live', 'replay', 'simulated')", name='ck_observation_mode'),
    sa.CheckConstraint("outcome IN ('alert_raised', 'merged', 'no_rule_match', 'below_threshold', 'late')", name='ck_observation_outcome'),
    sa.CheckConstraint('confidence_pct >= 0 AND confidence_pct <= 100', name='ck_observation_confidence'),
    sa.ForeignKeyConstraint(['alert_id'], ['alert.id'], ),
    sa.ForeignKeyConstraint(['ingestion_id'], ['ingestion.id'], ),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_id', 'record_id', name='uq_observation_source_record')
    )
    op.create_index('ix_observation_lookup', 'observation', ['source_id', 'country', 'kind', 'published_at'], unique=False)
    op.add_column('quarantine_item', sa.Column('ingestion_id', sa.String(length=40), nullable=True))
    op.add_column('quarantine_item', sa.Column('record_json', sa.Text(), nullable=True))
    op.drop_constraint('ck_quarantine_status', 'quarantine_item', type_='check')
    op.create_check_constraint('ck_quarantine_status', 'quarantine_item', "status IN ('quarantined', 'replay_requested', 'resolved')")
    op.create_foreign_key(None, 'quarantine_item', 'ingestion', ['ingestion_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('ck_quarantine_status', 'quarantine_item', type_='check')
    op.create_check_constraint('ck_quarantine_status', 'quarantine_item', "status IN ('quarantined', 'replay_requested')")
    op.drop_constraint('quarantine_item_ingestion_id_fkey', 'quarantine_item', type_='foreignkey')
    op.drop_column('quarantine_item', 'record_json')
    op.drop_column('quarantine_item', 'ingestion_id')
    op.drop_index('ix_observation_lookup', table_name='observation')
    op.drop_table('observation')
    op.drop_table('ingestion')
    op.drop_index('ix_outbox_ready', table_name='outbox')
    op.drop_table('outbox')
