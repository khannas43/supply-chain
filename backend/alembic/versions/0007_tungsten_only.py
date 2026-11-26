"""tungsten only: remove wheat data and narrow the commodity checks

Wheat is out of scope for the MVP. This deletes wheat business rows in dependency order, then replaces the
seven commodity CHECK constraints. audit_event rows are append-only (a trigger forbids deleting them), so past
audit entries that mention wheat stay as history. Evidence files and ingestion records are left in place.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-24 14:00:00
"""
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

CHECKS = [
    ('commodity_form', 'ck_commodity_form_commodity'), ('source_commodity', 'ck_source_commodity_commodity'),
    ('rule', 'ck_rule_commodity'), ('node', 'ck_node_commodity'), ('alert', 'ck_alert_commodity'),
    ('action', 'ck_action_commodity'), ('observation', 'ck_observation_commodity'),
]

W_ALERTS = "(SELECT id FROM alert WHERE commodity = 'wheat')"
W_NODES = "(SELECT id FROM node WHERE commodity = 'wheat')"
W_RULES = "(SELECT id FROM rule WHERE commodity = 'wheat')"


def upgrade() -> None:
    op.execute("DELETE FROM action WHERE commodity = 'wheat'")  # status history cascades
    op.execute(f"DELETE FROM assessment WHERE alert_id IN {W_ALERTS}")
    op.execute(f"DELETE FROM assumption WHERE alert_id IN {W_ALERTS}")
    op.execute(f"DELETE FROM response_option WHERE alert_id IN {W_ALERTS}")  # shortlist rows cascade
    op.execute("DELETE FROM observation WHERE commodity = 'wheat'")
    op.execute("DELETE FROM alert WHERE commodity = 'wheat'")  # exposed nodes cascade
    op.execute(f"DELETE FROM alert_exposed_node WHERE node_id IN {W_NODES}")
    op.execute(f"DELETE FROM supply_edge WHERE from_node IN {W_NODES} OR to_node IN {W_NODES}")
    op.execute("DELETE FROM node WHERE commodity = 'wheat'")
    op.execute(f"DELETE FROM rule_version WHERE rule_id IN {W_RULES}")
    op.execute("DELETE FROM rule WHERE commodity = 'wheat'")
    op.execute("DELETE FROM source_commodity WHERE commodity = 'wheat'")
    op.execute("DELETE FROM commodity_form WHERE commodity = 'wheat'")
    op.execute("DELETE FROM unit_conversion WHERE from_unit LIKE 'bushel (wheat%'")
    op.execute("DELETE FROM person WHERE id = 'u-analyst-wheat'")
    # the logistics feed served wheat only; it now serves tungsten
    op.execute("INSERT INTO source_commodity (source_id, commodity) SELECT 'src-logistics', 'tungsten' WHERE EXISTS (SELECT 1 FROM source WHERE id = 'src-logistics') ON CONFLICT DO NOTHING")
    for table, name in CHECKS:
        op.drop_constraint(name, table)
        op.create_check_constraint(name, table, "commodity IN ('tungsten')")


def downgrade() -> None:
    for table, name in CHECKS:
        op.drop_constraint(name, table)
        op.create_check_constraint(name, table, "commodity IN ('wheat', 'tungsten')")
