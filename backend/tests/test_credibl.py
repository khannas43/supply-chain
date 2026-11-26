"""Credibl client, mapper and provenance. The mock stands in for the API until Credibl gives access."""

import json
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import clock, credibl, worker
from app.config import Settings
from tests.test_ingestion import ANALYST, q

NOW = datetime(2026, 11, 24, 10, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: NOW)


def add_countries(engine):
    with Session(engine) as s:
        s.execute(text("INSERT INTO country (code, name) VALUES ('CN', 'China'), ('VN', 'Vietnam'), ('RW', 'Rwanda') ON CONFLICT DO NOTHING"))
        s.commit()


def run_poll(engine, client=None):
    add_countries(engine)
    with Session(engine) as s:
        got = credibl.poll(s, client or credibl.MockCredibl())
        s.commit()
    worker.drain(engine)
    return got


def test_mock_poll_stores_values_with_their_provenance(seeded):
    got = run_poll(seeded)
    assert got and not got.duplicate
    rows = q(seeded, "SELECT event_type, country, mode, origin_source, licence_class, staleness_flag, completeness_flag, outcome "
                     "FROM observation WHERE licence_class IS NOT NULL ORDER BY id")
    assert len(rows) == 6 and {r[2] for r in rows} == {"simulated"}  # the mock is never labelled live
    assert {r[7] for r in rows} == {"no_rule_match"}  # indicators raise no alerts until a rule is written for them
    conflict = next(r for r in rows if r[0] == "conflict_score")
    assert conflict[3:7] == ("UCDP georeferenced events (annual baseline)", "attribution_required", "stale", "partial")
    assert q(seeded, "SELECT mode, enabled FROM source WHERE id = 'src-credibl'") == [("simulated", True)]
    assert q(seeded, "SELECT count(*) FROM source_commodity WHERE source_id = 'src-credibl'") == [(1,)]


def test_polling_twice_on_the_same_day_collects_once(seeded):
    first = run_poll(seeded)
    again = run_poll(seeded)
    assert again.duplicate and again.ingestion_id == first.ingestion_id
    assert q(seeded, "SELECT count(*) FROM observation WHERE licence_class IS NOT NULL") == [(6,)]


def test_a_value_without_provenance_is_quarantined_not_guessed(seeded):
    add_countries(seeded)
    body = json.loads(credibl.MockCredibl().fetch("tungsten"))
    del body["records"][0]["provenance"]
    body["records"][1]["provenance"]["staleness"] = "very old"  # not one of the flags we know
    with Session(seeded) as s:
        credibl.ensure_source(s, credibl.MockCredibl())
        from app.collect import collect

        collect(s, credibl.SOURCE_ID, json.dumps(body).encode(), mode="simulated")
        s.commit()
    worker.drain(seeded)
    assert q(seeded, "SELECT count(*) FROM observation WHERE licence_class IS NOT NULL") == [(4,)]
    reasons = [r[0] for r in q(seeded, "SELECT field FROM quarantine_item WHERE source_id = 'src-credibl' ORDER BY id")]
    assert reasons == ["provenance", "provenance"]


def test_a_failed_fetch_is_recorded_on_the_source(seeded):
    class Broken:
        mode = "live"

        def fetch(self, commodity):
            raise credibl.CreditblError("HTTP 503 from https://example.invalid")

    with Session(seeded) as s:
        assert credibl.poll(s, Broken()) is None
        s.commit()
    assert q(seeded, "SELECT last_error FROM source WHERE id = 'src-credibl'")[0][0].startswith("CreditblError: HTTP 503")
    assert q(seeded, "SELECT status FROM ingestion_run WHERE source_id = 'src-credibl'") == [("failed",)]


def test_http_client_pages_authenticates_and_retries_rate_limits(monkeypatch):
    monkeypatch.setattr(credibl.time, "sleep", lambda s: None)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.url.params.get("cursor")))
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 300})
        assert request.headers["Authorization"] == "Bearer tok"
        if request.url.params.get("cursor") is None:
            if sum(1 for c in calls if c[1].endswith("/indicators")) == 1:
                return httpx.Response(429, headers={"Retry-After": "1"})
            return httpx.Response(200, json={"records": [{"recordId": "a"}], "nextCursor": "p2"})
        return httpx.Response(200, json={"records": [{"recordId": "b"}]})

    settings = Settings(credibl_base_url="https://api.test", credibl_token_url="https://api.test/token", credibl_client_id="i", credibl_client_secret="s")
    client = credibl.HttpCredibl(settings, httpx.Client(transport=httpx.MockTransport(handler)))
    body = json.loads(client.fetch("tungsten"))
    assert [r["recordId"] for r in body["records"]] == ["a", "b"] and body["schemaVersion"] == 1
    assert sum(1 for c in calls if c[1] == "/token") == 1  # the token is reused across pages


def test_http_client_reports_a_bad_status():
    client = credibl.HttpCredibl(
        Settings(credibl_base_url="https://api.test", credibl_api_key="k"),
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))),
    )
    with pytest.raises(credibl.CreditblError, match="HTTP 500"):
        client.fetch("tungsten")


def test_external_data_endpoint_lists_provenance(seeded, client):
    run_poll(seeded)
    r = client.get("/api/external-data", headers=ANALYST)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 6
    one = next(x for x in rows if x["indicator"] == "export_control_score")
    assert one["licenceClass"] == "public_notice" and one["staleness"] == "fresh" and one["value"] == 68.0
    assert one["evidence"]["source"].startswith("Credibl") and one["mode"] == "simulated"
