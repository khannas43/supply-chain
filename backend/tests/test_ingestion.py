"""Collection, the worker, validation, rules and alerts, quarantine and replay."""

import json
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, storage, worker
from app.collect import collect
from app.models import Outbox

STEWARD = {"X-Actor-Id": "u-steward", "X-Actor-Name": "Data Steward", "X-Actor-Role": "steward"}
ANALYST = {"X-Actor-Id": "u-analyst-a", "X-Actor-Name": "Risk Analyst A", "X-Actor-Role": "analyst"}
VIEWER = {"X-Actor-Id": "u-viewer", "X-Actor-Name": "Executive Viewer", "X-Actor-Role": "viewer"}
RUN = "T / run-1"


def policy(**over):
    r = dict(recordId="P-1", commodity="wheat", country="Country A", policyType="export_restriction", headline="Export restriction",
             confidencePct=60, announcedAt="2026-11-07T08:00:00Z")
    r.update(over)
    return {k: v for k, v in r.items() if v is not None}


def logistics(**over):
    r = dict(recordId="L-1", commodity="wheat", country="Country B", eventType="port_delay", delayDays=4, headline="Port delay",
             confidencePct=40, reportedAt="2026-11-07T14:00:00Z")
    r.update(over)
    return {k: v for k, v in r.items() if v is not None}


def price(**over):
    r = dict(recordId="PR-1", commodity="tungsten", indicator="price_change_30d_pct", value=18.5, headline="Price up",
             confidencePct=70, observedAt="2026-11-07T20:00:00Z")
    r.update(over)
    return r


def wrap(*records, schema=1):
    return json.dumps({"schemaVersion": schema, "records": list(records)}).encode()


def deliver(engine, source, body, run=RUN, mode="simulated"):
    """Collect a payload and let the worker process everything waiting."""
    with Session(engine) as s:
        c = collect(s, source, body, mode=mode, scenario_run=run)
        s.commit()
    worker.drain(engine)
    return c


def q(engine, sql, **params):
    with engine.connect() as c:
        return [tuple(r) for r in c.execute(text(sql), params)]


def alerts(engine):
    return q(engine, "SELECT id, severity, confidence, location, assessment_status, rule_v, scenario_run FROM alert WHERE id NOT IN ('AL-W-001','AL-W-002','AL-T-001','AL-T-002') ORDER BY id")


def outcomes(engine):
    return [r[0] for r in q(engine, "SELECT outcome FROM observation ORDER BY id")]


# ---- evidence storage ----


def test_storage_keeps_objects_immutable(tmp_path):
    store = storage.FileEvidenceStore(tmp_path / "s")
    digest = store.put("evidence/a/x.json", b"one")
    assert digest == storage.sha256(b"one") and store.get("evidence/a/x.json") == b"one"
    assert store.put("evidence/a/x.json", b"one") == digest  # identical rewrite is fine
    with pytest.raises(storage.EvidenceConflict):
        store.put("evidence/a/x.json", b"two")
    with pytest.raises(storage.EvidenceMissing):
        store.get("evidence/nope.json")
    for bad in ("../outside.json", "/etc/passwd", "evidence/../../x"):
        with pytest.raises(ValueError):
            store.put(bad, b"x")


# ---- collection ----


def test_collect_preserves_the_original_and_queues_a_message(seeded):
    body = wrap(policy())
    c = deliver_no_worker(seeded, "src-policy", body)
    assert not c.duplicate and c.ingestion_id == "ING-00001"
    assert storage.get_store().get(c.object_key) == body
    ev = q(seeded, "SELECT id, sha256, mode, scenario_run FROM evidence WHERE id = 'EV-ING-00001'")[0]
    assert ev == ("EV-ING-00001", storage.sha256(body), "simulated", RUN)
    msg = q(seeded, "SELECT topic, key, status, payload->>'object_key', payload->>'sha256' FROM outbox")[0]
    assert msg == ("source.observations.v1", "ING-00001", "pending", c.object_key, storage.sha256(body))
    assert q(seeded, "SELECT status FROM ingestion") == [("received",)]


def deliver_no_worker(engine, source, body, run=RUN):
    with Session(engine) as s:
        c = collect(s, source, body, mode="simulated", scenario_run=run)
        s.commit()
    return c


def test_collecting_the_same_bytes_twice_records_a_duplicate(seeded):
    body = wrap(policy())
    first = deliver_no_worker(seeded, "src-policy", body)
    again = deliver_no_worker(seeded, "src-policy", body)
    assert again.duplicate and again.ingestion_id == first.ingestion_id
    assert q(seeded, "SELECT count(*) FROM ingestion") == [(1,)] and q(seeded, "SELECT count(*) FROM outbox") == [(1,)]
    assert q(seeded, "SELECT duplicate, note FROM ingestion_run ORDER BY id DESC LIMIT 1")[0][0] == 1


def test_database_refuses_duplicate_ingestions_and_messages(seeded):
    deliver_no_worker(seeded, "src-policy", wrap(policy()))
    with pytest.raises(IntegrityError, match="uq_outbox_topic_key"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO outbox (topic, key, payload, created_at, available_at) VALUES ('source.observations.v1', 'ING-00001', '{}', now(), now())"))
    with pytest.raises(IntegrityError, match="uq_ingestion_source_sha"):
        with seeded.begin() as c:
            c.execute(text("INSERT INTO ingestion (id, source_id, received_at, evidence_id, object_key, sha256, mode) "
                           "SELECT 'ING-X', source_id, received_at, evidence_id, object_key, sha256, mode FROM ingestion"))


# ---- the happy path: a record becomes an alert ----


def test_a_policy_event_becomes_an_alert_with_exposure_and_a_trail(client, seeded):
    c = deliver(seeded, "src-policy", wrap(policy()))
    [(alert_id, severity, confidence, location, status, rule_v, run)] = alerts(seeded)
    assert (alert_id, severity, confidence, location, status, rule_v, run) == ("AL-W-003", "high", "medium", "Country A", "partial", "1.2", RUN)
    a = client.get(f"/api/alerts/{alert_id}").json()
    assert a["title"] == "Export restriction announced, Country A" and a["ruleVersion"] == "wheat-export-policy v1.2"
    assert a["ruleInputs"][-1] == "confidence 60% >= floor 50%" and a["mode"] == "simulated"
    assert a["exposedNodeIds"][0] == "w-supx" and {"w-milly", "w-plantz", "w-prodp"} <= set(a["exposedNodeIds"])
    assert a["exposed"] is None and "does not confirm an interruption" in a["summary"]
    assert a["evidence"]["id"] == "EV-ING-00001" and a["evidence"]["objectKey"] == c.object_key
    assert q(seeded, "SELECT status, records, mapping_version FROM ingestion") == [("processed", 1, "sim-policy v1")]
    assert q(seeded, "SELECT outcome, alert_id, mapping_version FROM observation") == [("alert_raised", "AL-W-003", "sim-policy v1")]
    assert q(seeded, "SELECT status, accepted, quarantined FROM ingestion_run ORDER BY id DESC LIMIT 1") == [("ok", 1, 0)]
    assert q(seeded, "SELECT status FROM outbox") == [("done",)]
    assert q(seeded, "SELECT actor, ref, detail FROM audit_event WHERE event = 'alert.raised'") == [("Ingestion worker", "AL-W-003", "wheat-export-policy v1.2 from OB-000001")]
    assert q(seeded, "SELECT last_error IS NULL AND last_usable > '2026-11-09' FROM source WHERE id = 'src-policy'") == [(True,)]


def test_the_original_payload_can_be_opened_by_roles_that_may_see_raw_evidence(client, seeded):
    body = wrap(policy())
    deliver(seeded, "src-policy", body)
    r = client.get("/api/evidence/EV-ING-00001/raw", headers=ANALYST)
    assert r.status_code == 200 and r.content == body and r.headers["x-content-sha256"] == storage.sha256(body)
    assert client.get("/api/evidence/EV-ING-00001/raw", headers=VIEWER).status_code == 403
    assert client.get("/api/evidence/EV-ING-00001/raw").status_code == 401
    assert client.get("/api/evidence/nope/raw", headers=ANALYST).status_code == 404
    assert "not in storage" in client.get("/api/evidence/EV-AL-W-001/raw", headers=ANALYST).json()["detail"]  # seeded evidence has no file


def test_tampered_evidence_is_refused(client, seeded):
    c = deliver(seeded, "src-policy", wrap(policy()))
    (storage.get_store().root / c.object_key).write_bytes(b"changed")
    assert client.get("/api/evidence/EV-ING-00001/raw", headers=ANALYST).status_code == 500


def test_tungsten_policy_and_price_and_logistics_rules(seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="T-1", commodity="tungsten", country="Country T", policyType="export_licence", confidencePct=85)))
    deliver(seeded, "src-price", wrap(price()))
    deliver(seeded, "src-logistics", wrap(logistics()))
    rows = {r[3]: r for r in alerts(seeded)}
    assert rows["Country T"][1:3] == ("critical", "high")  # severity score 4, confidence 85%
    assert rows["Global"][1:5] == ("low", "medium", "Global", "unassessed")  # price: score 1, no location to match
    assert rows["Country B"][1:3] == ("medium", "low")  # delay 4 d >= 3 d, confidence 40%
    t = q(seeded, "SELECT node_id FROM alert_exposed_node WHERE alert_id = :a ORDER BY position", a=rows["Country T"][0])
    # the Country T nodes, then everything downstream of them, nearest first
    assert [n[0] for n in t] == ["t-conc", "t-apt", "t-carbide", "t-plantk", "t-prodr", "t-minem"]
    assert q(seeded, "SELECT count(*) FROM alert_exposed_node WHERE alert_id = :a", a=rows["Global"][0]) == [(0,)]


# ---- rules: what does not raise an alert ----


def test_events_that_do_not_meet_a_rule_raise_nothing(seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="a", confidencePct=40)))  # below the 50% floor
    deliver(seeded, "src-policy", wrap(policy(recordId="b", policyType="clarification")))  # not an alertable event
    deliver(seeded, "src-logistics", wrap(logistics(delayDays=2)))  # below the 3-day threshold
    deliver(seeded, "src-price", wrap(price(value=10)))  # below the 15% threshold
    deliver(seeded, "src-policy", wrap(policy(recordId="c", commodity="tungsten", country="Country T", policyType="export_licence", confidencePct=55)))  # below 60%
    assert alerts(seeded) == []
    assert outcomes(seeded) == ["below_threshold", "no_rule_match", "below_threshold", "below_threshold", "below_threshold"]


def test_only_the_published_rule_version_applies(client, seeded):
    ANALYST_B = {"X-Actor-Id": "u-analyst-b", "X-Actor-Name": "Risk Analyst B", "X-Actor-Role": "analyst"}
    client.post("/api/rules/R-W-EXP/draft", json={"thresholds": [{"key": "conf", "value": 90}]}, headers=ANALYST)
    deliver(seeded, "src-policy", wrap(policy(recordId="a")), run="r1")
    assert [a[5] for a in alerts(seeded)] == ["1.2"]  # the draft's 90% floor did not apply
    client.post("/api/rules/R-W-EXP/versions/1.3/publish", headers=ANALYST_B)
    deliver(seeded, "src-policy", wrap(policy(recordId="b")), run="r2")
    assert outcomes(seeded) == ["alert_raised", "below_threshold"]  # now it does
    assert len(alerts(seeded)) == 1


def test_repeats_join_the_existing_alert_within_a_run(seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="a")), run="r1")
    deliver(seeded, "src-policy", wrap(policy(recordId="b", announcedAt="2026-11-08T08:00:00Z")), run="r1")
    assert len(alerts(seeded)) == 1 and outcomes(seeded) == ["alert_raised", "merged"]
    assert q(seeded, "SELECT DISTINCT alert_id FROM observation") == [("AL-W-003",)]


def test_runs_and_dismissed_alerts_do_not_merge(client, seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="a")), run="r1")
    deliver(seeded, "src-policy", wrap(policy(recordId="b")), run="r2")  # another scenario run is a separate world
    assert len(alerts(seeded)) == 2
    client.post("/api/alerts/AL-W-003/disposition", json={"disposition": "dismissed", "rationale": "noise"}, headers=ANALYST)
    deliver(seeded, "src-policy", wrap(policy(recordId="c", announcedAt="2026-11-07T20:00:00Z")), run="r1")
    assert len(alerts(seeded)) == 3  # the dismissed alert no longer absorbs new events


def test_a_late_record_is_kept_as_history_and_changes_nothing(seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="new", announcedAt="2026-11-08T08:00:00Z")))
    deliver(seeded, "src-policy", wrap(policy(recordId="old", announcedAt="2026-11-06T08:00:00Z")))
    assert outcomes(seeded) == ["alert_raised", "late"] and len(alerts(seeded)) == 1
    assert q(seeded, "SELECT status, accepted FROM ingestion_run ORDER BY id DESC LIMIT 1") == [("ok", 1)]


def test_country_aliases_resolve(seeded):
    deliver(seeded, "src-policy", wrap(policy(recordId="a", country="CTRY_A")))
    deliver(seeded, "src-policy", wrap(policy(recordId="b", country="  country a ", announcedAt="2026-11-07T10:00:00Z")))
    assert q(seeded, "SELECT DISTINCT country FROM observation") == [("Country A",)]


# ---- duplicates and conflicts ----


def test_same_record_in_different_payloads_is_a_duplicate_and_a_changed_one_is_held(seeded):
    deliver(seeded, "src-policy", wrap(policy()))
    deliver(seeded, "src-policy", wrap(policy(), policy(recordId="P-2", announcedAt="2026-11-07T09:00:00Z")))
    assert q(seeded, "SELECT duplicate, accepted FROM ingestion_run ORDER BY id DESC LIMIT 1") == [(1, 1)]
    deliver(seeded, "src-policy", wrap(policy(confidencePct=99)))  # same record id, different content
    [(reason, field)] = q(seeded, "SELECT reason, field FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")
    assert "already received with different content" in reason and field == "recordId"
    assert q(seeded, "SELECT count(*) FROM observation") == [(2,)]  # nothing was overwritten


# ---- quarantine ----


@pytest.mark.parametrize("record, reason, field", [
    (policy(country=None), "Missing required field: country", "country"),
    (policy(commodity="rice"), "commodity is not valid", "commodity"),
    (policy(confidencePct=150), "confidencePct is not valid", "confidencePct"),
    (policy(announcedAt="2026-11-07T08:00:00"), "announcedAt is not valid", "announcedAt"),
    (policy(country="Atlantis"), "Unresolved location", "country"),
])
def test_invalid_records_are_quarantined_with_a_reason(seeded, record, reason, field):
    deliver(seeded, "src-policy", wrap(record))
    [(got, f, status, rec_json)] = q(seeded, "SELECT reason, field, status, record_json FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")
    assert reason in got and f == field and status == "quarantined" and json.loads(rec_json)["recordId"] == "P-1"
    assert alerts(seeded) == [] and q(seeded, "SELECT count(*) FROM observation") == [(0,)]
    assert q(seeded, "SELECT status, quarantined FROM ingestion_run ORDER BY id DESC LIMIT 1") == [("failed", 1)]


def test_a_bad_record_does_not_block_the_good_ones_beside_it(seeded):
    deliver(seeded, "src-policy", wrap(policy(country=None), policy(recordId="P-2")))
    assert q(seeded, "SELECT status, accepted, quarantined FROM ingestion_run ORDER BY id DESC LIMIT 1") == [("partial", 1, 1)]
    assert len(alerts(seeded)) == 1


def test_non_json_and_non_object_payloads_are_quarantined(seeded):
    deliver(seeded, "src-policy", b'{"records": [{"recordId": "')
    deliver(seeded, "src-policy", json.dumps({"schemaVersion": 1, "records": ["just text"]}).encode())
    rows = q(seeded, "SELECT reason, field FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032') ORDER BY id")
    assert rows == [("Payload is not valid JSON", "(whole record)"), ("Record is not a JSON object", "(whole record)")]


# ---- failures the worker must survive ----


def test_an_unsupported_schema_goes_to_the_dead_letter_list_without_retries(client, seeded):
    deliver(seeded, "src-policy", wrap(policy(), schema=9))
    assert q(seeded, "SELECT status, attempts, last_error FROM outbox") == [("dead", 1, "Schema version 9 not supported (mapping v1 only)")]
    assert q(seeded, "SELECT status FROM ingestion") == [("failed",)]
    dead = client.get("/api/dead-letter").json()[0]
    assert dead["reason"].startswith("Schema version 9") and dead["sourceId"] == "src-policy"
    assert q(seeded, "SELECT count(*) FROM audit_event WHERE event = 'message.dead'") == [(1,)]
    assert client.get("/api/pipeline/queue").json()["deadMessages"] == 1


def test_a_checksum_mismatch_is_permanent(seeded):
    c = deliver_no_worker(seeded, "src-policy", wrap(policy()))
    (storage.get_store().root / c.object_key).write_bytes(b"tampered")
    worker.drain(seeded)
    assert q(seeded, "SELECT status, last_error FROM outbox")[0][0] == "dead"
    assert "Checksum mismatch" in q(seeded, "SELECT reason FROM dead_letter ORDER BY id DESC LIMIT 1")[0][0]


def test_a_missing_object_is_retried_with_backoff_then_dead_lettered(seeded):
    c = deliver_no_worker(seeded, "src-policy", wrap(policy()))
    (storage.get_store().root / c.object_key).unlink()
    assert worker.run_once(seeded) is True
    status, attempts, available = q(seeded, "SELECT status, attempts, available_at FROM outbox")[0]
    assert (status, attempts) == ("pending", 1) and available > clock.now()
    assert worker.run_once(seeded) is False  # not before the backoff has passed
    clock.freeze(clock.now() + timedelta(seconds=10))
    assert worker.run_once(seeded) is True and q(seeded, "SELECT attempts FROM outbox") == [(2,)]
    clock.freeze(clock.now() + timedelta(seconds=10))
    assert worker.run_once(seeded) is True
    assert q(seeded, "SELECT status, attempts FROM outbox") == [("dead", 3)]
    assert "Gave up after 3 attempts" in q(seeded, "SELECT reason FROM dead_letter ORDER BY id DESC LIMIT 1")[0][0]


def test_a_recovered_object_is_processed_on_retry(seeded):
    body = wrap(policy())
    c = deliver_no_worker(seeded, "src-policy", body)
    path = storage.get_store().root / c.object_key
    path.unlink()
    worker.run_once(seeded)
    path.write_bytes(body)  # storage comes back
    clock.freeze(clock.now() + timedelta(seconds=10))
    worker.drain(seeded)
    assert len(alerts(seeded)) == 1 and q(seeded, "SELECT status FROM outbox") == [("done",)]


def test_processing_the_same_message_twice_creates_no_second_alert(seeded):
    c = deliver(seeded, "src-policy", wrap(policy()))
    with seeded.begin() as conn:  # redelivery: the same envelope again under another key
        conn.execute(text("INSERT INTO outbox (topic, key, payload, created_at, available_at) "
                          "SELECT topic, key || '-again', payload, created_at, available_at FROM outbox"))
    worker.drain(seeded)
    assert len(alerts(seeded)) == 1 and q(seeded, "SELECT count(*) FROM observation") == [(1,)]
    assert q(seeded, "SELECT status FROM outbox ORDER BY id") == [("done",), ("done",)]
    assert c.ingestion_id == "ING-00001"


# ---- replay of quarantined records ----


def request_replay(client, item_id, correction):
    r = client.post(f"/api/quarantine/{item_id}/replay", json={"correction": correction}, headers=STEWARD)
    assert r.status_code == 200, r.text


def test_a_corrected_record_is_replayed_through_the_same_pipeline(client, seeded):
    deliver(seeded, "src-policy", wrap(policy(country=None)))
    [(qid,)] = q(seeded, "SELECT id FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")
    request_replay(client, qid, "Country A")
    assert client.get("/api/pipeline/queue").json()["workerBacklog"] == 1
    worker.drain(seeded)
    assert q(seeded, "SELECT status FROM quarantine_item WHERE id = :i", i=qid) == [("resolved",)]
    assert len(alerts(seeded)) == 1 and outcomes(seeded) == ["alert_raised"]
    assert q(seeded, "SELECT note FROM ingestion_run ORDER BY id DESC LIMIT 1") == [(f"Replay of {qid}",)]
    assert q(seeded, "SELECT event FROM audit_event WHERE ref = :i ORDER BY id", i=qid) == [("quarantine.replay_requested",), ("quarantine.replayed",)]
    assert client.post(f"/api/quarantine/{qid}/replay", json={"correction": "x"}, headers=STEWARD).status_code == 409


def test_a_failed_replay_returns_to_quarantine_and_can_be_tried_again(client, seeded):
    deliver(seeded, "src-policy", wrap(policy(country=None)))
    [(qid,)] = q(seeded, "SELECT id FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")
    request_replay(client, qid, "Atlantis")
    worker.drain(seeded)
    status, reason = q(seeded, "SELECT status, reason FROM quarantine_item WHERE id = :i", i=qid)[0]
    assert status == "quarantined" and reason.startswith("Replay failed: Unresolved location") and alerts(seeded) == []
    request_replay(client, qid, "Country A")  # a second attempt is allowed and has its own message
    worker.drain(seeded)
    assert q(seeded, "SELECT status FROM quarantine_item WHERE id = :i", i=qid) == [("resolved",)] and len(alerts(seeded)) == 1


def test_a_malformed_payload_is_replayed_from_a_corrected_record(client, seeded):
    deliver(seeded, "src-policy", b'{"records": [{"recordId": "')
    [(qid, field)] = q(seeded, "SELECT id, field FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")
    assert field == "(whole record)"
    request_replay(client, qid, "not json")
    worker.drain(seeded)
    assert q(seeded, "SELECT reason FROM quarantine_item WHERE id = :i", i=qid)[0][0] == "Replay failed: The corrected value is not valid JSON"
    request_replay(client, qid, json.dumps(policy()))
    worker.drain(seeded)
    assert q(seeded, "SELECT status FROM quarantine_item WHERE id = :i", i=qid) == [("resolved",)] and len(alerts(seeded)) == 1


# ---- the simulator end to end ----

DEMO = {"X-Actor-Id": "u-demo", "X-Actor-Name": "Demo Operator", "X-Actor-Role": "demo_operator"}


def sim(client, path, body=None):
    r = client.post(path, json=body or {}, headers=DEMO)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_a_wheat_run_produces_the_expected_alerts(client, seeded):
    sim(client, "/api/simulator/runs", {"scenarioId": "SC-W-1"})
    worker.drain(seeded)
    assert [(a[0], a[1], a[3]) for a in alerts(seeded)] == [("AL-W-003", "high", "Country A")]
    sim(client, "/api/simulator/run/advance", {"hours": 6})
    worker.drain(seeded)
    assert [(a[1], a[3]) for a in alerts(seeded)][-1] == ("medium", "Country B")
    sim(client, "/api/simulator/run/advance", {"hours": 24})
    worker.drain(seeded)
    assert len(alerts(seeded)) == 2 and outcomes(seeded) == ["alert_raised", "alert_raised", "no_rule_match"]
    a = client.get("/api/alerts/AL-W-003").json()
    assert a["scenarioRun"] == "SC-W-1 / run-4711-001" and a["mode"] == "simulated"
    assert client.get("/api/evidence/EV-ING-00001/raw", headers=ANALYST).json()["records"][0]["country"] == "Country A"


def test_a_tungsten_run_merges_the_quota_notice_into_the_licence_alert(client, seeded):
    sim(client, "/api/simulator/runs", {"scenarioId": "SC-T-1"})
    sim(client, "/api/simulator/run/advance", {"hours": 12})
    sim(client, "/api/simulator/run/advance", {"hours": 24})
    worker.drain(seeded)
    assert outcomes(seeded) == ["alert_raised", "alert_raised", "merged"]
    assert sorted((a[1], a[3]) for a in alerts(seeded)) == [("critical", "Country T"), ("low", "Global")]


def test_injected_failures_follow_the_real_pipeline(client, seeded):
    sim(client, "/api/simulator/runs", {"scenarioId": "SC-W-1"})
    worker.drain(seeded)
    for kind in ("duplicate", "late", "malformed", "missing_field"):
        sim(client, "/api/simulator/run/inject", {"kind": kind})
    worker.drain(seeded)
    assert len(alerts(seeded)) == 1  # none of the failures created another alert
    assert outcomes(seeded) == ["alert_raised", "late"]
    reasons = {r[0] for r in q(seeded, "SELECT reason FROM quarantine_item WHERE id NOT IN ('Q-0031','Q-0032')")}
    assert reasons == {"Payload is not valid JSON", "Missing required field: country"}
    assert q(seeded, "SELECT count(*) FROM ingestion") == [(4,)]  # the duplicate delivery was not collected again
    sim(client, "/api/simulator/run/reset")
    assert len(alerts(seeded)) == 1  # ending a run keeps what it produced
