"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-09 06:28:54.167941
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('audit_event',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor', sa.String(length=200), nullable=False),
    sa.Column('event', sa.String(length=100), nullable=False),
    sa.Column('ref', sa.String(length=100), nullable=False),
    sa.Column('detail', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_at', 'audit_event', ['at'], unique=False)
    op.create_index('ix_audit_ref', 'audit_event', ['ref'], unique=False)
    op.create_table('commodity_form',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.Column('form', sa.String(length=100), nullable=False),
    sa.Column('note', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_commodity_form_commodity'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('commodity', 'form')
    )
    op.create_table('country',
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.PrimaryKeyConstraint('code'),
    sa.UniqueConstraint('name')
    )
    op.create_table('evidence',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=False),
    sa.Column('object_key', sa.String(length=500), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('scenario_run', sa.String(length=100), nullable=True),
    sa.CheckConstraint("mode IN ('live', 'replay', 'simulated')", name='ck_evidence_mode'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('object_key')
    )
    op.create_table('import_record',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('dataset', sa.String(length=40), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('rows', sa.Integer(), nullable=False),
    sa.Column('rejected', sa.Integer(), nullable=False),
    sa.Column('checksum', sa.String(length=64), nullable=False),
    sa.Column('committed_by', sa.String(length=200), nullable=False),
    sa.Column('committed_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dataset', 'checksum'),
    sa.UniqueConstraint('dataset', 'version')
    )
    op.create_table('node',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('tier', sa.String(length=20), nullable=True),
    sa.Column('country', sa.String(length=100), nullable=False),
    sa.Column('site', sa.String(length=200), nullable=True),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_node_commodity'),
    sa.CheckConstraint("kind IN ('origin', 'supplier', 'plant', 'product')", name='ck_node_kind'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_node_commodity', 'node', ['commodity'], unique=False)
    op.create_table('rule',
    sa.Column('id', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_rule_commodity'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('source',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('last_attempt', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_usable', sa.DateTime(timezone=True), nullable=True),
    sa.Column('policy_hours', sa.Integer(), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.CheckConstraint("mode IN ('live', 'replay', 'simulated')", name='ck_source_mode'),
    sa.CheckConstraint('policy_hours > 0', name='ck_source_policy'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('unit_conversion',
    sa.Column('id', sa.String(length=20), nullable=False),
    sa.Column('from_unit', sa.String(length=60), nullable=False),
    sa.Column('to_unit', sa.String(length=60), nullable=False),
    sa.Column('factor', sa.Numeric(precision=18, scale=8), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=False),
    sa.CheckConstraint('factor > 0', name='ck_unit_conversion_factor'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('from_unit', 'to_unit', 'effective_from')
    )
    op.create_table('country_alias',
    sa.Column('alias', sa.String(length=100), nullable=False),
    sa.Column('country_code', sa.String(length=8), nullable=False),
    sa.ForeignKeyConstraint(['country_code'], ['country.code'], ),
    sa.PrimaryKeyConstraint('alias')
    )
    op.create_table('dead_letter',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('object_key', sa.String(length=500), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('ingestion_run',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('accepted', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('duplicate', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('quarantined', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('note', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.CheckConstraint("status IN ('ok', 'partial', 'failed')", name='ck_ingestion_run_status'),
    sa.CheckConstraint('accepted >= 0 AND duplicate >= 0 AND quarantined >= 0', name='ck_ingestion_run_counts'),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ingestion_run_source_started', 'ingestion_run', ['source_id', 'started_at'], unique=False)
    op.create_table('quarantine_item',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('run_id', sa.String(length=60), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('source_row', sa.String(length=200), nullable=False),
    sa.Column('object_key', sa.String(length=500), nullable=False),
    sa.Column('field', sa.String(length=100), server_default=sa.text("''"), nullable=False),
    sa.Column('bad_value', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.Column('status', sa.String(length=30), server_default=sa.text("'quarantined'"), nullable=False),
    sa.Column('correction', sa.Text(), nullable=True),
    sa.CheckConstraint("status IN ('quarantined', 'replay_requested')", name='ck_quarantine_status'),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_quarantine_status', 'quarantine_item', ['status'], unique=False)
    op.create_table('rule_version',
    sa.Column('rule_id', sa.String(length=20), nullable=False),
    sa.Column('v', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('thresholds', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_by', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('published_by', sa.String(length=200), nullable=True),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('draft', 'published', 'superseded')", name='ck_rule_version_status'),
    sa.ForeignKeyConstraint(['rule_id'], ['rule.id'], ),
    sa.PrimaryKeyConstraint('rule_id', 'v')
    )
    op.create_index('uq_rule_one_draft', 'rule_version', ['rule_id'], unique=True, postgresql_where=sa.text("status = 'draft'"))
    op.create_index('uq_rule_one_published', 'rule_version', ['rule_id'], unique=True, postgresql_where=sa.text("status = 'published'"))
    op.create_table('source_commodity',
    sa.Column('source_id', sa.String(length=40), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_source_commodity_commodity'),
    sa.ForeignKeyConstraint(['source_id'], ['source.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('source_id', 'commodity')
    )
    op.create_table('supply_edge',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('from_node', sa.String(length=40), nullable=False),
    sa.Column('to_node', sa.String(length=40), nullable=False),
    sa.Column('material', sa.String(length=200), nullable=False),
    sa.Column('source', sa.String(length=200), nullable=False),
    sa.Column('confidence', sa.String(length=20), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('uncertain', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.CheckConstraint("confidence IN ('low', 'medium', 'high')", name='ck_supply_edge_confidence'),
    sa.CheckConstraint('effective_to IS NULL OR effective_to >= effective_from', name='ck_supply_edge_dates'),
    sa.CheckConstraint('from_node <> to_node', name='ck_supply_edge_not_self'),
    sa.ForeignKeyConstraint(['from_node'], ['node.id'], ),
    sa.ForeignKeyConstraint(['to_node'], ['node.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('from_node', 'to_node', 'material', 'effective_from', name='uq_supply_edge_identity')
    )
    op.create_index('ix_supply_edge_from', 'supply_edge', ['from_node'], unique=False)
    op.create_index('ix_supply_edge_to', 'supply_edge', ['to_node'], unique=False)
    op.create_table('alert',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('location', sa.String(length=200), nullable=False),
    sa.Column('severity', sa.String(length=20), nullable=False),
    sa.Column('confidence', sa.String(length=20), nullable=False),
    sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('scenario_run', sa.String(length=100), nullable=True),
    sa.Column('assessment_status', sa.String(length=30), nullable=False),
    sa.Column('disposition', sa.String(length=20), server_default=sa.text("'new'"), nullable=False),
    sa.Column('rule_id', sa.String(length=20), nullable=False),
    sa.Column('rule_v', sa.String(length=20), nullable=False),
    sa.Column('rule_inputs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('evidence_id', sa.String(length=40), nullable=False),
    sa.CheckConstraint("assessment_status IN ('unassessed', 'partial', 'complete', 'awaiting_validation')", name='ck_alert_assessment_status'),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_alert_commodity'),
    sa.CheckConstraint("confidence IN ('low', 'medium', 'high')", name='ck_alert_confidence'),
    sa.CheckConstraint("disposition IN ('new', 'confirmed', 'monitor', 'dismissed')", name='ck_alert_disposition'),
    sa.CheckConstraint("mode IN ('live', 'replay', 'simulated')", name='ck_alert_mode'),
    sa.CheckConstraint("severity IN ('low', 'medium', 'high', 'critical')", name='ck_alert_severity'),
    sa.ForeignKeyConstraint(['evidence_id'], ['evidence.id'], ),
    sa.ForeignKeyConstraint(['rule_id', 'rule_v'], ['rule_version.rule_id', 'rule_version.v'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_alert_commodity_observed', 'alert', ['commodity', 'observed_at'], unique=False)
    op.create_table('alert_exposed_node',
    sa.Column('alert_id', sa.String(length=40), nullable=False),
    sa.Column('node_id', sa.String(length=40), nullable=False),
    sa.Column('position', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.ForeignKeyConstraint(['alert_id'], ['alert.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['node_id'], ['node.id'], ),
    sa.PrimaryKeyConstraint('alert_id', 'node_id')
    )
    op.create_table('assumption',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('alert_id', sa.String(length=40), nullable=False),
    sa.Column('affected_share_pct', sa.Numeric(precision=5, scale=2), nullable=False),
    sa.Column('basis', sa.Text(), nullable=False),
    sa.Column('proposed_by_id', sa.String(length=100), nullable=False),
    sa.Column('proposed_by_name', sa.String(length=200), nullable=False),
    sa.Column('proposed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('decided_by_id', sa.String(length=100), nullable=True),
    sa.Column('decided_by_name', sa.String(length=200), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decision_note', sa.Text(), nullable=True),
    sa.CheckConstraint("status IN ('proposed', 'approved', 'rejected', 'superseded')", name='ck_assumption_status'),
    sa.CheckConstraint('affected_share_pct >= 0 AND affected_share_pct <= 100', name='ck_assumption_share'),
    sa.CheckConstraint('decided_by_id IS NULL OR decided_by_id <> proposed_by_id', name='ck_assumption_maker_checker'),
    sa.ForeignKeyConstraint(['alert_id'], ['alert.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_assumption_one_active', 'assumption', ['alert_id'], unique=True, postgresql_where=sa.text("status IN ('proposed', 'approved')"))
    op.create_table('response_option',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('alert_id', sa.String(length=40), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('qualification', sa.String(length=20), nullable=False),
    sa.Column('spec_fit', sa.String(length=20), nullable=False),
    sa.Column('capacity', sa.String(length=200), nullable=False),
    sa.Column('unit_price', sa.Numeric(precision=18, scale=4), nullable=True),
    sa.Column('quantity_available', sa.Numeric(precision=18, scale=4), nullable=True),
    sa.Column('lead_time_days', sa.Integer(), nullable=False),
    sa.Column('quote_valid_until', sa.Date(), nullable=True),
    sa.Column('note', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.CheckConstraint("qualification IN ('qualified', 'unknown', 'expired')", name='ck_response_option_qualification'),
    sa.CheckConstraint("spec_fit IN ('meets', 'partial', 'unknown')", name='ck_response_option_spec_fit'),
    sa.CheckConstraint("type IN ('sourcing', 'inventory', 'logistics')", name='ck_response_option_type'),
    sa.CheckConstraint('lead_time_days >= 0', name='ck_response_option_lead'),
    sa.CheckConstraint('unit_price IS NULL OR unit_price >= 0', name='ck_response_option_price'),
    sa.ForeignKeyConstraint(['alert_id'], ['alert.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_response_option_alert', 'response_option', ['alert_id'], unique=False)
    op.create_table('assessment',
    sa.Column('alert_id', sa.String(length=40), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('note', sa.Text(), nullable=False),
    sa.Column('calc_version', sa.String(length=40), nullable=False),
    sa.Column('assumption_id', sa.String(length=40), nullable=True),
    sa.Column('exposed_value', sa.Numeric(precision=18, scale=4), nullable=False),
    sa.Column('exposed_unit', sa.String(length=40), nullable=False),
    sa.Column('exposed_horizon', sa.String(length=40), nullable=False),
    sa.Column('reference_option_id', sa.String(length=40), nullable=False),
    sa.Column('inputs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('paths', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('missing', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.CheckConstraint('version >= 1', name='ck_assessment_version'),
    sa.ForeignKeyConstraint(['alert_id'], ['alert.id'], ),
    sa.ForeignKeyConstraint(['assumption_id'], ['assumption.id'], ),
    sa.ForeignKeyConstraint(['reference_option_id'], ['response_option.id'], ),
    sa.PrimaryKeyConstraint('alert_id', 'version')
    )
    op.create_table('action',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('alert_id', sa.String(length=40), nullable=False),
    sa.Column('commodity', sa.String(length=20), nullable=False),
    sa.Column('option_id', sa.String(length=40), nullable=False),
    sa.Column('owner_id', sa.String(length=100), nullable=False),
    sa.Column('owner_name', sa.String(length=200), nullable=False),
    sa.Column('target_date', sa.Date(), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'open'"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by', sa.String(length=200), nullable=False),
    sa.Column('assessment_version', sa.Integer(), nullable=False),
    sa.Column('assumption_status', sa.String(length=20), nullable=False),
    sa.CheckConstraint("assumption_status IN ('proposed', 'approved', 'rejected', 'superseded', 'none')", name='ck_action_assumption_status'),
    sa.CheckConstraint("commodity IN ('wheat', 'tungsten')", name='ck_action_commodity'),
    sa.CheckConstraint("status IN ('open', 'in_progress', 'review', 'done')", name='ck_action_status'),
    sa.ForeignKeyConstraint(['alert_id', 'assessment_version'], ['assessment.alert_id', 'assessment.version'], ),
    sa.ForeignKeyConstraint(['option_id'], ['response_option.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_action_commodity_status', 'action', ['commodity', 'status'], unique=False)
    op.create_index('ix_action_owner', 'action', ['owner_id'], unique=False)
    op.create_table('action_status_history',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('action_id', sa.String(length=40), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor', sa.String(length=200), nullable=False),
    sa.Column('from_status', sa.String(length=20), nullable=True),
    sa.Column('to_status', sa.String(length=20), nullable=False),
    sa.Column('note', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.CheckConstraint("from_status IS NULL OR from_status IN ('open', 'in_progress', 'review', 'done')", name='ck_action_history_from'),
    sa.CheckConstraint("to_status IN ('open', 'in_progress', 'review', 'done')", name='ck_action_history_to'),
    sa.ForeignKeyConstraint(['action_id'], ['action.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_action_history_action', 'action_status_history', ['action_id', 'at'], unique=False)

    # Audit events are append-only: reject UPDATE and DELETE.
    op.execute("""
        CREATE FUNCTION audit_event_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_event is append-only';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER audit_event_no_change
        BEFORE UPDATE OR DELETE ON audit_event
        FOR EACH ROW EXECUTE FUNCTION audit_event_immutable()
    """)


def downgrade() -> None:
    op.execute('DROP TRIGGER audit_event_no_change ON audit_event')
    op.execute('DROP FUNCTION audit_event_immutable()')
    op.drop_index('ix_action_history_action', table_name='action_status_history')
    op.drop_table('action_status_history')
    op.drop_index('ix_action_owner', table_name='action')
    op.drop_index('ix_action_commodity_status', table_name='action')
    op.drop_table('action')
    op.drop_table('assessment')
    op.drop_index('ix_response_option_alert', table_name='response_option')
    op.drop_table('response_option')
    op.drop_index('uq_assumption_one_active', table_name='assumption', postgresql_where=sa.text("status IN ('proposed', 'approved')"))
    op.drop_table('assumption')
    op.drop_table('alert_exposed_node')
    op.drop_index('ix_alert_commodity_observed', table_name='alert')
    op.drop_table('alert')
    op.drop_index('ix_supply_edge_to', table_name='supply_edge')
    op.drop_index('ix_supply_edge_from', table_name='supply_edge')
    op.drop_table('supply_edge')
    op.drop_table('source_commodity')
    op.drop_index('uq_rule_one_published', table_name='rule_version', postgresql_where=sa.text("status = 'published'"))
    op.drop_index('uq_rule_one_draft', table_name='rule_version', postgresql_where=sa.text("status = 'draft'"))
    op.drop_table('rule_version')
    op.drop_index('ix_quarantine_status', table_name='quarantine_item')
    op.drop_table('quarantine_item')
    op.drop_index('ix_ingestion_run_source_started', table_name='ingestion_run')
    op.drop_table('ingestion_run')
    op.drop_table('dead_letter')
    op.drop_table('country_alias')
    op.drop_table('unit_conversion')
    op.drop_table('source')
    op.drop_table('rule')
    op.drop_index('ix_node_commodity', table_name='node')
    op.drop_table('node')
    op.drop_table('import_record')
    op.drop_table('evidence')
    op.drop_table('country')
    op.drop_table('commodity_form')
    op.drop_index('ix_audit_ref', table_name='audit_event')
    op.drop_index('ix_audit_at', table_name='audit_event')
    op.drop_table('audit_event')
