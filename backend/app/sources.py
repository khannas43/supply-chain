from datetime import datetime

from .models import Source


def hours_since(moment: datetime | None, now: datetime) -> float | None:
    return None if moment is None else (now - moment).total_seconds() / 3600


def state(source: Source, now: datetime) -> str:
    """Staleness and failure are source-health states; they never read as healthy."""
    if not source.enabled:
        return "paused"
    if source.last_error:
        return "failing"
    age = hours_since(source.last_usable, now)
    return "stale" if age is None or age > source.policy_hours else "fresh"
