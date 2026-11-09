"""Caller identity for write endpoints.

Dev mode trusts X-Actor-Id, X-Actor-Name and X-Actor-Role headers. When Keycloak is connected,
`current_actor` validates the access token instead and nothing else here changes.
Read endpoints are not authenticated yet.
"""

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from .config import get_settings


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    role: str


def current_actor(
    x_actor_id: str | None = Header(None),
    x_actor_name: str | None = Header(None),
    x_actor_role: str | None = Header(None),
) -> Actor:
    if get_settings().auth_mode != "dev":
        raise HTTPException(501, "Token authentication is not implemented yet")
    if not (x_actor_id and x_actor_name and x_actor_role):
        raise HTTPException(401, "Sign in to make changes")
    return Actor(x_actor_id, x_actor_name, x_actor_role)


def require_role(*roles: str):
    def dependency(actor: Actor = Depends(current_actor)) -> Actor:
        if actor.role not in roles:
            raise HTTPException(403, f"Requires one of: {', '.join(roles)}")
        return actor

    return dependency
