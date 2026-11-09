import json

import pytest
from alembic import command
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app import seed
from app.models import Base


def count(conn, table):
    return conn.execute(text(f'SELECT count(*) FROM "{table}"')).scalar_one()


def test_every_model_table_exists_after_migration(engine):
    with engine.connect() as c:
        have = {r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
    assert set(Base.metadata.tables) <= have


def test_migration_is_reversible(scratch_db, alembic_cfg):
    cfg = alembic_cfg(scratch_db)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    eng = create_engine(scratch_db)
    with eng.connect() as c:
        left = {r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
    assert left <= {"alembic_version", "spatial_ref_sys"}
    command.upgrade(cfg, "head")
    eng.dispose()


def test_seed_loads_every_row(engine):
    inserted = seed.load(engine)
    expected = json.loads(seed.SEED_FILE.read_text())
    assert inserted == {name: len(rows) for name, rows in expected.items() if rows}
    with engine.connect() as c:
        assert count(c, "alert") == 4
        assert count(c, "supply_edge") == 13


def test_seed_is_idempotent(engine):
    seed.load(engine)
    again = seed.load(engine)
    assert sum(again.values()) == 0
    with engine.connect() as c:
        assert count(c, "audit_event") == 1
        assert count(c, "action_status_history") == 8


def test_seed_reset_reloads(seeded):
    result = seed.load(seeded, reset=True)
    assert result["alert"] == 4
    with seeded.connect() as c:
        assert count(c, "alert") == 4


def test_assumption_cannot_be_decided_by_its_proposer(seeded):
    with pytest.raises(IntegrityError, match="maker_checker"):
        with seeded.begin() as c:
            c.execute(text("UPDATE assumption SET decided_by_id = proposed_by_id WHERE id = 'AS-W-1'"))


def test_only_one_active_assumption_per_alert(seeded):
    with pytest.raises(IntegrityError, match="uq_assumption_one_active"):
        with seeded.begin() as c:
            c.execute(text("""
                INSERT INTO assumption (id, alert_id, affected_share_pct, basis, proposed_by_id, proposed_by_name, proposed_at, status)
                VALUES ('AS-W-2', 'AL-W-001', 50, 'second', 'u-analyst-b', 'Risk Analyst B', now(), 'proposed')"""))


def test_superseded_assumption_does_not_block_a_new_one(seeded):
    with seeded.begin() as c:
        c.execute(text("UPDATE assumption SET status = 'superseded' WHERE id = 'AS-W-1'"))
        c.execute(text("""
            INSERT INTO assumption (id, alert_id, affected_share_pct, basis, proposed_by_id, proposed_by_name, proposed_at, status)
            VALUES ('AS-W-2', 'AL-W-001', 50, 'replacement', 'u-analyst-b', 'Risk Analyst B', now(), 'proposed')"""))
        assert count(c, "assumption") == 3


def test_audit_events_cannot_be_changed(seeded):
    with pytest.raises(DBAPIError, match="append-only"):
        with seeded.begin() as c:
            c.execute(text("UPDATE audit_event SET detail = 'edited'"))
    with pytest.raises(DBAPIError, match="append-only"):
        with seeded.begin() as c:
            c.execute(text("DELETE FROM audit_event"))
    with seeded.begin() as c:  # appending is allowed
        c.execute(text("INSERT INTO audit_event (at, actor, event, ref) VALUES (now(), 'test', 'x', 'y')"))


def test_action_must_point_at_an_existing_assessment_snapshot(seeded):
    with pytest.raises(IntegrityError, match="fk|foreign key"):
        with seeded.begin() as c:
            c.execute(text("""
                INSERT INTO action (id, alert_id, commodity, option_id, owner_id, owner_name, target_date, rationale,
                                    status, created_at, created_by, assessment_version, assumption_status)
                VALUES ('AC-X', 'AL-W-001', 'wheat', 'O-W-1', 'u', 'U', '2026-12-01', 'r', 'open', now(), 'me', 99, 'none')"""))


def test_alert_must_reference_an_existing_rule_version(seeded):
    with pytest.raises(IntegrityError):
        with seeded.begin() as c:
            c.execute(text("UPDATE alert SET rule_v = '9.9' WHERE id = 'AL-W-001'"))


def test_one_published_version_per_rule(seeded):
    with pytest.raises(IntegrityError, match="uq_rule_one_published"):
        with seeded.begin() as c:
            c.execute(text("UPDATE rule_version SET status = 'published' WHERE rule_id = 'R-W-EXP' AND v = '1.1'"))


def test_edges_reject_self_loops_and_duplicates(seeded):
    with pytest.raises(IntegrityError, match="not_self"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO supply_edge (id, from_node, to_node, material, source, confidence, effective_from) "
                           "VALUES ('x', 'w-milly', 'w-milly', 'm', 's', 'low', '2026-01-01')"))
    with pytest.raises(IntegrityError, match="supply_edge_identity"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO supply_edge (id, from_node, to_node, material, source, confidence, effective_from) "
                           "SELECT 'dup', from_node, to_node, material, source, confidence, effective_from FROM supply_edge WHERE id = 'e1'"))


def test_same_import_file_cannot_be_committed_twice(seeded):
    row = "INSERT INTO import_record (id, dataset, version, rows, rejected, checksum, committed_by, committed_at) VALUES ('{}', 'price', {}, 1, 0, 'abc', 'x', now())"
    with seeded.begin() as c:
        c.execute(text(row.format("IMP-1", 1)))
    with pytest.raises(IntegrityError, match="dataset_checksum"):
        with seeded.begin() as c:
            c.execute(text(row.format("IMP-2", 2)))


def test_traversal_with_cycle_guard_terminates(seeded):
    """The wheat network has a cycle (Mill Y <-> Trader Q). A depth-bounded recursive query with a path guard must stop."""
    query = text("""
        WITH RECURSIVE walk(node_id, depth, path) AS (
            SELECT CAST(:focus AS text), 0, ARRAY[CAST(:focus AS text)]
          UNION ALL
            SELECT e.to_node, w.depth + 1, w.path || e.to_node
            FROM walk w JOIN supply_edge e ON e.from_node = w.node_id
            WHERE w.depth < 5 AND NOT e.to_node = ANY (w.path)
        )
        SELECT DISTINCT node_id FROM walk ORDER BY node_id""")
    with seeded.connect() as c:
        reached = [r[0] for r in c.execute(query, {"focus": "w-milly"})]
    assert reached == ["w-milly", "w-plantz", "w-prodp", "w-traderq"]
