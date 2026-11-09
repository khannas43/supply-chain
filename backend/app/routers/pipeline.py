from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..auth import Actor, read_role, require_role
from ..deps import get_session
from ..envelope import TOPIC_REPLAY, ReplayEnvelope
from ..models import DeadLetter, Evidence, IngestionRun, Outbox, QuarantineItem, Source, SourceCommodity
from ..storage import EvidenceMissing, get_store, sha256
from ..routers.overview import source_out
from .. import clock
from ..schemas import DeadOut, EnabledIn, QuarantineOut, QueueOut, ReplayIn, RunOut, SourceOut

router = APIRouter(prefix="/api", tags=["pipeline"])


def _names(session: Session) -> dict[str, str]:
    return dict(session.execute(select(Source.id, Source.name)).all())


@router.post("/sources/{source_id}/enabled", response_model=SourceOut)
def set_enabled(
    source_id: str,
    body: EnabledIn,
    actor: Actor = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> SourceOut:
    """Pause or enable collection from a source. Existing data stays; its freshness keeps ageing."""
    src = session.get(Source, source_id)
    if src is None:
        raise HTTPException(404, f"Source {source_id} not found")
    if src.enabled == body.enabled:
        raise HTTPException(409, f"The source is already {'enabled' if body.enabled else 'paused'}")
    src.enabled = body.enabled
    audit.record(session, actor.name, "source.enabled" if body.enabled else "source.paused", source_id, src.name)
    session.commit()
    commodities = list(session.scalars(select(SourceCommodity.commodity).where(SourceCommodity.source_id == source_id)))
    return source_out(src, commodities, clock.now())


@router.get("/runs", response_model=list[RunOut])
def list_runs(
    source_id: str | None = Query(None, alias="sourceId"),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    _actor: Actor | None = Depends(read_role("analyst", "steward", "admin", "demo_operator")),
) -> list[RunOut]:
    query = select(IngestionRun).order_by(IngestionRun.started_at.desc(), IngestionRun.id.desc()).limit(limit)
    if source_id:
        query = query.where(IngestionRun.source_id == source_id)
    return [RunOut.model_validate(r) for r in session.scalars(query)]


@router.get("/quarantine", response_model=list[QuarantineOut])
def list_quarantine(
    status: str | None = Query(None, pattern="^(quarantined|replay_requested|resolved)$"),
    session: Session = Depends(get_session),
    _actor: Actor | None = Depends(read_role("analyst", "steward", "admin", "demo_operator")),
) -> list[QuarantineOut]:
    names = _names(session)
    query = select(QuarantineItem).order_by(QuarantineItem.received_at.desc(), QuarantineItem.id.desc())
    if status:
        query = query.where(QuarantineItem.status == status)
    return [
        QuarantineOut(
            id=q.id, source_id=q.source_id, source_name=names.get(q.source_id, q.source_id), run_id=q.run_id,
            received_at=q.received_at, reason=q.reason, source_row=q.source_row, object_key=q.object_key,
            field=q.field, bad_value=q.bad_value, status=q.status, correction=q.correction,
        )
        for q in session.scalars(query)
    ]


@router.post("/quarantine/{item_id}/replay", response_model=QuarantineOut)
def request_replay(
    item_id: str,
    body: ReplayIn,
    actor: Actor = Depends(require_role("steward", "admin")),
    session: Session = Depends(get_session),
) -> QuarantineOut:
    """Save a corrected value and queue a controlled replay of the record.

    The worker applies the correction to the original record and runs it through the same pipeline;
    it resolves the item on success, or puts it back in quarantine with the new reason. Nothing
    repairs business meaning automatically.
    """
    q = session.get(QuarantineItem, item_id, with_for_update=True)
    if q is None:
        raise HTTPException(404, f"Quarantine item {item_id} not found")
    if q.status != "quarantined":
        raise HTTPException(409, "A replay has already been requested for this record")
    q.status, q.correction = "replay_requested", body.correction
    attempt = session.scalar(select(func.count()).select_from(Outbox).where(Outbox.topic == TOPIC_REPLAY, Outbox.key.like(f"{item_id}:%"))) + 1
    now = clock.now()
    envelope = ReplayEnvelope(event_id=f"evt-{item_id}-{attempt}", quarantine_id=item_id, requested_by=actor.name, requested_at=now)
    session.add(Outbox(topic=TOPIC_REPLAY, key=f"{item_id}:{attempt}", payload=envelope.model_dump(mode="json"), created_at=now, available_at=now))
    audit.record(session, actor.name, "quarantine.replay_requested", item_id, f"corrected value: {body.correction}")
    session.commit()
    names = _names(session)
    return QuarantineOut(
        id=q.id, source_id=q.source_id, source_name=names.get(q.source_id, q.source_id), run_id=q.run_id,
        received_at=q.received_at, reason=q.reason, source_row=q.source_row, object_key=q.object_key, field=q.field,
        bad_value=q.bad_value, status=q.status, correction=q.correction,
    )


@router.get("/dead-letter", response_model=list[DeadOut])
def list_dead_letter(session: Session = Depends(get_session), _actor: Actor | None = Depends(read_role("analyst", "steward", "admin", "demo_operator"))) -> list[DeadOut]:
    names = _names(session)
    rows = session.scalars(select(DeadLetter).order_by(DeadLetter.received_at.desc()))
    return [
        DeadOut(id=d.id, source_id=d.source_id, source_name=names.get(d.source_id, d.source_id), received_at=d.received_at,
                reason=d.reason, object_key=d.object_key, attempts=d.attempts)
        for d in rows
    ]


@router.get("/pipeline/queue", response_model=QueueOut)
def queue(session: Session = Depends(get_session), _actor: Actor | None = Depends(read_role("analyst", "steward", "admin", "demo_operator"))) -> QueueOut:
    """Messages waiting for the worker, and messages it gave up on. Kafka and NiFi are not connected yet."""
    counts = dict(session.execute(select(Outbox.status, func.count()).group_by(Outbox.status)).all())
    oldest = session.scalar(select(func.min(Outbox.available_at)).where(Outbox.status == "pending"))
    return QueueOut(
        worker_backlog=counts.get("pending", 0), dead_messages=counts.get("dead", 0),
        oldest_pending_seconds=max(0, int((clock.now() - oldest).total_seconds())) if oldest else None,
        kafka="not_connected", nifi="not_connected",
    )


@router.get("/evidence/{evidence_id}/raw")
def raw_evidence(
    evidence_id: str,
    actor: Actor = Depends(require_role("analyst", "manager", "steward", "admin")),
    session: Session = Depends(get_session),
) -> Response:
    """The original payload exactly as it was collected, after checking its checksum."""
    ev = session.get(Evidence, evidence_id)
    if ev is None:
        raise HTTPException(404, f"Evidence {evidence_id} not found")
    try:
        body = get_store().get(ev.object_key)
    except EvidenceMissing:
        raise HTTPException(404, "The original payload is not in storage (seeded demo evidence has no stored file)") from None
    if sha256(body) != ev.sha256:
        raise HTTPException(500, "The stored payload no longer matches its checksum")
    return Response(content=body, media_type="application/json", headers={"X-Content-SHA256": ev.sha256})
