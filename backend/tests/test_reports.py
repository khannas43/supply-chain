"""Reports answer from the data held and stay inside the caller's access."""

from app.routers.reports import INTEGRITY


def test_risk_exposure(client, seeded):
    r = client.get("/api/reports/risk-exposure").json()
    assert r["totals"]["activeAlerts"] == r["totals"]["assessed"] + r["totals"]["unassessed"]
    assert {c["commodity"] for c in r["bySeverity"]} == {"wheat", "tungsten"}
    assert len(r["topAlerts"]) <= 10


def test_concentration_shares_add_up(client, seeded):
    r = client.get("/api/reports/supplier-concentration", params={"commodity": "wheat"}).json()
    assert r["totals"]["nodes"] == sum(k["count"] for k in r["byKind"])
    assert all(row["share"] <= 100 for row in r["byCountry"])


def test_actions_report(client, seeded):
    r = client.get("/api/reports/actions").json()
    assert r["totals"]["actions"] == sum(s["count"] for s in r["byStatus"])
    assert r["totals"]["open"] + r["totals"]["done"] == r["totals"]["actions"]


def test_lifecycle_integrity_holds_on_seed(client, seeded):
    r = client.get("/api/reports/data-lifecycle").json()
    assert len(r["integrity"]) == len(INTEGRITY) + 1
    # the small fixture carries no stored payloads; the demo set does (see test_demo_data)
    broken = [c["check"] for c in r["integrity"] if c["violations"] and "stored original" not in c["check"]]
    assert broken == []
    steps = [f["count"] for f in r["funnel"]]
    assert steps[2] >= steps[3]  # assessed alerts cannot exceed alerts raised


def test_lifecycle_check_catches_a_break(client, seeded, engine):
    with engine.begin() as c:
        c.exec_driver_sql("alter table action disable trigger all")
        c.exec_driver_sql("delete from action_status_history where id = (select min(id) from action_status_history)")
    r = client.get("/api/reports/data-lifecycle").json()
    assert any(c["violations"] for c in r["integrity"])


def test_reports_respect_commodity_scope(client, seeded):
    h = {"X-Actor-Id": "u-x", "X-Actor-Name": "X", "X-Actor-Role": "analyst", "X-Actor-Scope": "wheat"}
    assert client.get("/api/reports/supplier-concentration", params={"commodity": "tungsten"}, headers=h).status_code == 404
    r = client.get("/api/reports/risk-exposure", headers=h).json()
    assert [c["commodity"] for c in r["bySeverity"]] == ["wheat"]
    assert client.get("/api/reports/data-lifecycle", headers=h).json()["integrity"] is None
