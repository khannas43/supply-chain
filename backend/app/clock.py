"""The application's notion of now. Tests freeze it; production never sets the override."""

from datetime import UTC, date, datetime

_override: datetime | None = None


def now() -> datetime:
    return _override or datetime.now(UTC)


def today() -> date:
    return now().date()


def freeze(moment: datetime | None) -> None:
    global _override
    _override = moment
