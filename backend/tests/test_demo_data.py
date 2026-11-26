"""The demo data (seed/demo.json) checked against the real engine: validators, rules, traversal, calculations."""

import json
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import alerting, clock, processing, seed, storage, worker
from app.models import Observation

DEMO = seed.SEED_FILE
ANALYST = {"X-Actor-Id": "u-analyst-a", "X-Actor-Name": "Risk Analyst A", "X-Actor-Role": "analyst"}
STEWARD = {"X-Actor-Id": "u-steward", "X-Actor-Name": "Data Steward", "X-Actor-Role": "steward"}


@pytest.fixture
def demo(engine):
    seed.load(engine, path=DEMO)
    return engine


@pytest.fixture
def demo_client(demo):
    from fastapi.testclient import TestClient

    from app.deps import get_session
    from app.main import app

    def override():
        with Session(demo) as s:
            yield s

    app.dependency_overrides[get_session] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


def rows(engine, sql, **p):
    with engine.connect() as c:
        return [tuple(r) for r in c.execute(text(sql), p)]


def test_loads_and_reloads_cleanly(engine):
    first = seed.load(engine, path=DEMO)
    assert sum(first.values()) > 400
    assert sum(seed.load(engine, path=DEMO).values()) == 0  # nothing duplicated
    assert sum(seed.load(engine, path=DEMO, reset=True).values()) == sum(first.values())


def test_there_is_enough_of_it(demo):
    q = lambda sql: rows(demo, sql)[0][0]
    for commodity in ("tungsten",):
        assert q(f"SELECT count(*) FROM node WHERE commodity = '{commodity}'") >= 35
        assert q(f"SELECT count(*) FROM alert WHERE commodity = '{commodity}'") >= 6
        assert q(f"SELECT count(DISTINCT country) FROM node WHERE commodity = '{commodity}'") >= 8
        assert q(f"SELECT count(*) FROM action WHERE commodity = '{commodity}'") >= 5
    assert q("SELECT count(*) FROM supply_edge") >= 50
    assert q("SELECT count(DISTINCT status) FROM action") == 4  # open, in progress, review and done all appear
    assert {r[0] for r in rows(demo, "SELECT DISTINCT disposition FROM alert")} == {"new", "confirmed", "monitor", "dismissed"}
    assert {r[0] for r in rows(demo, "SELECT DISTINCT status FROM assumption")} == {"proposed", "approved", "rejected", "superseded"}
    assert {r[0] for r in rows(demo, "SELECT DISTINCT outcome FROM observation")} == {"alert_raised", "merged", "no_rule_match", "below_threshold", "late"}
    assert {r[0] for r in rows(demo, "SELECT DISTINCT mode FROM alert")} == {"simulated", "replay"}


def test_every_place_is_a_known_country(demo):
    unknown = rows(demo, """SELECT DISTINCT n.country FROM node n WHERE n.country NOT IN (SELECT name FROM country)
                            AND n.country NOT IN (SELECT alias FROM country_alias)""")
    assert unknown == []


def test_the_networks_are_connected_and_contain_a_loop(demo):
    for commodity in ("tungsten",):
        isolated = rows(demo, f"""SELECT id FROM node n WHERE commodity = '{commodity}'
                                  AND NOT EXISTS (SELECT 1 FROM supply_edge e WHERE e.from_node = n.id OR e.to_node = n.id)""")
        assert isolated == []
        assert rows(demo, f"SELECT count(*) FROM node WHERE commodity = '{commodity}' AND kind = 'product' AND id NOT IN (SELECT to_node FROM supply_edge)")[0][0] == 0
        assert rows(demo, f"SELECT count(*) FROM node WHERE commodity = '{commodity}' AND kind = 'origin' AND id NOT IN (SELECT from_node FROM supply_edge)")[0][0] == 0
    from app import network

    with Session(demo) as s:
        assert network.traverse(s, "t-rottmet", "downstream", 3).cycle_edge_ids


def test_alert_exposure_is_what_the_engine_would_find(demo):
    with Session(demo) as s:
        for alert_id, commodity, country in rows(demo, "SELECT id, commodity, location FROM alert"):
            stored = [r[0] for r in rows(demo, "SELECT node_id FROM alert_exposed_node WHERE alert_id = :a ORDER BY position", a=alert_id)]
            assert stored == alerting.exposed_nodes(s, commodity, country), alert_id
    assert rows(demo, "SELECT count(*) FROM alert_exposed_node WHERE alert_id IN ('AL-T-004', 'AL-T-005')")[0][0] == 0  # a price move matches no location


def test_alerts_follow_the_published_rules(demo):
    with Session(demo) as s:
        for obs in s.query(Observation).filter(Observation.outcome == "alert_raised"):
            spec = alerting.find_spec(obs)
            assert spec is not None, obs.id
            rule, version, thr = alerting.published_version(s, spec.rule)
            alert = s.get(__import__("app.models", fromlist=["Alert"]).Alert, obs.alert_id)
            assert (alert.rule_id, alert.rule_v) == (rule.id, version.v), obs.id
            assert alert.severity == alerting.SEVERITY[int(thr["sev"])] and alert.confidence == alerting.confidence_level(obs.confidence_pct)
            gate = {"confidence": obs.confidence_pct >= thr.get("conf", 0), "delay": (obs.value or 0) >= thr.get("delay", 0), "change": (obs.value or 0) >= thr.get("chg", 0)}[spec.gate]
            assert gate, f"{obs.id} should not have raised an alert"
        for obs in s.query(Observation).filter(Observation.outcome == "below_threshold"):
            spec = alerting.find_spec(obs)
            _, _, thr = alerting.published_version(s, spec.rule)
            passed = {"confidence": obs.confidence_pct >= thr.get("conf", 0), "delay": (obs.value or 0) >= thr.get("delay", 0), "change": (obs.value or 0) >= thr.get("chg", 0)}[spec.gate]
            assert not passed, f"{obs.id} should have raised an alert"
        for obs in s.query(Observation).filter(Observation.outcome == "no_rule_match"):
            assert alerting.find_spec(obs) is None


def test_every_stored_payload_passes_the_real_validators(demo):
    data = json.loads(DEMO.read_text())
    quarantined = {r["object_key"]: r["reason"] for r in data["quarantine_item"] if r["ingestion_id"]}
    for key, body in data["_evidence"].items():
        assert storage.get_store().get(key) == seed.canonical(body)  # written, byte for byte
        source = next(r["source_id"] for r in data["ingestion"] if r["object_key"] == key)
        for record in body["records"]:
            if key in quarantined:
                with pytest.raises(processing.RecordRejected) as err:
                    n = processing.normalise(source, record)
                    with Session(demo) as s:
                        processing.canonical_country(s, n.country) if n.country != "Global" else None
                assert err.value.reason.split(":")[0] == quarantined[key].split(":")[0], key
            else:
                n = processing.normalise(source, record)
                with Session(demo) as s:
                    if n.country != "Global":
                        processing.canonical_country(s, n.country)


def test_alerts_trace_back_to_openable_evidence(demo_client, demo):
    for alert in demo_client.get("/api/alerts").json():
        r = demo_client.get(f"/api/evidence/{alert['evidence']['id']}/raw", headers=ANALYST)
        assert r.status_code == 200, alert["id"]
        assert r.headers["x-content-sha256"] == alert["evidence"]["sha256"]
    chain = rows(demo, """SELECT a.id, o.id, i.id, e.id FROM alert a JOIN observation o ON o.alert_id = a.id AND o.outcome = 'alert_raised'
                          JOIN ingestion i ON i.id = o.ingestion_id JOIN evidence e ON e.id = i.evidence_id AND e.id = a.evidence_id""")
    assert len(chain) == 9  # every alert: alert, observation, ingestion, evidence


@pytest.mark.parametrize("alert_id, cover, at_risk, gap, cost", [
    ("AL-T-001", 68.75, 16.9, 6.25, 140270),
])
def test_assessed_alerts_calculate_what_was_designed(demo_client, alert_id, cover, at_risk, gap, cost):
    a = demo_client.get(f"/api/alerts/{alert_id}/assessment").json()
    c = a["calc"]
    assert c["reason"] is None and c["coverDays"] == pytest.approx(cover, abs=0.01) and c["atRisk"] == pytest.approx(at_risk)
    assert c["gapDays"] == pytest.approx(gap, abs=0.01) and c["incrementalCost"] == cost
    assert [v["v"] for v in a["versions"]] == [1, 2, 3]
    assert a["assumption"]["status"] == "approved" and a["paths"] and a["missing"]


def test_the_other_states_say_why_nothing_is_calculated(demo_client):
    pending = demo_client.get("/api/alerts/AL-T-002/assessment").json()["calc"]
    assert pending["atRisk"] is None and pending["reason"] == "The disruption assumption is awaiting approval." and pending["coverDays"] == pytest.approx(68.75)
    rejected = demo_client.get("/api/alerts/AL-T-007/assessment").json()["calc"]
    assert rejected["atRisk"] is None and rejected["reason"] == "The disruption assumption was rejected."
    assert demo_client.get("/api/alerts/AL-T-004/assessment").status_code == 404  # no assessment yet, not a zero


def test_response_options_cover_every_case(demo_client):
    r = demo_client.get("/api/alerts/AL-T-007/options").json()  # assumption rejected: nothing is calculated, options stay listed
    assert [(o["rank"], o["option"]["id"]) for o in r["ranked"]] == [(1, "O-T-12"), (2, "O-T-10")]
    assert all(o["gapDays"] is None for o in r["ranked"]) and [o["quoteStatus"] for o in r["ranked"]] == ["expiring", "expiring"]
    assert [o["option"]["id"] for o in r["complementary"]] == ["O-T-11"] and r["ineligible"] == []
    t = demo_client.get("/api/alerts/AL-T-001/options").json()
    assert t["assessmentVersion"] == 3 and [o["option"]["id"] for o in t["ineligible"]] == ["O-T-04"]
    # two options cover the gap completely (lead time under the 68.75 days of cover); the cheaper ranks first
    assert [(o["option"]["id"], o["gapDays"], o["incrementalCost"]) for o in t["ranked"]] == [
        ("O-T-02", 0.0, 184210.0), ("O-T-06", 0.0, 245050.0), ("O-T-01", pytest.approx(6.25), 140270.0), ("O-T-03", pytest.approx(21.25), pytest.approx(16.9 * 6400))]
    assert t["ranked"][1]["quoteStatus"] == "expiring"


def test_actions_show_every_flag(demo_client):
    actions = {a["id"]: a for a in demo_client.get("/api/actions").json()}
    assert len(actions) == 6 and {a["status"] for a in actions.values()} == {"open", "in_progress", "review", "done"}
    assert {i for i, a in actions.items() if a["overdue"]} == {"AC-T-002"}
    assert {i for i, a in actions.items() if a["reviewNeeded"]} == {"AC-T-002"}  # decided on an older assessment version
    assert all(not a["overdue"] and not a["reviewNeeded"] for a in actions.values() if a["status"] == "done")
    assert {a["ownerId"] for a in actions.values()} >= {"u-manager", "u-analyst-a", "u-analyst-b", "u-analyst-tungsten"}
    assert [h["to"] for h in actions["AC-T-003"]["history"]] == ["open", "in_progress", "done"]


def test_sources_show_every_health_state(demo_client):
    states = {s["id"]: s["state"] for s in demo_client.get("/api/sources").json()}
    assert states == {"src-policy": "fresh", "src-logistics": "stale", "src-price": "fresh", "src-import": "fresh"}


def test_the_overview_has_something_to_show(demo_client):
    t = demo_client.get("/api/overview?commodity=tungsten").json()
    assert t["activeAlerts"] == 7 and t["alertsBySeverity"] == {"critical": 3, "medium": 2, "low": 2}  # dismissed alerts are not active
    assert t["assessedAlerts"] == 3 and sum(p["count"] for p in t["trend"]) >= 4
    assert t["actions"] == {"open": 2, "inProgress": 2, "review": 1, "done": 1}


def test_quarantined_records_can_be_corrected_and_replayed(demo_client, demo):
    for item, correction in (("Q-0001", "Russia"), ("Q-0002", "Russia"), ("Q-0003", "90")):
        assert demo_client.post(f"/api/quarantine/{item}/replay", json={"correction": correction}, headers=STEWARD).status_code == 200
    worker.drain(demo)
    assert [r[0] for r in rows(demo, "SELECT status FROM quarantine_item WHERE id IN ('Q-0001','Q-0002','Q-0003') ORDER BY id")] == ["resolved"] * 3
    assert rows(demo, "SELECT count(*) FROM observation")[0][0] == 14 + 3


def test_the_legacy_quarantine_row_explains_why_it_cannot_replay(demo_client, demo):
    demo_client.post("/api/quarantine/Q-0004/replay", json={"correction": "3"}, headers=STEWARD)
    worker.drain(demo)
    reason, status = rows(demo, "SELECT reason, status FROM quarantine_item WHERE id = 'Q-0004'")[0]
    assert status == "quarantined" and "not retained" in reason


def test_a_new_simulator_run_adds_to_this_world(demo_client, demo):
    DEMO_OP = {"X-Actor-Id": "u-demo", "X-Actor-Name": "Demo Operator", "X-Actor-Role": "demo_operator"}
    from app import simulator

    simulator.SCENARIOS = simulator.load_scenarios()  # the real scenarios, written for this network
    demo_client.post("/api/simulator/runs", json={"scenarioId": "SC-T-2"}, headers=DEMO_OP)
    for hours in (6, 24, 18):
        demo_client.post("/api/simulator/run/advance", json={"hours": hours}, headers=DEMO_OP)
    worker.drain(demo)
    new = demo_client.get("/api/alerts?commodity=tungsten").json()
    fresh = [a for a in new if a["scenarioRun"].startswith("SC-T-2 /")]
    assert sorted((a["location"], a["severity"]) for a in fresh) == [("Germany", "medium"), ("Netherlands", "medium"), ("Russia", "critical")]
    russia = next(a for a in fresh if a["location"] == "Russia")
    assert len(russia["exposedNodeIds"]) >= 10 and russia["assessmentStatus"] == "partial"  # a real, connected exposure


def test_dates_move_with_the_clock_so_the_demo_never_goes_stale(engine):
    now = clock.now() + timedelta(days=30)
    seed.load(engine, path=DEMO, now=now)
    observed, quote, target = rows(engine, "SELECT (SELECT observed_at FROM alert WHERE id = 'AL-T-007'), (SELECT quote_valid_until FROM response_option WHERE id = 'O-T-10'), (SELECT target_date FROM action WHERE id = 'AC-T-002')")[0]
    assert observed.date() == (clock.now() + timedelta(days=26)).date()  # four days before the new "now"
    assert (quote - now.date()).days == 12 and (target - now.date()).days == -2  # still expiring in 12 days, still overdue by two


@pytest.mark.parametrize("dataset, valid, rejected", [
    ("supplier_network", 2, 2),  # two new links, a bad date, and a supplier that is not in the network
    ("inventory", 2, 1), ("demand", 2, 0), ("price", 1, 1), ("alternatives", 1, 1),
])
def test_the_built_in_import_samples_fit_the_demo_network(demo_client, dataset, valid, rejected):
    sample = next(d["sample"] for d in demo_client.get("/api/imports/datasets", headers=ANALYST).json() if d["id"] == dataset)
    r = demo_client.post("/api/imports/validate", json={"dataset": dataset, "csv": sample}, headers=ANALYST).json()
    assert r["headerErrors"] == [] and r["valid"] == valid and len(r["rejected"]) == rejected and r["duplicates"] == 0, r


def test_importing_the_network_sample_extends_the_demo_network(demo_client, demo):
    sample = next(d["sample"] for d in demo_client.get("/api/imports/datasets", headers=ANALYST).json() if d["id"] == "supplier_network")
    r = demo_client.post("/api/imports", json={"dataset": "supplier_network", "csv": sample}, headers=STEWARD)
    assert r.status_code == 201 and r.json()["id"] == "IMP-003" and r.json()["version"] == 2  # two imports already in the demo history
    assert rows(demo, "SELECT count(*) FROM supply_edge WHERE source = 'Curated file v2'")[0][0] == 2
