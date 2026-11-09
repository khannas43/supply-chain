"""Source health, quarantine, rules, reference data, imports and the simulator."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import worker


def who(role, id_=None, name=None):
    return {"X-Actor-Id": id_ or f"u-{role}", "X-Actor-Name": name or role.title(), "X-Actor-Role": role}


ADMIN, STEWARD, ANALYST, MANAGER, VIEWER, DEMO = (who(r) for r in ("admin", "steward", "analyst", "manager", "viewer", "demo_operator"))
ASOF = "asOf=2026-11-09T09:00:00Z"


def count(engine, table, where=""):
    with engine.connect() as c:
        return c.execute(text(f'SELECT count(*) FROM "{table}" {where}')).scalar_one()


def audit_events(engine, event):
    with engine.connect() as c:
        return [tuple(r) for r in c.execute(text("SELECT actor, ref, detail FROM audit_event WHERE event = :e ORDER BY id"), {"e": event})]


# ---- S07: sources, runs, quarantine ----


def test_admin_can_pause_and_enable_a_source(client, seeded):
    r = client.post("/api/sources/src-policy/enabled", json={"enabled": False}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["state"] == "paused"
    states = {s["id"]: s["state"] for s in client.get("/api/sources").json()}
    assert states["src-policy"] == "paused"
    assert client.post("/api/sources/src-policy/enabled", json={"enabled": False}, headers=ADMIN).status_code == 409
    assert client.post("/api/sources/src-policy/enabled", json={"enabled": True}, headers=ADMIN).json()["state"] == "fresh"
    assert [e[1] for e in audit_events(seeded, "source.paused")] == ["src-policy"]


def test_only_admin_changes_source_state(client):
    body = {"enabled": False}
    assert client.post("/api/sources/src-policy/enabled", json=body).status_code == 401
    for h in (STEWARD, ANALYST, MANAGER, VIEWER, DEMO):
        assert client.post("/api/sources/src-policy/enabled", json=body, headers=h).status_code == 403
    assert client.post("/api/sources/nope/enabled", json=body, headers=ADMIN).status_code == 404


def test_runs_newest_first_with_filters(client):
    runs = client.get("/api/runs").json()
    assert runs[0]["id"] == "RUN-0115" and len(runs) == 5
    assert [r["id"] for r in client.get("/api/runs?sourceId=src-logistics").json()] == ["RUN-0115", "RUN-0113"]
    assert len(client.get("/api/runs?limit=2").json()) == 2
    assert client.get("/api/runs?limit=0").status_code == 422


def test_quarantine_list_and_replay_request(client, seeded):
    items = client.get("/api/quarantine").json()
    assert {q["id"] for q in items} == {"Q-0031", "Q-0032"} and items[0]["sourceName"]
    r = client.post("/api/quarantine/Q-0031/replay", json={"correction": "3"}, headers=STEWARD)
    assert r.status_code == 200 and r.json()["status"] == "replay_requested" and r.json()["correction"] == "3"
    assert [q["id"] for q in client.get("/api/quarantine?status=quarantined").json()] == ["Q-0032"]
    assert client.post("/api/quarantine/Q-0031/replay", json={"correction": "4"}, headers=ADMIN).status_code == 409
    assert audit_events(seeded, "quarantine.replay_requested") == [("Steward", "Q-0031", "corrected value: 3")]


def test_replay_of_a_seeded_item_fails_clearly_because_its_record_was_not_kept(client, seeded):
    client.post("/api/quarantine/Q-0031/replay", json={"correction": "3"}, headers=STEWARD)
    assert client.get("/api/pipeline/queue").json()["workerBacklog"] == 1
    worker.drain(seeded)
    q = next(x for x in client.get("/api/quarantine").json() if x["id"] == "Q-0031")
    assert q["status"] == "quarantined" and q["reason"].startswith("Replay failed: The original record was not retained")


def test_quarantine_replay_permissions_and_validation(client):
    url = "/api/quarantine/Q-0032/replay"
    assert client.post(url, json={"correction": "USD"}).status_code == 401
    for h in (ANALYST, MANAGER, VIEWER, DEMO):
        assert client.post(url, json={"correction": "USD"}, headers=h).status_code == 403
    assert client.post(url, json={"correction": "  "}, headers=STEWARD).status_code == 422
    assert client.post("/api/quarantine/none/replay", json={"correction": "x"}, headers=STEWARD).status_code == 404


def test_dead_letter_and_queue(client):
    dead = client.get("/api/dead-letter").json()
    assert [d["id"] for d in dead] == ["DL-0004"] and dead[0]["attempts"] == 3
    assert client.get("/api/pipeline/queue").json() == {"workerBacklog": 0, "deadMessages": 0, "oldestPendingSeconds": None, "kafka": "not_connected", "nifi": "not_connected"}


# ---- S08: rules ----


def thresholds(rule, v):
    return {t["key"]: t["value"] for t in next(x for x in rule["versions"] if x["v"] == v)["thresholds"]}


def rule(client, rule_id):
    return next(r for r in client.get("/api/rules").json() if r["id"] == rule_id)


def test_rule_list(client):
    rules = client.get("/api/rules").json()
    assert {r["id"] for r in rules} == {"R-W-EXP", "R-W-LOG", "R-T-EXP", "R-T-PRC"}
    assert [(v["v"], v["status"]) for v in rule(client, "R-W-EXP")["versions"]] == [("1.1", "superseded"), ("1.2", "published")]
    assert [r["id"] for r in client.get("/api/rules?commodity=tungsten").json()] == ["R-T-EXP", "R-T-PRC"]


def test_draft_starts_a_new_version_and_never_edits_the_published_one(client, seeded):
    r = client.post("/api/rules/R-W-EXP/draft", json={"thresholds": [{"key": "conf", "value": 55}]}, headers=ANALYST)
    assert r.status_code == 200
    rl = r.json()
    assert [(v["v"], v["status"]) for v in rl["versions"]][-2:] == [("1.2", "published"), ("1.3", "draft")]
    assert thresholds(rl, "1.3") == {"conf": 55, "sev": 3, "stale": 48}
    assert thresholds(rl, "1.2")["conf"] == 50  # the published version is untouched
    again = client.post("/api/rules/R-W-EXP/draft", json={"thresholds": [{"key": "stale", "value": 36}]}, headers=ADMIN).json()
    assert [v["v"] for v in again["versions"]][-1] == "1.3" and len(again["versions"]) == 3  # edited in place
    assert thresholds(again, "1.3") == {"conf": 55, "sev": 3, "stale": 36}
    assert [e[2] for e in audit_events(seeded, "rule.draft")] == ["version 1.3", "version 1.3"]


def test_draft_validation_and_permissions(client):
    url = "/api/rules/R-W-EXP/draft"
    ok = {"thresholds": [{"key": "conf", "value": 55}]}
    assert client.post(url, json=ok).status_code == 401
    for h in (STEWARD, MANAGER, VIEWER, DEMO):
        assert client.post(url, json=ok, headers=h).status_code == 403
    for bad in ({"key": "nope", "value": 1}, {"key": "conf", "value": 150}, {"key": "conf", "value": -1},
                {"key": "sev", "value": 2.5}, {"key": "sev", "value": 5}, {"key": "stale", "value": 0}):
        assert client.post(url, json={"thresholds": [bad]}, headers=ANALYST).status_code == 422, bad
    assert client.post(url, json={"thresholds": []}, headers=ANALYST).status_code == 422
    assert client.post("/api/rules/none/draft", json=ok, headers=ANALYST).status_code == 404


def test_publish_supersedes_the_previous_version(client, seeded):
    client.post("/api/rules/R-W-EXP/draft", json={"thresholds": [{"key": "conf", "value": 55}]}, headers=ANALYST)
    r = client.post("/api/rules/R-W-EXP/versions/1.3/publish", headers=ADMIN)
    assert r.status_code == 200
    assert [(v["v"], v["status"]) for v in r.json()["versions"]] == [("1.1", "superseded"), ("1.2", "superseded"), ("1.3", "published")]
    assert r.json()["versions"][-1]["publishedBy"] == "Admin"
    assert audit_events(seeded, "rule.published") == [("Admin", "R-W-EXP", "version 1.3")]
    assert count(seeded, "rule_version", "WHERE rule_id = 'R-W-EXP' AND status = 'published'") == 1


def test_publish_rules(client):
    assert client.post("/api/rules/R-W-EXP/versions/1.2/publish", headers=ANALYST).status_code == 409  # not a draft
    assert client.post("/api/rules/R-W-EXP/versions/9.9/publish", headers=ANALYST).status_code == 404
    assert client.post("/api/rules/R-W-EXP/versions/1.2/publish").status_code == 401
    client.post("/api/rules/R-W-EXP/draft", json={"thresholds": [{"key": "conf", "value": 55}]}, headers=ANALYST)
    for h in (STEWARD, MANAGER, VIEWER):
        assert client.post("/api/rules/R-W-EXP/versions/1.3/publish", headers=h).status_code == 403


# ---- S08: assumptions library, reference data ----


def test_assumptions_library(client):
    all_ = client.get("/api/assumptions").json()
    assert {a["id"] for a in all_} == {"AS-W-1", "AS-T-1"}
    assert [a["id"] for a in client.get("/api/assumptions?status=approved").json()] == ["AS-T-1"]
    assert [a["id"] for a in client.get("/api/assumptions?alertId=AL-W-001").json()] == ["AS-W-1"]
    assert client.get("/api/assumptions?status=weird").status_code == 422


def test_reference_data_and_adding_a_conversion(client, seeded):
    ref = client.get("/api/reference").json()
    assert len(ref["countries"]) == 4 and "CTRY_A" in next(c for c in ref["countries"] if c["code"] == "CTA")["aliases"]
    assert len(ref["forms"]) == 5 and len(ref["conversions"]) == 3
    body = {"from": "USD", "to": "EUR", "factor": "0.91", "effectiveFrom": "2026-12-01", "source": "Rate table v4"}
    r = client.post("/api/reference/conversions", json=body, headers=STEWARD)
    assert r.status_code == 201 and r.json()["id"] == "CV-4" and r.json()["from"] == "USD" and r.json()["factor"] == 0.91
    assert len(client.get("/api/reference").json()["conversions"]) == 4
    assert client.post("/api/reference/conversions", json=body, headers=ADMIN).status_code == 409  # same units and date
    assert audit_events(seeded, "reference.conversion_added")[0][1] == "CV-4"


def test_conversion_validation_and_permissions(client):
    body = {"from": "USD", "to": "GBP", "factor": 0.8, "effectiveFrom": "2026-12-01", "source": "x"}
    assert client.post("/api/reference/conversions", json=body).status_code == 401
    for h in (ANALYST, MANAGER, VIEWER, DEMO):
        assert client.post("/api/reference/conversions", json=body, headers=h).status_code == 403
    for bad in ({"factor": 0}, {"factor": -1}, {"effectiveFrom": "not-a-date"}, {"from": " "}, {"source": ""}):
        assert client.post("/api/reference/conversions", json={**body, **bad}, headers=STEWARD).status_code == 422, bad


# ---- S08: imports ----


def dataset(client, id_):
    return next(d for d in client.get("/api/imports/datasets").json() if d["id"] == id_)


def test_datasets_describe_what_each_import_needs(client):
    ds = client.get("/api/imports/datasets").json()
    assert {d["id"] for d in ds} == {"supplier_network", "inventory", "demand", "price", "alternatives"}
    net = dataset(client, "supplier_network")
    assert net["applied"] is True and "from_id" in net["required"] and net["sample"].startswith("from_id,")
    assert dataset(client, "inventory")["applied"] is False


def csv_body(dataset_id, text_):
    return {"dataset": dataset_id, "csv": text_}


def test_validate_reports_without_saving(client, seeded):
    sample = dataset(client, "supplier_network")["sample"]
    r = client.post("/api/imports/validate", json=csv_body("supplier_network", sample), headers=ANALYST).json()
    assert r["headerErrors"] == [] and r["valid"] == 2 and r["duplicates"] == 0 and r["alreadyImportedAs"] is None
    assert [(x["row"], x["field"]) for x in r["rejected"]] == [(4, "effective_from"), (5, "from_id")]
    assert "not a valid date" in r["rejected"][0]["reason"] and "not a known supplier" in r["rejected"][1]["reason"]
    assert count(seeded, "supply_edge") == 13 and count(seeded, "import_record") == 0


def test_validate_checks(client):
    head = "from_id,to_id,material,source,effective_from,confidence\n"
    v = lambda rows: client.post("/api/imports/validate", json=csv_body("supplier_network", head + rows), headers=STEWARD).json()
    assert v("w-supx,w-supx,m,s,2026-01-01,low\n")["rejected"][0]["reason"] == "A supplier cannot supply itself"
    assert v("w-supx,w-milly,m,s,2026-01-01,certain\n")["rejected"][0]["field"] == "confidence"
    assert v("w-supx,w-milly,,s,2026-01-01,low\n")["rejected"][0]["reason"] == "Missing required field: material"
    dup = v("w-supx,w-milly,m,s,2026-01-01,low\nw-supx,w-milly,m,s,2026-01-01,low\n")
    assert dup["valid"] == 1 and dup["duplicates"] == 1
    existing = v('w-supx,w-milly,"wheat, milling grade",Curated supplier file v1,2025-01-01,medium\n')
    assert existing["valid"] == 0 and existing["duplicates"] == 1  # already in the network
    assert client.post("/api/imports/validate", json=csv_body("supplier_network", "a,b\n1,2\n"), headers=STEWARD).json()["headerErrors"] == ["Missing column: from_id", "Missing column: to_id", "Missing column: material", "Missing column: source", "Missing column: effective_from", "Missing column: confidence"]
    assert client.post("/api/imports/validate", json=csv_body("nope", "x"), headers=STEWARD).status_code == 422


def test_commit_applies_valid_rows_and_quarantines_the_rest(client, seeded):
    sample = dataset(client, "supplier_network")["sample"]
    r = client.post("/api/imports", json=csv_body("supplier_network", sample), headers=STEWARD)
    assert r.status_code == 201, r.text
    imp = r.json()
    assert (imp["id"], imp["version"], imp["rows"], imp["rejected"], imp["applied"]) == ("IMP-001", 1, 2, 2, True)
    assert count(seeded, "supply_edge") == 15
    with seeded.connect() as c:
        q = c.execute(text("SELECT id, source_id, run_id, source_row, field FROM quarantine_item WHERE run_id = 'IMP-001' ORDER BY id")).all()
        run = c.execute(text("SELECT source_id, status, accepted, quarantined FROM ingestion_run WHERE note LIKE '%IMP-001%'")).one()
        assert c.execute(text("SELECT content FROM import_record")).scalar_one() == sample
        assert c.execute(text("SELECT last_usable > '2026-11-08' FROM source WHERE id = 'src-import'")).scalar_one()
    assert [tuple(x) for x in q] == [("Q-0033", "src-import", "IMP-001", "row 4 of IMP-001.csv", "effective_from"), ("Q-0034", "src-import", "IMP-001", "row 5 of IMP-001.csv", "from_id")]
    assert tuple(run) == ("src-import", "partial", 2, 2)
    assert audit_events(seeded, "import.committed") == [("Steward", "IMP-001", "supplier_network v1: 2 accepted, 2 quarantined")]
    assert client.get("/api/imports").json()[0]["id"] == "IMP-001"
    # the new links are real: Supplier W now reaches Mill Y directly
    assert client.get("/api/network/traverse?focus=w-milly&direction=downstream&depth=1").status_code == 200


def test_importing_the_same_file_twice_changes_nothing(client, seeded):
    sample = dataset(client, "supplier_network")["sample"]
    client.post("/api/imports", json=csv_body("supplier_network", sample), headers=STEWARD)
    again = client.post("/api/imports", json=csv_body("supplier_network", sample), headers=ADMIN)
    assert again.status_code == 409 and "IMP-001" in again.json()["detail"]
    assert count(seeded, "supply_edge") == 15 and count(seeded, "import_record") == 1
    assert client.post("/api/imports/validate", json=csv_body("supplier_network", sample), headers=ANALYST).json()["alreadyImportedAs"] == "IMP-001"


def test_other_datasets_are_recorded_but_not_applied(client, seeded):
    sample = dataset(client, "inventory")["sample"]
    imp = client.post("/api/imports", json=csv_body("inventory", sample), headers=STEWARD).json()
    assert imp["applied"] is False and imp["rows"] == 2 and imp["rejected"] == 1 and imp["version"] == 1
    assert count(seeded, "supply_edge") == 13


def test_commit_permissions_and_refusals(client):
    sample = dataset(client, "supplier_network")["sample"]
    body = csv_body("supplier_network", sample)
    assert client.post("/api/imports", json=body).status_code == 401
    for h in (ANALYST, MANAGER, VIEWER, DEMO):
        assert client.post("/api/imports", json=body, headers=h).status_code == 403
    assert client.post("/api/imports/validate", json=body, headers=VIEWER).status_code == 403
    assert client.post("/api/imports", json=csv_body("supplier_network", "a,b\n1,2\n"), headers=STEWARD).status_code == 422
    head = "from_id,to_id,material,source,effective_from,confidence\n"
    assert client.post("/api/imports", json=csv_body("supplier_network", head + "ghost,w-milly,m,s,2026-01-01,low\n"), headers=STEWARD).status_code == 422  # nothing valid
    assert client.post("/api/imports", json=csv_body("nope", "x"), headers=STEWARD).status_code == 422


# ---- S09: simulator ----


def start(client, scenario="SC-W-1", headers=DEMO):
    return client.post("/api/simulator/runs", json={"scenarioId": scenario}, headers=headers)


def test_scenarios_and_idle_state(client):
    scenarios = client.get("/api/simulator/scenarios").json()
    assert {s["id"] for s in scenarios} == {"SC-W-1", "SC-T-1"} and scenarios[0]["events"][0]["at"] == 0
    assert client.get("/api/simulator/run").json()["status"] == "idle"


def test_start_a_run(client, seeded):
    r = start(client)
    assert r.status_code == 201
    s = r.json()
    assert (s["status"], s["runId"], s["seed"], s["emitted"], s["totalEvents"], s["offsetHours"]) == ("running", "run-4711-001", 4711, 1, 3, 0)
    assert s["virtualNow"].startswith("2026-11-07T08:00") and len(s["log"]) == 1 and "export restriction" in s["log"][0]["text"]
    assert client.get("/api/simulator/run").json()["runId"] == "run-4711-001"
    assert client.get("/api/pipeline/queue").json()["workerBacklog"] == 1  # collected, waiting for the worker
    worker.drain(seeded)
    assert client.get("/api/pipeline/queue").json()["workerBacklog"] == 0
    assert "(sim-policy v1)" in client.get("/api/runs").json()[0]["note"]
    assert start(client).status_code == 409  # one run at a time
    assert audit_events(seeded, "simulator.started")[0][1] == "run-4711-001"


def test_run_permissions_and_validation(client):
    assert client.post("/api/simulator/runs", json={"scenarioId": "SC-W-1"}).status_code == 401
    for h in (ANALYST, MANAGER, STEWARD, VIEWER):
        assert start(client, headers=h).status_code == 403
    assert start(client, "SC-X").status_code == 422
    assert start(client, headers=ADMIN).status_code == 201  # admin may too


def test_advancing_the_virtual_clock_emits_scheduled_events(client):
    start(client)
    s = client.post("/api/simulator/run/advance", json={"hours": 6}, headers=DEMO).json()
    assert s["offsetHours"] == 6 and s["emitted"] == 2 and "port congestion" in s["log"][-1]["text"]
    s = client.post("/api/simulator/run/advance", json={"hours": 6}, headers=DEMO).json()
    assert s["emitted"] == 2 and s["log"][-1]["text"] == "Clock advanced 6 h, no scheduled events"
    s = client.post("/api/simulator/run/advance", json={"hours": 24}, headers=DEMO).json()
    assert s["offsetHours"] == 36 and s["emitted"] == 3 and "clarification" in s["log"][-1]["text"]
    for bad in (0, 169, -1):
        assert client.post("/api/simulator/run/advance", json={"hours": bad}, headers=DEMO).status_code == 422


def test_pause_and_resume(client):
    assert client.post("/api/simulator/run/pause", headers=DEMO).status_code == 409  # nothing running
    start(client)
    assert client.post("/api/simulator/run/pause", headers=DEMO).json()["status"] == "paused"
    assert client.post("/api/simulator/run/advance", json={"hours": 6}, headers=DEMO).status_code == 409
    assert client.post("/api/simulator/run/inject", json={"kind": "late"}, headers=DEMO).status_code == 409
    assert client.post("/api/simulator/run/pause", headers=DEMO).status_code == 409
    assert client.post("/api/simulator/run/resume", headers=DEMO).json()["status"] == "running"
    assert client.post("/api/simulator/run/resume", headers=DEMO).status_code == 409


def test_injected_failures_reach_source_health(client, seeded):
    start(client)
    worker.drain(seeded)
    inject = lambda kind: client.post("/api/simulator/run/inject", json={"kind": kind}, headers=DEMO)
    states = lambda: {s["id"]: s["state"] for s in client.get("/api/sources").json()}

    assert inject("timeout").status_code == 200
    assert states()["src-logistics"] == "failing"
    assert client.get("/api/runs").json()[0]["status"] == "failed"
    assert inject("recover").status_code == 200
    assert states()["src-logistics"] == "fresh"

    before = len(client.get("/api/quarantine").json())
    assert inject("malformed").status_code == 200 and inject("missing_field").status_code == 200
    worker.drain(seeded)
    q = client.get("/api/quarantine").json()
    assert len(q) == before + 2 and {x["reason"] for x in q[:2]} == {"Payload is not valid JSON", "Missing required field: country"}
    assert q[0]["status"] == "quarantined"

    assert inject("duplicate").status_code == 200
    worker.drain(seeded)
    assert client.get("/api/runs").json()[0]["duplicate"] == 1
    assert inject("late").status_code == 200 and inject("rate_limit").status_code == 200
    worker.drain(seeded)
    assert client.get("/api/simulator/run").json()["log"][-1]["text"].startswith("Injected HTTP 429")
    assert client.post("/api/simulator/run/inject", json={"kind": "weird"}, headers=DEMO).status_code == 422


def test_reset_ends_the_run_and_leaves_decisions_alone(client, seeded):
    actions_before = client.get("/api/actions").json()
    start(client)
    client.post("/api/simulator/run/advance", json={"hours": 6}, headers=DEMO)
    r = client.post("/api/simulator/run/reset", headers=DEMO)
    assert r.status_code == 200 and r.json()["status"] == "idle" and r.json()["log"] == []
    assert client.post("/api/simulator/run/reset", headers=DEMO).status_code == 409
    assert client.get("/api/actions").json() == actions_before
    assert count(seeded, "sim_log") >= 2  # the history is kept
    again = start(client)
    assert again.status_code == 201 and again.json()["runId"] == "run-4711-002"


def test_database_allows_only_one_active_run(client, seeded):
    start(client)
    with pytest.raises(IntegrityError, match="uq_sim_one_active_run"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO sim_run (id, scenario_id, seed, status, active_slot, started_at, started_by) "
                           "VALUES ('x', 'SC-T-1', 1, 'running', 1, now(), 'me')"))
    with pytest.raises(IntegrityError, match="ck_sim_run_slot"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO sim_run (id, scenario_id, seed, status, active_slot, started_at, started_by) "
                           "VALUES ('y', 'SC-T-1', 1, 'ended', 1, now(), 'me')"))
