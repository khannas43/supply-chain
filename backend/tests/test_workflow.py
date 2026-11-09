"""Assumptions, response options, decisions and actions: what each role may do and what is recorded."""

from datetime import date, timedelta

from sqlalchemy import text


def who(role, id_=None, name=None):
    id_ = id_ or f"u-{role}"
    return {"X-Actor-Id": id_, "X-Actor-Name": name or role.title(), "X-Actor-Role": role}


A = who("analyst", "u-analyst-a", "Risk Analyst A")
B = who("analyst", "u-analyst-b", "Risk Analyst B")
MANAGER = who("manager", "u-manager", "Procurement Manager")
ADMIN = who("admin")
ASOF = "asOf=2026-11-09"


def audit_events(engine, event):
    with engine.connect() as c:
        return [tuple(r) for r in c.execute(text("SELECT actor, ref, detail FROM audit_event WHERE event = :e ORDER BY id"), {"e": event})]


def approve_wheat(client):
    r = client.post("/api/assumptions/AS-W-1/decision", json={"decision": "approved", "note": "ok"}, headers=B)
    assert r.status_code == 200, r.text
    return r.json()


# ---- assumptions ----


def test_propose_replaces_the_current_assumption_and_stays_unavailable(client, seeded):
    r = client.post("/api/alerts/AL-W-001/assumptions", json={"affectedSharePct": 40, "basis": "Smaller scope"}, headers=A)
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "AS-W-2" and body["status"] == "proposed" and body["affectedSharePct"] == 40.0
    assert body["proposedBy"] == {"id": "u-analyst-a", "name": "Risk Analyst A"}
    with seeded.connect() as c:
        assert c.execute(text("SELECT status FROM assumption WHERE id = 'AS-W-1'")).scalar_one() == "superseded"
    calc = client.get("/api/alerts/AL-W-001/assessment").json()["calc"]
    assert calc["atRisk"] is None and calc["reason"] == "The disruption assumption is awaiting approval."
    assert audit_events(seeded, "assumption.proposed") == [("Risk Analyst A", "AS-W-2", "40% affected share")]


def test_proposing_over_an_approved_assumption_keeps_old_snapshots(client):
    r = client.post("/api/alerts/AL-T-001/assumptions", json={"affectedSharePct": 50, "basis": "Revised"}, headers=A)
    assert r.status_code == 201 and r.json()["id"] == "AS-T-2"
    a = client.get("/api/alerts/AL-T-001/assessment").json()
    assert a["calc"]["atRisk"] is None  # the newer assumption is not approved yet
    assert [v["v"] for v in a["versions"]] == [1, 2]  # nothing was rewritten


def test_propose_validation_and_permissions(client):
    url = "/api/alerts/AL-W-001/assumptions"
    ok = {"affectedSharePct": 10, "basis": "x"}
    assert client.post(url, json=ok).status_code == 401
    for role in ("viewer", "manager", "steward", "admin", "demo_operator"):
        assert client.post(url, json=ok, headers=who(role)).status_code == 403, role
    for bad in ({"affectedSharePct": 101, "basis": "x"}, {"affectedSharePct": -1, "basis": "x"}, {"affectedSharePct": 10, "basis": "  "}, {"basis": "x"}):
        assert client.post(url, json=bad, headers=A).status_code == 422, bad
    assert client.post("/api/alerts/nope/assumptions", json=ok, headers=A).status_code == 404
    assert client.post("/api/alerts/AL-T-002/assumptions", json=ok, headers=A).status_code == 409  # not assessed


def test_approval_by_a_second_analyst_creates_a_new_snapshot(client, seeded):
    approved = approve_wheat(client)
    assert approved["status"] == "approved" and approved["decidedBy"]["id"] == "u-analyst-b"
    a = client.get("/api/alerts/AL-W-001/assessment").json()
    assert a["version"] == 2
    assert a["calc"] == {"coverDays": 6.0, "atRisk": 100.0, "gapDays": 4.0, "incrementalCost": 3000.0, "reason": None}
    assert [v["v"] for v in a["versions"]] == [1, 2]
    assert "AS-W-1 approved (100% affected share)" in a["versions"][1]["note"]
    assert audit_events(seeded, "assumption.approved")[-1] == ("Risk Analyst B", "AS-W-1", "ok")


def test_proposer_cannot_decide_their_own_assumption(client):
    r = client.post("/api/assumptions/AS-W-1/decision", json={"decision": "approved"}, headers=A)
    assert r.status_code == 403 and "different analyst" in r.json()["detail"]
    assert client.get("/api/alerts/AL-W-001/assessment").json()["version"] == 1


def test_decision_permissions_and_states(client):
    url = "/api/assumptions/AS-W-1/decision"
    assert client.post(url, json={"decision": "approved"}).status_code == 401
    assert client.post(url, json={"decision": "approved"}, headers=MANAGER).status_code == 403
    assert client.post(url, json={"decision": "maybe"}, headers=B).status_code == 422
    assert client.post("/api/assumptions/none/decision", json={"decision": "approved"}, headers=B).status_code == 404
    approve_wheat(client)
    assert client.post(url, json={"decision": "rejected"}, headers=B).status_code == 409  # already decided
    assert client.post("/api/assumptions/AS-T-1/decision", json={"decision": "rejected"}, headers=B).status_code == 409


def test_rejection_leaves_the_snapshot_alone(client):
    r = client.post("/api/assumptions/AS-W-1/decision", json={"decision": "rejected", "note": "too high"}, headers=B)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    a = client.get("/api/alerts/AL-W-001/assessment").json()
    assert a["version"] == 1 and a["calc"]["reason"] == "The disruption assumption was rejected."


# ---- response options ----


def test_wheat_options_before_approval(client):
    r = client.get(f"/api/alerts/AL-W-001/options?{ASOF}").json()
    assert r["assessmentVersion"] == 1 and r["currency"] == "USD" and r["coverDays"] == 6.0 and r["assumptionStatus"] == "proposed"
    assert [o["option"]["id"] for o in r["ranked"]] == ["O-W-1"]
    first = r["ranked"][0]
    assert first["rank"] == 1 and first["gapDays"] is None and first["incrementalCost"] is None
    assert [o["option"]["id"] for o in r["complementary"]] == ["O-W-3"]
    assert r["complementary"][0]["extraCoverDays"] == 2.0
    reasons = {o["option"]["id"]: o["reasons"] for o in r["ineligible"]}
    assert set(reasons) == {"O-W-2", "O-W-4"}
    assert any("Unknown qualification is not approved" in x for x in reasons["O-W-2"])
    assert reasons["O-W-4"] == ["Quote expired on 2026-11-01."]


def test_wheat_options_after_approval_show_gap_and_cost(client):
    approve_wheat(client)
    first = client.get(f"/api/alerts/AL-W-001/options?{ASOF}").json()["ranked"][0]
    assert first["gapDays"] == 4.0 and first["incrementalCost"] == 3000.0


def test_tungsten_options_rank_by_gap_then_cost(client):
    r = client.get(f"/api/alerts/AL-T-001/options?{ASOF}").json()
    ranked = [(o["rank"], o["option"]["id"], o["gapDays"], o["incrementalCost"]) for o in r["ranked"]]
    assert ranked == [(1, "O-T-4", 0.0, 151200.0), (2, "O-T-1", 15.0, 86400.0)]
    spot = r["ranked"][0]
    assert spot["quoteStatus"] == "expiring" and spot["daysToQuoteExpiry"] == 11
    scrap = next(o for o in r["ineligible"] if o["option"]["id"] == "O-T-2")
    assert len(scrap["reasons"]) == 2  # unknown qualification and a partly met specification


def test_a_quote_that_lapses_makes_an_option_ineligible(client):
    r = client.get("/api/alerts/AL-T-001/options?asOf=2026-12-01").json()
    assert [o["option"]["id"] for o in r["ranked"]] == ["O-T-1"]
    assert "Quote expired on 2026-11-20." in next(o for o in r["ineligible"] if o["option"]["id"] == "O-T-4")["reasons"]


def test_options_for_unknown_or_unassessed_alert(client):
    assert client.get("/api/alerts/nope/options").status_code == 404
    assert client.get("/api/alerts/AL-T-002/options").status_code == 404


def test_shortlist_is_shared_and_role_limited(client):
    url = "/api/options/O-W-1/shortlist"
    assert client.post(url, json={"shortlisted": True}, headers=A).json() == {"optionId": "O-W-1", "shortlisted": True}
    assert client.post(url, json={"shortlisted": True}, headers=MANAGER).status_code == 200  # idempotent
    row = client.get(f"/api/alerts/AL-W-001/options?{ASOF}").json()["ranked"][0]
    assert row["shortlisted"] is True
    assert client.post(url, json={"shortlisted": True}, headers=who("viewer")).status_code == 403
    assert client.post(url, json={"shortlisted": True}).status_code == 401
    client.post(url, json={"shortlisted": False}, headers=A)
    assert client.get(f"/api/alerts/AL-W-001/options?{ASOF}").json()["ranked"][0]["shortlisted"] is False
    assert client.post("/api/options/none/shortlist", json={"shortlisted": True}, headers=A).status_code == 404


# ---- decisions ----


def decision(**over):
    body = {"ownerId": "u-analyst-b", "ownerName": "Risk Analyst B", "targetDate": (date(2026, 11, 9) + timedelta(days=14)).isoformat(), "rationale": "Only qualified option"}
    body.update(over)
    return body


def test_manager_records_a_decision_as_an_action(client, seeded):
    r = client.post("/api/options/O-W-1/decision", json=decision(), headers=MANAGER)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["id"] == "AC-W-003" and a["status"] == "open" and a["optionName"] == "Alternative Supplier V"
    assert a["assessmentVersion"] == 1 and a["assumptionStatus"] == "proposed"
    assert a["ownerId"] == "u-analyst-b" and a["createdBy"] == "Procurement Manager"
    assert [h["to"] for h in a["history"]] == ["open"] and a["history"][0]["from"] is None
    assert audit_events(seeded, "decision.created") == [("Procurement Manager", "AC-W-003", "Alternative Supplier V, owner Risk Analyst B")]
    assert client.get("/api/actions/AC-W-003").json()["id"] == "AC-W-003"


def test_a_decision_records_the_approved_state_it_was_made_on(client):
    approve_wheat(client)
    a = client.post("/api/options/O-W-1/decision", json=decision(), headers=MANAGER).json()
    assert a["assessmentVersion"] == 2 and a["assumptionStatus"] == "approved" and a["reviewNeeded"] is False


def test_ineligible_options_cannot_be_chosen(client):
    r = client.post("/api/options/O-W-2/decision", json=decision(), headers=MANAGER)
    assert r.status_code == 422 and "not eligible" in r.json()["detail"] and "Unknown qualification" in r.json()["detail"]
    assert client.post("/api/options/O-W-4/decision", json=decision(), headers=MANAGER).status_code == 422  # expired quote


def test_decision_validation_and_permissions(client):
    url = "/api/options/O-W-1/decision"
    assert client.post(url, json=decision()).status_code == 401
    for role in ("viewer", "analyst", "steward", "admin", "demo_operator"):
        assert client.post(url, json=decision(), headers=who(role)).status_code == 403, role
    assert client.post(url, json=decision(targetDate="2026-11-08"), headers=MANAGER).status_code == 422
    assert client.post(url, json=decision(rationale=" "), headers=MANAGER).status_code == 422
    assert client.post(url, json=decision(ownerId=""), headers=MANAGER).status_code == 422
    assert client.post("/api/options/none/decision", json=decision(), headers=MANAGER).status_code == 404


def test_action_ids_continue_per_commodity(client):
    t = client.post("/api/options/O-T-4/decision", json=decision(), headers=MANAGER).json()
    assert t["id"] == "AC-T-003" and t["commodity"] == "tungsten"
    w = client.post("/api/options/O-W-1/decision", json=decision(), headers=MANAGER).json()
    assert w["id"] == "AC-W-003"


# ---- actions ----


def test_action_list_filters_and_flags(client):
    all_ = client.get(f"/api/actions?{ASOF}").json()
    assert [a["id"] for a in all_] == ["AC-T-002", "AC-W-002", "AC-W-001", "AC-T-001"]  # by target date, then id
    assert [a["id"] for a in client.get("/api/actions?commodity=wheat").json()] == ["AC-W-002", "AC-W-001"]
    assert [a["id"] for a in client.get("/api/actions?status=review").json()] == ["AC-T-002", "AC-W-002"]
    assert [a["id"] for a in client.get("/api/actions?ownerId=u-manager").json()] == ["AC-W-001", "AC-T-001"]
    assert client.get("/api/actions?status=weird").status_code == 422
    by_id = {a["id"]: a for a in all_}
    assert {i for i, a in by_id.items() if a["overdue"]} == {"AC-W-002", "AC-T-002"}
    assert {a["id"] for a in client.get(f"/api/actions?overdueOnly=true&{ASOF}").json()} == {"AC-W-002", "AC-T-002"}
    assert by_id["AC-T-002"]["reviewNeeded"] is True and by_id["AC-T-002"]["currentAssessmentVersion"] == 2
    assert by_id["AC-W-002"]["reviewNeeded"] is False


def test_a_newer_assessment_flags_actions_but_does_not_change_them(client):
    before = client.get("/api/actions/AC-W-001").json()
    approve_wheat(client)
    after = client.get("/api/actions/AC-W-001").json()
    assert before["reviewNeeded"] is False and after["reviewNeeded"] is True
    assert after["status"] == before["status"] and after["ownerId"] == before["ownerId"] and after["assessmentVersion"] == 1


def test_action_detail_includes_history_and_audit(client):
    client.post("/api/actions/AC-T-001/status", json={"status": "review", "note": "ready"}, headers=MANAGER)
    a = client.get("/api/actions/AC-T-001").json()
    assert [h["to"] for h in a["history"]] == ["open", "in_progress", "review"]
    assert a["history"][-1]["note"] == "ready" and a["history"][-1]["from"] == "in_progress"
    assert [(e["event"], e["detail"]) for e in a["audit"]] == [("action.status", "review: ready")]
    assert client.get("/api/actions/none").status_code == 404


def test_owner_can_move_forward_but_not_close(client):
    own = who("analyst", "u-analyst-b", "Risk Analyst B")  # owns AC-W-002, which is in review
    r = client.post("/api/actions/AC-W-002/status", json={"status": "in_progress", "note": "more work"}, headers=own)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert client.post("/api/actions/AC-W-002/status", json={"status": "done"}, headers=own).status_code == 403
    assert client.post("/api/actions/AC-W-002/status", json={"status": "open"}, headers=own).status_code == 403
    assert client.post("/api/actions/AC-W-002/status", json={"status": "in_progress"}, headers=own).status_code == 409


def test_others_cannot_update_someone_elses_action(client):
    url = "/api/actions/AC-W-002/status"  # owned by u-analyst-b
    body = {"status": "in_progress"}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, json=body, headers=A).status_code == 403
    assert client.post(url, json=body, headers=who("viewer")).status_code == 403
    assert client.post(url, json=body, headers=who("demo_operator")).status_code == 403
    assert client.post(url, json=body, headers=ADMIN).status_code == 200
    assert client.post(url, json={"status": "done"}, headers=ADMIN).status_code == 403  # close is the manager's


def test_manager_closes_and_reopens(client):
    url = "/api/actions/AC-W-002/status"
    assert client.post(url, json={"status": "done", "note": "complete"}, headers=MANAGER).json()["status"] == "done"
    own = who("analyst", "u-analyst-b", "Risk Analyst B")
    assert client.post(url, json={"status": "in_progress"}, headers=own).status_code == 403  # owner cannot reopen
    assert client.post(url, json={"status": "in_progress", "note": "Reopened"}, headers=MANAGER).json()["status"] == "in_progress"
    done = client.post(url, json={"status": "done"}, headers=MANAGER).json()
    assert done["overdue"] is False and done["reviewNeeded"] is False  # closed actions raise no flags


def test_reassign(client, seeded):
    url = "/api/actions/AC-W-001/reassign"
    body = {"ownerId": "u-analyst-a", "ownerName": "Risk Analyst A", "note": "Back from leave"}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, json=body, headers=A).status_code == 403
    r = client.post(url, json=body, headers=MANAGER)
    assert r.status_code == 200 and r.json()["ownerId"] == "u-analyst-a"
    last = r.json()["history"][-1]
    assert last["note"] == "Reassigned to Risk Analyst A: Back from leave" and last["from"] == last["to"] == "in_progress"
    assert audit_events(seeded, "action.reassigned") == [("Procurement Manager", "AC-W-001", "to Risk Analyst A")]
    assert client.post(url, json=body, headers=MANAGER).status_code == 409  # already the owner
    assert client.post("/api/actions/none/reassign", json=body, headers=MANAGER).status_code == 404
