import httpx
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)


def test_health_is_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_keycloak_unreachable_is_reported_not_raised(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(main.httpx, "get", boom)
    body = client.get("/api/health/keycloak").json()
    assert body["status"] == "unreachable"


def test_keycloak_missing_realm(monkeypatch):
    monkeypatch.setattr(main.httpx, "get", lambda *a, **k: httpx.Response(404))
    assert client.get("/api/health/keycloak").json()["status"] == "realm_missing"
