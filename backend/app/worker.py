"""The worker: consumes messages from the outbox and processes them.

Each message is handled in its own transaction and claimed with FOR UPDATE SKIP LOCKED, so a crash
leaves it pending and a second worker never takes the same one. Delivery is at-least-once;
processing is idempotent (a processed ingestion is skipped, duplicates are recognised), so a
retry never creates a second alert. Transient failures back off and, after the allowed attempts,
the message moves to the dead-letter list. When Kafka arrives, only claim() and the publish side change.

    python -m app.worker            # run until stopped
"""

import logging
import signal
import time
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, clock
from .config import get_settings
from .db import get_engine
from .envelope import TOPIC_RAW, TOPIC_REPLAY, RawObjectEnvelope, ReplayEnvelope
from .ids import next_id
from .models import DeadLetter, Ingestion, Outbox, QuarantineItem
from .processing import PermanentError, process_raw, process_replay

log = logging.getLogger("worker")


def _dispatch(session: Session, msg: Outbox) -> None:
    if msg.topic == TOPIC_RAW:
        process_raw(session, RawObjectEnvelope.model_validate(msg.payload))
    elif msg.topic == TOPIC_REPLAY:
        env = ReplayEnvelope.model_validate(msg.payload)
        process_replay(session, env.quarantine_id, env.requested_by)
    else:
        raise PermanentError(f"Unknown topic {msg.topic}")


def _dead_letter(session: Session, msg: Outbox, reason: str) -> None:
    payload = msg.payload
    source_id, object_key = payload.get("source_id"), payload.get("object_key", "")
    if payload.get("quarantine_id"):
        q = session.get(QuarantineItem, payload["quarantine_id"])
        source_id, object_key = (q.source_id, q.object_key) if q else (source_id, object_key)
    if source_id:
        session.add(DeadLetter(
            id=next_id(session, DeadLetter.id, "DL-", 4), source_id=source_id, received_at=clock.now(), reason=reason,
            object_key=object_key, attempts=msg.attempts,
        ))
    if payload.get("ingestion_id"):
        ing = session.get(Ingestion, payload["ingestion_id"])
        if ing:
            ing.status, ing.error = "failed", reason
    audit.record(session, "Ingestion worker", "message.dead", f"{msg.topic}:{msg.key}", reason)
    msg.status = "dead"


def run_once(engine=None) -> bool:
    """Process one ready message. Returns False when there was nothing to do."""
    settings = get_settings()
    with Session(engine or get_engine()) as session:
        msg = session.scalars(
            select(Outbox).where(Outbox.status == "pending", Outbox.available_at <= clock.now())
            .order_by(Outbox.id).limit(1).with_for_update(skip_locked=True)
        ).first()
        if msg is None:
            return False
        try:
            with session.begin_nested():  # a failure undoes this message's partial work, not the message itself
                _dispatch(session, msg)
            msg.status, msg.processed_at, msg.last_error = "done", clock.now(), None
        except PermanentError as exc:
            msg.attempts += 1
            msg.last_error = str(exc)[:500]
            _dead_letter(session, msg, str(exc))
        except Exception as exc:  # transient: storage briefly missing, database hiccup, a bug to be fixed and retried
            msg.attempts += 1
            msg.last_error = f"{type(exc).__name__}: {exc}"[:500]
            if msg.attempts >= settings.worker_max_attempts:
                _dead_letter(session, msg, f"Gave up after {msg.attempts} attempts: {msg.last_error}")
            else:
                msg.available_at = clock.now() + timedelta(seconds=2**msg.attempts)
            log.warning("message %s failed (attempt %d): %s", msg.id, msg.attempts, msg.last_error)
        session.commit()
        return True


def drain(engine=None, limit: int = 1000) -> int:
    n = 0
    while n < limit and run_once(engine):
        n += 1
    return n


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    log.info("worker started")
    while not stop:
        try:
            if not run_once():
                time.sleep(get_settings().worker_poll_seconds)
        except Exception:  # keep the loop alive; the failing message is retried or dead-lettered
            log.exception("worker loop error")
            time.sleep(get_settings().worker_poll_seconds)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
