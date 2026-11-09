"""Collection: acquire a payload, preserve the original, and hand it to processing.

This is the job NiFi will do. It does only technical work (store the bytes, record where they
came from, publish a message); it does not read the business content. Collecting the same bytes
from the same source twice records a duplicate and stops.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import clock
from .envelope import TOPIC_RAW, RawObjectEnvelope
from .ids import next_id
from .models import Evidence, Ingestion, IngestionRun, Outbox, Source
from .storage import get_store, sha256


@dataclass
class Collected:
    ingestion_id: str
    object_key: str
    duplicate: bool


def add_run(session: Session, source_id: str, status: str, accepted: int, duplicate: int, quarantined: int, note: str) -> None:
    session.add(IngestionRun(
        id=next_id(session, IngestionRun.id, "RUN-", 4), source_id=source_id, started_at=clock.now(), status=status,
        accepted=accepted, duplicate=duplicate, quarantined=quarantined, note=note,
    ))
    session.flush()


def collect(
    session: Session,
    source_id: str,
    body: bytes,
    *,
    mode: str,
    scenario_run: str | None = None,
    published_at: datetime | None = None,
    content_type: str = "application/json",
) -> Collected:
    now = clock.now()
    digest = sha256(body)
    source = session.get(Source, source_id)
    if source is None:
        raise ValueError(f"Unknown source {source_id}")
    source.last_attempt = now

    previous = session.scalars(select(Ingestion).where(Ingestion.source_id == source_id, Ingestion.sha256 == digest)).first()
    if previous is not None:
        add_run(session, source_id, "ok", 0, 1, 0, f"Duplicate delivery ignored (already collected as {previous.id})")
        return Collected(previous.id, previous.object_key, True)

    ing_id = next_id(session, Ingestion.id, "ING-", 5)
    key = f"evidence/{mode}/{source_id}/{now:%Y%m%d}/{ing_id}-{digest[:12]}.json"
    get_store().put(key, body)  # before the database commit: an orphaned object is harmless, a missing one is not
    session.add(Evidence(
        id=f"EV-{ing_id}", source=source.name, object_key=key, sha256=digest, published_at=published_at or now,
        ingested_at=now, mode=mode, scenario_run=scenario_run,
    ))
    session.flush()
    session.add(Ingestion(
        id=ing_id, source_id=source_id, received_at=now, evidence_id=f"EV-{ing_id}", object_key=key, sha256=digest,
        mode=mode, scenario_run=scenario_run, status="received",
    ))
    session.flush()
    envelope = RawObjectEnvelope(
        event_id=f"evt-{ing_id}", source_id=source_id, ingestion_id=ing_id, mode=mode, scenario_run=scenario_run,
        object_key=key, sha256=digest, content_type=content_type, collected_at=now,
    )
    session.add(Outbox(topic=TOPIC_RAW, key=ing_id, payload=envelope.model_dump(mode="json"), created_at=now, available_at=now))
    session.flush()
    return Collected(ing_id, key, False)
