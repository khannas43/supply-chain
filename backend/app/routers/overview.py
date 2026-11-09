from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import sources as source_health
from ..deps import get_session
from ..models import Action, Alert, Assessment, Source, SourceCommodity
from ..schemas import ActionCountsOut, Commodity, OverviewOut, SourceOut, TrendPoint

router = APIRouter(prefix="/api", tags=["overview"])


def source_out(s: Source, commodities: list[str], now: datetime) -> SourceOut:
    age = source_health.hours_since(s.last_usable, now)
    return SourceOut(
        id=s.id, name=s.name, mode=s.mode, enabled=s.enabled, commodities=commodities,
        last_attempt=s.last_attempt, last_usable=s.last_usable, policy_hours=s.policy_hours,
        last_error=s.last_error, state=source_health.state(s, now),
        hours_since_usable=round(age, 1) if age is not None else None,
    )


def _sources(session: Session, now: datetime, commodity: str | None) -> list[SourceOut]:
    by_source: dict[str, list[str]] = {}
    for sc in session.scalars(select(SourceCommodity).order_by(SourceCommodity.commodity)):
        by_source.setdefault(sc.source_id, []).append(sc.commodity)
    rows = session.scalars(select(Source).order_by(Source.name))
    return [source_out(s, by_source.get(s.id, []), now) for s in rows if commodity is None or commodity in by_source.get(s.id, [])]


@router.get("/sources", response_model=list[SourceOut])
def list_sources(
    commodity: Commodity | None = None,
    as_of: datetime | None = Query(None, alias="asOf"),
    session: Session = Depends(get_session),
) -> list[SourceOut]:
    return _sources(session, as_of or datetime.now(UTC), commodity)


@router.get("/overview", response_model=OverviewOut)
def overview(
    commodity: Commodity,
    as_of: datetime | None = Query(None, alias="asOf"),
    session: Session = Depends(get_session),
) -> OverviewOut:
    """Everything the overview screen needs except the alert list itself."""
    now = as_of or datetime.now(UTC)
    active = list(session.scalars(select(Alert).where(Alert.commodity == commodity, Alert.disposition != "dismissed")))
    by_severity: dict[str, int] = {}
    for a in active:
        by_severity[a.severity] = by_severity.get(a.severity, 0) + 1
    active_ids = [a.id for a in active]
    assessed = set(session.scalars(select(Assessment.alert_id).where(Assessment.alert_id.in_(active_ids)).distinct()))

    counts = dict(session.execute(select(Action.status, func.count()).where(Action.commodity == commodity).group_by(Action.status)).all())
    last_assessment = session.scalar(
        select(func.max(Assessment.created_at)).join(Alert, Alert.id == Assessment.alert_id).where(Alert.commodity == commodity)
    )

    today = now.astimezone(UTC).date()
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]
    day = func.date(func.timezone("UTC", Alert.observed_at))
    per_day = dict(
        session.execute(
            select(day, func.count()).where(Alert.commodity == commodity, day.between(days[0], days[-1])).group_by(day)
        ).all()
    )
    return OverviewOut(
        commodity=commodity, as_of=now, active_alerts=len(active), alerts_by_severity=by_severity,
        assessed_alerts=len(assessed), actions=ActionCountsOut(
            open=counts.get("open", 0), in_progress=counts.get("in_progress", 0),
            review=counts.get("review", 0), done=counts.get("done", 0),
        ),
        last_assessment_at=last_assessment, trend=[TrendPoint(day=d, count=per_day.get(d, 0)) for d in days],
        sources=_sources(session, now, commodity),
    )
