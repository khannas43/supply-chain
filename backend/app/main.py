import httpx
from fastapi import APIRouter, FastAPI
from sqlalchemy import text

from .config import get_settings
from .db import get_engine
from .routers import alerts, network, overview

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    """Liveness only: the process is up. Dependencies are checked separately."""
    return {"status": "ok"}


@router.get("/health/db")
def health_db() -> dict:
    try:
        with get_engine().connect() as conn:
            postgres = conn.execute(text("SELECT split_part(version(), ' ', 2)")).scalar_one()
            postgis = conn.execute(text("SELECT postgis_version()")).scalar_one()
    except Exception as exc:  # report the failure instead of hiding it
        return {"status": "down", "detail": type(exc).__name__}
    return {"status": "ok", "postgres": postgres, "postgis": postgis}


@router.get("/health/keycloak")
def health_keycloak() -> dict:
    """Reports whether the configured realm is reachable. Not required for the API to run."""
    s = get_settings()
    url = f"{s.keycloak_internal_url}/realms/{s.keycloak_realm}/.well-known/openid-configuration"
    try:
        r = httpx.get(url, timeout=3.0)
    except httpx.HTTPError as exc:
        return {"status": "unreachable", "detail": type(exc).__name__, "url": url}
    if r.status_code == 404:
        return {"status": "realm_missing", "realm": s.keycloak_realm, "url": url}
    if r.status_code != 200:
        return {"status": "error", "http_status": r.status_code, "url": url}
    return {"status": "ok", "issuer": r.json().get("issuer"), "expected_issuer": s.keycloak_issuer}


app = FastAPI(
    title="Supply Chain Risk API",
    version="0.0.1",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.include_router(router)
app.include_router(alerts.router)
app.include_router(network.router)
app.include_router(overview.router)
