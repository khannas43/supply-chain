"""Who is calling, what roles they hold, and which commodities they may see.

Two modes, chosen by AUTH_MODE:

- ``keycloak``: every request except health checks and the login configuration needs a valid access
  token (RS256, signature checked against the realm's published keys, issuer and audience matched,
  not expired). Roles come from the token's realm roles; an optional ``commodity_scope`` claim
  restricts the commodities a user can see.
- ``dev``: identity is read from X-Actor-Id, X-Actor-Name, X-Actor-Role (comma separated) and an
  optional X-Actor-Scope. Local development only; it must never face a network.

Authorisation is enforced here and in the endpoints, never only in the browser.
"""

import threading
import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request
from jwt.algorithms import RSAAlgorithm
from sqlalchemy.orm import Session

from .config import get_settings
from .deps import get_session

ROLES = frozenset({"viewer", "analyst", "manager", "steward", "admin", "demo_operator"})
COMMODITIES = frozenset({"wheat", "tungsten"})
PUBLIC_PREFIXES = ("/api/health", "/api/docs", "/api/openapi.json", "/api/auth/config")


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    roles: frozenset[str]
    scope: frozenset[str] | None = None  # commodities this user may see; None means all

    def has(self, *roles: str) -> bool:
        return bool(self.roles & set(roles))


def _unauthorised(message: str) -> HTTPException:
    return HTTPException(401, message, headers={"WWW-Authenticate": "Bearer"})


# ---- token validation ----


class JwksCache:
    """The realm's signing keys, fetched from the identity provider and cached.

    An unknown key id triggers one refresh (keys rotate), but not more often than every few seconds,
    so a flood of bad tokens cannot turn into a flood of requests to Keycloak.
    """

    MIN_REFRESH_SECONDS = 10

    def __init__(self) -> None:
        self._keys: dict[str, object] = {}
        self._fetched = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> dict[str, dict]:
        s = get_settings()
        url = f"{s.keycloak_internal_url}/realms/{s.keycloak_realm}/protocol/openid-connect/certs"
        try:
            response = httpx.get(url, timeout=3.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(503, "The identity provider is not reachable") from exc
        return {k["kid"]: k for k in response.json().get("keys", []) if k.get("use", "sig") == "sig" and k.get("kty") == "RSA"}

    def key(self, kid: str):
        with self._lock:
            age = time.monotonic() - self._fetched
            stale = age > get_settings().jwks_cache_seconds
            if kid not in self._keys and (stale or age > self.MIN_REFRESH_SECONDS):
                self._keys = {k: RSAAlgorithm.from_jwk(jwk) for k, jwk in self._fetch().items()}
                self._fetched = time.monotonic()
            if kid not in self._keys:
                raise _unauthorised("The token was signed with an unknown key")
            return self._keys[kid]

    def clear(self) -> None:
        with self._lock:
            self._keys, self._fetched = {}, 0.0


jwks = JwksCache()


def verify_token(token: str) -> dict:
    s = get_settings()
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise _unauthorised("Unsupported token")
        return jwt.decode(
            token, jwks.key(header["kid"]), algorithms=["RS256"], audience=s.keycloak_audience, issuer=s.keycloak_issuer,
            options={"require": ["exp", "iat", "iss", "sub"]}, leeway=10,
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorised("Your session has expired. Sign in again") from None
    except jwt.InvalidTokenError:
        raise _unauthorised("The token is not valid") from None


def actor_from_claims(claims: dict) -> Actor:
    realm_roles = (claims.get("realm_access") or {}).get("roles") or []
    roles = frozenset(realm_roles) & ROLES
    if not roles:
        raise HTTPException(403, "Your account has no role in this application. Ask an administrator")
    scope = None
    if "commodity_scope" in claims:
        raw = claims["commodity_scope"]
        scope = frozenset(raw if isinstance(raw, list) else [raw]) & COMMODITIES  # an empty result sees nothing
    return Actor(claims["sub"], claims.get("name") or claims.get("preferred_username") or claims["sub"], roles, scope)


def _bearer(request: Request) -> str | None:
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def _from_token(request: Request) -> Actor:
    token = _bearer(request)
    if token is None:
        raise _unauthorised("Sign in to continue")
    return actor_from_claims(verify_token(token))


def _from_headers(id_: str | None, name: str | None, role: str | None, scope: str | None) -> Actor | None:
    if not (id_ and name and role):
        return None
    roles = frozenset(r.strip() for r in role.split(",") if r.strip())
    scoped = None if scope is None else frozenset(c.strip() for c in scope.split(",") if c.strip())
    return Actor(id_, name, roles, scoped)


# ---- dependencies ----


def guard(request: Request, session: Session = Depends(get_session)) -> None:
    """Applied to every route. In keycloak mode all but the public ones need a valid token."""
    if get_settings().auth_mode == "keycloak" and not request.url.path.startswith(PUBLIC_PREFIXES):
        request.state.actor = actor = _from_token(request)
        from . import people  # imported here: people imports this module

        people.touch(session, actor)


def maybe_actor(
    request: Request,
    x_actor_id: str | None = Header(None),
    x_actor_name: str | None = Header(None),
    x_actor_role: str | None = Header(None),
    x_actor_scope: str | None = Header(None),
) -> Actor | None:
    """The caller if there is one. Reads are open in dev mode, so this can be None there."""
    if (actor := getattr(request.state, "actor", None)) is not None:
        return actor
    mode = get_settings().auth_mode
    if mode == "keycloak":
        return _from_token(request)
    if mode == "dev":
        return _from_headers(x_actor_id, x_actor_name, x_actor_role, x_actor_scope)
    raise HTTPException(500, f"Unknown AUTH_MODE {mode!r}")


def current_actor(actor: Actor | None = Depends(maybe_actor)) -> Actor:
    if actor is None:
        raise _unauthorised("Sign in to make changes")
    return actor


def read_role(*roles: str):
    """Limit who may read an endpoint, as the role matrix does for screens.

    An anonymous caller is let through in dev mode only (reads are open there); in keycloak mode
    there is always a caller, and one without a matching role gets 403.
    """

    def dependency(actor: Actor | None = Depends(maybe_actor)) -> Actor | None:
        if actor is not None and not actor.has(*roles):
            raise HTTPException(403, f"Requires one of: {', '.join(roles)}")
        return actor

    return dependency


def require_role(*roles: str):
    def dependency(actor: Actor = Depends(current_actor)) -> Actor:
        if not actor.has(*roles):
            raise HTTPException(403, f"Requires one of: {', '.join(roles)}")
        return actor

    return dependency
