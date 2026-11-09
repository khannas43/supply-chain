"""Token validation, roles and commodity scope. Tokens are signed with a throwaway RSA key."""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from fastapi import HTTPException

from app import auth, config

ISSUER = "http://localhost:8180/realms/supplychain"


def make_key(kid):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
    jwk.update(kid=kid, use="sig", alg="RS256")
    pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return pem, jwk


KEY1, JWK1 = make_key("k1")
KEY2, JWK2 = make_key("k2")
OTHER, _ = make_key("k1")  # a different key that claims the same id


@pytest.fixture
def realm(monkeypatch):
    """keycloak mode, with the realm's keys served from memory."""
    monkeypatch.setenv("AUTH_MODE", "keycloak")
    monkeypatch.setenv("KEYCLOAK_ISSUER", ISSUER)
    config.get_settings.cache_clear()
    served = {"keys": {"k1": JWK1}, "fail": False}

    def fetch():
        if served["fail"]:
            raise HTTPException(503, "The identity provider is not reachable")
        return dict(served["keys"])

    auth.jwks.clear()
    monkeypatch.setattr(auth.jwks, "_fetch", fetch)
    monkeypatch.setattr(auth.JwksCache, "MIN_REFRESH_SECONDS", 0)
    yield served
    auth.jwks.clear()
    config.get_settings.cache_clear()


def token(roles=("analyst",), *, key=KEY1, kid="k1", alg="RS256", scope=None, **over):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": "supplychain-api", "sub": "user-1", "name": "Alice Analyst", "preferred_username": "alice",
              "iat": now, "exp": now + 300, "realm_access": {"roles": list(roles)}}
    if scope is not None:
        claims["commodity_scope"] = scope
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


def bearer(*a, **k):
    return {"Authorization": f"Bearer {token(*a, **k)}"}


# ---- who gets in ----


def test_health_and_login_config_are_public_everything_else_needs_a_token(client, realm):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/config").json() == {"mode": "keycloak", "authority": ISSUER, "clientId": "supplychain-web"}
    for path in ("/api/alerts", "/api/overview?commodity=wheat", "/api/network/nodes", "/api/actions", "/api/rules", "/api/sources", "/api/reference"):
        r = client.get(path)
        assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer", path
    assert client.get("/api/alerts", headers=bearer()).status_code == 200


def test_dev_mode_login_config_and_open_reads(client):
    assert client.get("/api/auth/config").json() == {"mode": "dev"}
    assert client.get("/api/alerts").status_code == 200


@pytest.mark.parametrize("make", [
    lambda: token(key=OTHER),  # signed by someone else
    lambda: token(iss="http://evil/realms/x"),
    lambda: token(aud="another-api"),
    lambda: token(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200),
    lambda: token(exp=None),
    lambda: token(kid="unknown"),
    lambda: jwt.encode({"iss": ISSUER, "aud": "supplychain-api", "sub": "x", "iat": 1, "exp": 9999999999}, "secret-that-is-long-enough-for-hs256-use", algorithm="HS256", headers={"kid": "k1"}),
    lambda: "not.a.jwt",
])
def test_invalid_tokens_are_refused(client, realm, make):
    r = client.get("/api/alerts", headers={"Authorization": f"Bearer {make()}"})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


def test_a_tampered_token_is_refused(client, realm):
    head, body, sig = token().split(".")
    forged = jwt.utils.base64url_encode(json.dumps({"iss": ISSUER, "aud": "supplychain-api", "sub": "root", "iat": 1, "exp": 9999999999,
                                                    "realm_access": {"roles": ["admin"]}}).encode()).decode()
    assert client.get("/api/alerts", headers={"Authorization": f"Bearer {head}.{forged}.{sig}"}).status_code == 401


def test_a_token_without_a_known_role_is_forbidden(client, realm):
    assert client.get("/api/alerts", headers=bearer(roles=())).status_code == 403
    assert client.get("/api/alerts", headers=bearer(roles=("offline_access", "uma_authorization"))).status_code == 403


def test_an_unreachable_identity_provider_is_reported_not_trusted(client, realm):
    realm["fail"] = True
    assert client.get("/api/alerts", headers=bearer()).status_code == 503


def test_keys_are_cached_and_rotation_is_picked_up(client, realm, monkeypatch):
    fetches = []
    inner = auth.jwks._fetch

    def counting():
        fetches.append(1)
        return inner()

    monkeypatch.setattr(auth.jwks, "_fetch", counting)
    for _ in range(3):
        assert client.get("/api/alerts", headers=bearer()).status_code == 200
    assert len(fetches) == 1  # one fetch served three requests
    realm["keys"] = {"k1": JWK1, "k2": JWK2}  # the realm rotates in a new key
    assert client.get("/api/alerts", headers=bearer(key=KEY2, kid="k2")).status_code == 200
    assert len(fetches) == 2


def test_the_token_name_and_roles_reach_the_audit_trail(client, realm, seeded):
    body = {"disposition": "monitor", "rationale": "watching"}
    assert client.post("/api/alerts/AL-W-001/disposition", json=body, headers=bearer(roles=("viewer",))).status_code == 403
    assert client.post("/api/alerts/AL-W-001/disposition", json=body, headers=bearer(roles=("viewer", "analyst"))).status_code == 200  # several roles
    from sqlalchemy import text

    with seeded.connect() as c:
        assert c.execute(text("SELECT actor FROM audit_event WHERE event = 'alert.disposition'")).scalar_one() == "Alice Analyst"


def test_a_user_with_two_roles_gets_the_union(client, realm):
    h = bearer(roles=("manager", "steward"))
    assert client.post("/api/options/O-W-1/shortlist", json={"shortlisted": True}, headers=h).status_code == 200
    assert client.post("/api/quarantine/Q-0032/replay", json={"correction": "USD"}, headers=h).status_code == 200
    assert client.post("/api/sources/src-policy/enabled", json={"enabled": False}, headers=h).status_code == 403  # admin only


def test_headers_are_ignored_in_keycloak_mode(client, realm):
    forged = {"X-Actor-Id": "x", "X-Actor-Name": "Mallory", "X-Actor-Role": "admin"}
    assert client.get("/api/alerts", headers=forged).status_code == 401
    assert client.post("/api/sources/src-policy/enabled", json={"enabled": False}, headers=forged).status_code == 401


# ---- commodity scope ----


def scoped(client, headers=None):
    h = headers or {}
    get = lambda path: client.get(path, headers=h)
    return {
        "alerts": sorted(a["id"] for a in get("/api/alerts").json()),
        "alert_detail": get("/api/alerts/AL-T-001").status_code,
        "assessment": get("/api/alerts/AL-T-001/assessment").status_code,
        "options": get("/api/alerts/AL-T-001/options").status_code,
        "overview": get("/api/overview?commodity=tungsten").status_code,
        "nodes": sorted({n["commodity"] for n in get("/api/network/nodes").json()}),
        "traverse": get("/api/network/traverse?focus=t-carbide").status_code,
        "actions": sorted(a["id"] for a in get("/api/actions").json()),
        "action_detail": get("/api/actions/AC-T-001").status_code,
        "rules": sorted({r["commodity"] for r in get("/api/rules").json()}),
        "assumptions": sorted(a["id"] for a in get("/api/assumptions").json()),
    }


WHEAT_ONLY = {
    "alerts": ["AL-W-001", "AL-W-002"], "alert_detail": 404, "assessment": 404, "options": 404, "overview": 404,
    "nodes": ["wheat"], "traverse": 404, "actions": ["AC-W-001", "AC-W-002"], "action_detail": 404, "rules": ["wheat"],
    "assumptions": ["AS-W-1"],
}


def test_a_scoped_token_sees_only_its_commodity(client, realm):
    assert scoped(client, bearer(roles=("analyst",), scope=["wheat"])) == WHEAT_ONLY
    assert scoped(client, bearer(roles=("analyst",), scope="wheat")) == WHEAT_ONLY  # a single value works too


def test_scope_in_dev_mode_works_the_same_way(client):
    h = {"X-Actor-Id": "u", "X-Actor-Name": "U", "X-Actor-Role": "analyst", "X-Actor-Scope": "wheat"}
    assert scoped(client, h) == WHEAT_ONLY


def test_an_unscoped_user_and_an_anonymous_dev_reader_see_everything(client, realm):
    everything = scoped(client, bearer(roles=("analyst",)))
    assert everything["alerts"] == ["AL-T-001", "AL-T-002", "AL-W-001", "AL-W-002"] and everything["alert_detail"] == 200


def test_an_empty_scope_sees_nothing(client, realm):
    s = scoped(client, bearer(roles=("analyst",), scope=[]))
    assert s["alerts"] == [] and s["nodes"] == [] and s["actions"] == [] and s["alert_detail"] == 404


def test_scope_also_limits_what_can_be_changed(client, realm, seeded):
    wheat = bearer(roles=("analyst", "manager"), scope=["wheat"])
    t = lambda path, body: client.post(path, json=body, headers=wheat)
    assert t("/api/alerts/AL-T-001/disposition", {"disposition": "monitor", "rationale": "x"}).status_code == 404
    assert t("/api/alerts/AL-T-001/assumptions", {"affectedSharePct": 10, "basis": "x"}).status_code == 404
    assert t("/api/options/O-T-1/shortlist", {"shortlisted": True}).status_code == 404
    assert t("/api/options/O-T-1/decision", {"ownerId": "u", "ownerName": "U", "targetDate": "2026-12-20", "rationale": "x"}).status_code == 404
    assert t("/api/actions/AC-T-001/status", {"status": "review"}).status_code == 404
    assert t("/api/actions/AC-T-001/reassign", {"ownerId": "u", "ownerName": "U"}).status_code == 404
    assert t("/api/rules/R-T-EXP/draft", {"thresholds": [{"key": "conf", "value": 70}]}).status_code == 404
    assert t("/api/alerts/AL-W-001/disposition", {"disposition": "monitor", "rationale": "x"}).status_code == 200  # its own is fine


# ---- the directory of people ----


def test_dev_mode_lists_the_demo_identities(client):
    people = client.get("/api/people").json()
    assert len(people) == 9 and {"id": "u-analyst-a", "name": "Risk Analyst A", "roles": ["analyst"]} in people


def test_people_appear_after_they_sign_in(client, realm, seeded):
    from app import people

    people.forget()
    assert client.get("/api/people", headers=bearer()).json() == [{"id": "user-1", "name": "Alice Analyst", "roles": ["analyst"]}]  # demo rows are hidden
    bob = bearer(roles=("manager", "steward"), sub="user-2", name="Bob Manager")
    client.get("/api/alerts", headers=bob)
    names = {p["name"]: p["roles"] for p in client.get("/api/people", headers=bearer()).json()}
    assert names == {"Alice Analyst": ["analyst"], "Bob Manager": ["manager", "steward"]}
    from sqlalchemy import text

    with seeded.begin() as c:
        c.execute(text("UPDATE person SET name = 'stale' WHERE id = 'user-2'"))
    client.get("/api/alerts", headers=bob)  # inside the refresh window: no write
    with seeded.connect() as c:
        assert c.execute(text("SELECT name FROM person WHERE id = 'user-2'")).scalar_one() == "stale"
    people.forget()
    client.get("/api/alerts", headers=bob)
    with seeded.connect() as c:
        assert c.execute(text("SELECT name FROM person WHERE id = 'user-2'")).scalar_one() == "Bob Manager"


def test_the_directory_needs_a_token_in_keycloak_mode(client, realm):
    assert client.get("/api/people").status_code == 401


# ---- who may read what: the same matrix as the screens ----

SOURCE_HEALTH = ["/api/runs", "/api/quarantine", "/api/dead-letter", "/api/pipeline/queue"]
RULES_AND_DATA = ["/api/rules", "/api/assumptions", "/api/reference", "/api/imports", "/api/imports/datasets"]
SIMULATOR = ["/api/simulator/scenarios", "/api/simulator/run"]
OPEN_TO_ALL = ["/api/alerts", "/api/overview?commodity=wheat", "/api/sources", "/api/network/nodes", "/api/actions", "/api/people"]


def reads(client, role):
    h = {"X-Actor-Id": f"u-{role}", "X-Actor-Name": role, "X-Actor-Role": role}
    return {p: client.get(p, headers=h).status_code for p in SOURCE_HEALTH + RULES_AND_DATA + SIMULATOR + OPEN_TO_ALL}


@pytest.mark.parametrize("role, source_health, rules_data, simulator", [
    ("viewer", False, False, False),
    ("manager", False, False, False),
    ("analyst", True, True, False),
    ("steward", True, True, False),
    ("admin", True, True, True),
    ("demo_operator", True, False, True),
])
def test_reads_follow_the_role_matrix(client, role, source_health, rules_data, simulator):
    got = reads(client, role)
    for paths, allowed in ((SOURCE_HEALTH, source_health), (RULES_AND_DATA, rules_data), (SIMULATOR, simulator)):
        assert {got[p] for p in paths} == ({200} if allowed else {403}), (role, {p: got[p] for p in paths})
    assert {got[p] for p in OPEN_TO_ALL} == {200}


def test_anonymous_dev_reads_stay_open_but_keycloak_mode_needs_the_role(client, realm):
    assert client.get("/api/quarantine", headers=bearer(roles=("viewer",))).status_code == 403
    assert client.get("/api/quarantine", headers=bearer(roles=("steward",))).status_code == 200
    assert client.get("/api/simulator/run", headers=bearer(roles=("analyst",))).status_code == 403
    assert client.get("/api/simulator/run", headers=bearer(roles=("demo_operator",))).status_code == 200


def test_anonymous_dev_reads_are_open(client):
    assert all(client.get(p).status_code == 200 for p in SOURCE_HEALTH + RULES_AND_DATA + SIMULATOR)
