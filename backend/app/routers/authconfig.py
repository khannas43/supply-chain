from fastapi import APIRouter

from ..config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
def auth_config() -> dict:
    """What the browser needs to sign in. Public, and contains nothing secret."""
    s = get_settings()
    if s.auth_mode == "keycloak":
        return {"mode": "keycloak", "authority": s.keycloak_issuer, "clientId": s.keycloak_client_id}
    return {"mode": "dev"}
