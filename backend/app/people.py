"""A directory of people, built from sign-ins, so actions can be assigned to real users.

Keycloak holds the accounts; the application only needs an id and a display name to name an owner.
A signed-in user is recorded at most every few minutes, so this adds no write to most requests.
"""

import time

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from . import clock
from .auth import Actor
from .models import Person

REFRESH_SECONDS = 300
_last: dict[str, float] = {}


def touch(session: Session, actor: Actor) -> None:
    now = time.monotonic()
    if now - _last.get(actor.id, -REFRESH_SECONDS) < REFRESH_SECONDS:
        return
    stmt = insert(Person).values(id=actor.id, name=actor.name, roles=sorted(actor.roles), source="login", last_seen=clock.now())
    session.execute(stmt.on_conflict_do_update(
        index_elements=[Person.id], set_={"name": stmt.excluded.name, "roles": stmt.excluded.roles, "source": "login", "last_seen": stmt.excluded.last_seen},
    ))
    session.commit()
    _last[actor.id] = now


def forget() -> None:
    """For tests."""
    _last.clear()
