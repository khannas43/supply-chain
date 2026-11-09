"""Commodity scope: a user whose token carries a commodity_scope sees only those commodities.

Out-of-scope items answer 404, the same as missing ones, so their existence is not revealed.
"""

from fastapi import HTTPException

from .auth import Actor


def allowed(actor: Actor | None, commodity: str) -> bool:
    return actor is None or actor.scope is None or commodity in actor.scope


def require(actor: Actor | None, commodity: str, what: str = "Not found") -> None:
    if not allowed(actor, commodity):
        raise HTTPException(404, what)


def clause(actor: Actor | None, column):
    """An SQL condition for list queries, or None when the user sees everything."""
    return None if actor is None or actor.scope is None else column.in_(sorted(actor.scope))
