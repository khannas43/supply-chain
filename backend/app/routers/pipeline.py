from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..auth import Actor, require_role
from ..deps import get_session
from ..models import DeadLetter, IngestionRun, QuarantineItem, Source, SourceCommodity
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
) -> list[RunOut]:
    query = select(IngestionRun).order_by(IngestionRun.started_at.desc(), IngestionRun.id.desc()).limit(limit)
    if source_id:
        query = query.where(IngestionRun.source_id == source_id)
    return [RunOut.model_validate(r) for r in session.scalars(query)]


@router.get("/quarantine", response_model=list[QuarantineOut])
def list_quarantine(
    status: str | None = Query(None, pattern="^(quarantined|replay_requested)$"),
    session: Session = Depends(get_session),
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
    """Save a corrected value and request a controlled replay of the record.

    The replay itself runs through the ingestion pipeline once that is connected; nothing repairs
    business meaning automatically.
    """
    q = session.get(QuarantineItem, item_id, with_for_update=True)
    if q is None:
        raise HTTPException(404, f"Quarantine item {item_id} not found")
    if q.status != "quarantined":
        raise HTTPException(409, "A replay has already been requested for this record")
    q.status, q.correction = "replay_requested", body.correction
    audit.record(session, actor.name, "quarantine.replay_requested", item_id, f"corrected value: {body.correction}")
    session.commit()
    names = _names(session)
    return QuarantineOut(
        id=q.id, source_id=q.source_id, source_name=names.get(q.source_id, q.source_id), run_id=q.run_id,
        received_at=q.received_at, reason=q.reason, source_row=q.source_row, object_key=q.object_key, field=q.field,
        bad_value=q.bad_value, status=q.status, correction=q.correction,
    )


@router.get("/dead-letter", response_model=list[DeadOut])
def list_dead_letter(session: Session = Depends(get_session)) -> list[DeadOut]:
    names = _names(session)
    rows = session.scalars(select(DeadLetter).order_by(DeadLetter.received_at.desc()))
    return [
        DeadOut(id=d.id, source_id=d.source_id, source_name=names.get(d.source_id, d.source_id), received_at=d.received_at,
                reason=d.reason, object_key=d.object_key, attempts=d.attempts)
        for d in rows
    ]


@router.get("/pipeline/queue", response_model=QueueOut)
def queue() -> QueueOut:
    """Kafka and NiFi are not connected yet; this says so instead of showing a made-up figure."""
    return QueueOut(worker_backlog=0, kafka="not_connected", nifi="not_connected")
