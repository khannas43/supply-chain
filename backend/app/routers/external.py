from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Actor, read_role
from ..deps import get_session
from ..models import Evidence, Ingestion, Observation
from ..schemas import EvidenceOut, ExternalValueOut

router = APIRouter(prefix="/api", tags=["external"])


@router.get("/external-data", response_model=list[ExternalValueOut])
def external_data(
    commodity: str | None = Query(None, pattern="^tungsten$"),
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
    _actor: Actor | None = Depends(read_role("analyst", "manager", "steward", "admin", "demo_operator")),
) -> list[ExternalValueOut]:
    """Values from external providers (Credibl), newest as-of first, each with its provenance."""
    query = (
        select(Observation, Evidence)
        .join(Ingestion, Ingestion.id == Observation.ingestion_id)
        .join(Evidence, Evidence.id == Ingestion.evidence_id)
        .where(Observation.licence_class.is_not(None))
        .order_by(Observation.published_at.desc(), Observation.id.desc())
        .limit(limit)
    )
    if commodity:
        query = query.where(Observation.commodity == commodity)
    return [
        ExternalValueOut(
            id=o.id, indicator=o.event_type, country=o.country, value=o.value, headline=o.headline, confidence_pct=o.confidence_pct,
            as_of=o.published_at, last_refreshed=o.source_refreshed_at, origin_source=o.origin_source, licence_class=o.licence_class,
            attribution=o.attribution_text, staleness=o.staleness_flag, completeness=o.completeness_flag, mode=o.mode,
            evidence=EvidenceOut.model_validate(e),
        )
        for o, e in session.execute(query)
    ]
