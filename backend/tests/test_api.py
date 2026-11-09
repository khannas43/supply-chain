def test_alert_list_and_filters(client):
    all_ = client.get("/api/alerts").json()
    assert {a["id"] for a in all_} == {"AL-W-001", "AL-W-002", "AL-T-001", "AL-T-002"}
    assert [a["id"] for a in client.get("/api/alerts?commodity=tungsten&severity=critical").json()] == ["AL-T-001"]
    assert [a["id"] for a in client.get("/api/alerts?mode=replay").json()] == ["AL-T-002"]
    assert client.get("/api/alerts?severity=urgent").status_code == 422


def test_alert_shape_matches_the_frontend_type(client):
    a = client.get("/api/alerts/AL-W-001").json()
    assert a["ruleVersion"] == "wheat-export-policy v1.2"
    assert a["assessmentStatus"] == "partial" and a["severity"] == "high" and a["confidence"] == "medium"
    assert a["exposedNodeIds"] == ["w-supx", "w-milly", "w-plantz", "w-prodp"]
    assert a["exposed"] == {"value": 100.0, "unit": "t", "horizon": "30 days"}
    assert a["daysOfCover"] == 6.0
    assert set(a["evidence"]) == {"source", "objectKey", "sha256", "publishedAt", "ingestedAt"}


def test_alert_without_assessment_has_no_exposure(client):
    a = client.get("/api/alerts/AL-W-002").json()
    assert a["exposed"] is None and a["daysOfCover"] is None


def test_unknown_alert_is_404(client):
    assert client.get("/api/alerts/nope").status_code == 404
    assert client.get("/api/alerts/nope/assessment").status_code == 404


def test_wheat_assessment_is_partial_while_the_assumption_awaits_approval(client):
    r = client.get("/api/alerts/AL-W-001/assessment").json()
    assert r["version"] == 1
    assert r["calc"]["coverDays"] == 6.0
    assert r["calc"]["atRisk"] is None and r["calc"]["gapDays"] is None and r["calc"]["incrementalCost"] is None
    assert r["calc"]["reason"] == "The disruption assumption is awaiting approval."
    assert r["assumption"]["status"] == "proposed" and r["assumption"]["proposedBy"]["id"] == "u-analyst-a"
    assert r["referenceOption"]["id"] == "O-W-1"
    assert r["missing"] and r["paths"][0]["classification"] == "potential"


def test_tungsten_assessment_uses_the_approved_assumption(client):
    r = client.get("/api/alerts/AL-T-001/assessment").json()
    assert r["version"] == 2
    assert r["calc"] == {"coverDays": 45.0, "atRisk": 10.8, "gapDays": 15.0, "incrementalCost": 86400.0, "reason": None}
    assert [v["v"] for v in r["versions"]] == [1, 2]
    assert r["inputs"]["currency"] == "USD" and r["inputs"]["usableStock"] == 9.0


def test_alert_with_no_assessment_returns_404_for_assessment(client):
    assert client.get("/api/alerts/AL-T-002/assessment").status_code == 404


def test_network_nodes(client):
    wheat = client.get("/api/network/nodes?commodity=wheat").json()
    assert len(wheat) == 6 and all(n["commodity"] == "wheat" for n in wheat)


def test_traverse_endpoint(client):
    r = client.get("/api/network/traverse?focus=w-milly&depth=3").json()
    assert r["totalReachable"] == 6 and r["truncated"] is False
    assert r["cycleEdgeIds"] == ["e3", "e4"]
    levels = {n["node"]["id"]: n["level"] for n in r["nodes"]}
    assert levels["w-supx"] == -1 and levels["w-prodp"] == 2
    edge = next(e for e in r["edges"] if e["id"] == "e1")
    assert edge["from"] == "w-supx" and edge["to"] == "w-milly" and edge["confidence"] == "medium"


def test_traverse_limits_and_validation(client):
    assert client.get("/api/network/traverse?focus=w-milly&limit=2").json()["truncated"] is True
    assert client.get("/api/network/traverse?focus=w-milly&depth=9").status_code == 422
    assert client.get("/api/network/traverse?focus=w-milly&direction=sideways").status_code == 422
    assert client.get("/api/network/traverse?focus=ghost").status_code == 404


ANALYST = {"X-Actor-Id": "u-analyst-a", "X-Actor-Name": "Risk Analyst A", "X-Actor-Role": "analyst"}


def actor(role):
    return {"X-Actor-Id": f"u-{role}", "X-Actor-Name": role.title(), "X-Actor-Role": role}


def test_disposition_is_recorded_and_audited(client, seeded):
    r = client.post("/api/alerts/AL-W-001/disposition", json={"disposition": "confirmed", "rationale": " Policy verified "}, headers=ANALYST)
    assert r.status_code == 200 and r.json()["disposition"] == "confirmed"
    assert client.get("/api/alerts/AL-W-001").json()["disposition"] == "confirmed"
    from sqlalchemy import text

    with seeded.connect() as c:
        row = c.execute(text("SELECT actor, event, ref, detail FROM audit_event WHERE event = 'alert.disposition'")).one()
    assert tuple(row) == ("Risk Analyst A", "alert.disposition", "AL-W-001", "new -> confirmed: Policy verified")


def test_disposition_needs_a_signed_in_analyst(client):
    body = {"disposition": "monitor", "rationale": "watch"}
    assert client.post("/api/alerts/AL-W-001/disposition", json=body).status_code == 401
    for role in ("viewer", "manager", "steward", "admin", "demo_operator"):
        assert client.post("/api/alerts/AL-W-001/disposition", json=body, headers=actor(role)).status_code == 403, role
    assert client.get("/api/alerts/AL-W-001").json()["disposition"] == "new"


def test_disposition_validation(client):
    url = "/api/alerts/AL-W-001/disposition"
    assert client.post(url, json={"disposition": "new", "rationale": "x"}, headers=ANALYST).status_code == 422
    assert client.post(url, json={"disposition": "monitor", "rationale": "   "}, headers=ANALYST).status_code == 422
    assert client.post(url, json={"disposition": "monitor"}, headers=ANALYST).status_code == 422
    assert client.post("/api/alerts/none/disposition", json={"disposition": "monitor", "rationale": "x"}, headers=ANALYST).status_code == 404


AS_OF = "asOf=2026-11-09T09:00:00Z"


def test_overview_for_wheat(client):
    r = client.get(f"/api/overview?commodity=wheat&{AS_OF}").json()
    assert r["activeAlerts"] == 2 and r["alertsBySeverity"] == {"high": 1, "medium": 1}
    assert r["assessedAlerts"] == 1
    assert r["actions"] == {"open": 0, "inProgress": 1, "review": 1, "done": 0}
    assert r["lastAssessmentAt"].startswith("2026-11-07T15:00")
    assert [(p["day"], p["count"]) for p in r["trend"]][-3:] == [("2026-11-07", 1), ("2026-11-08", 1), ("2026-11-09", 0)]
    assert len(r["trend"]) == 7


def test_overview_excludes_dismissed_alerts(client):
    client.post("/api/alerts/AL-W-002/disposition", json={"disposition": "dismissed", "rationale": "noise"}, headers=ANALYST)
    r = client.get(f"/api/overview?commodity=wheat&{AS_OF}").json()
    assert r["activeAlerts"] == 1 and r["alertsBySeverity"] == {"high": 1}


def test_source_freshness_states(client):
    by_id = {s["id"]: s for s in client.get(f"/api/sources?{AS_OF}").json()}
    assert by_id["src-policy"]["state"] == "fresh"
    assert by_id["src-logistics"]["state"] == "stale" and by_id["src-logistics"]["hoursSinceUsable"] == 24.9
    assert by_id["src-import"]["policyHours"] == 168
    assert {s["id"] for s in client.get(f"/api/sources?commodity=tungsten&{AS_OF}").json()} == {"src-policy", "src-price", "src-import"}


def test_failing_and_paused_sources_never_read_as_fresh(client, seeded):
    from sqlalchemy import text

    with seeded.begin() as c:
        c.execute(text("UPDATE source SET last_error = 'Timeout after 30 s' WHERE id = 'src-policy'"))
        c.execute(text("UPDATE source SET enabled = false WHERE id = 'src-price'"))
    by_id = {s["id"]: s["state"] for s in client.get(f"/api/sources?{AS_OF}").json()}
    assert by_id["src-policy"] == "failing" and by_id["src-price"] == "paused"
