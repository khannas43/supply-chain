from datetime import UTC, datetime

from sqlalchemy.orm import Session

from . import clock
from .models import AuditEvent


def record(session: Session, actor_name: str, event: str, ref: str, detail: str = "") -> None:
    """Add an audit event to the current transaction. The caller commits."""
    session.add(AuditEvent(at=clock.now(), actor=actor_name, event=event, ref=ref, detail=detail))
