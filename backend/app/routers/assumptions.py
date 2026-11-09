from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import assess, audit, clock
from .. import scope
from ..auth import Actor, read_role, require_role
from ..deps import get_session
from ..ids import next_id
from ..models import Alert, Assessment, Assumption
from ..routers.alerts import assumption_out
from ..schemas import AssumptionDecisionIn, AssumptionIn, AssumptionOut

router = APIRouter(prefix="/api", tags=["assumptions"])


def _pct(a: Assumption) -> str:
    return format(a.affected_share_pct.normalize(), "f")


@router.get("/assumptions", response_model=list[AssumptionOut])
def list_assumptions(
    alert_id: str | None = Query(None, alias="alertId"),
    status: str | None = Query(None, pattern="^(proposed|approved|rejected|superseded)$"),
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(read_role("analyst", "steward", "admin")),
) -> list[AssumptionOut]:
    """The assumptions library, newest first."""
    query = select(Assumption).order_by(Assumption.proposed_at.desc(), Assumption.id.desc())
    if (visible := scope.clause(actor, Alert.commodity)) is not None:
        query = query.where(Assumption.alert_id.in_(select(Alert.id).where(visible)))
    if alert_id:
        query = query.where(Assumption.alert_id == alert_id)
    if status:
        query = query.where(Assumption.status == status)
    return [assumption_out(a) for a in session.scalars(query)]


@router.post("/alerts/{alert_id}/assumptions", response_model=AssumptionOut, status_code=201)
def propose_assumption(
    alert_id: str,
    body: AssumptionIn,
    actor: Actor = Depends(require_role("analyst")),
    session: Session = Depends(get_session),
) -> AssumptionOut:
    """Propose the share of exposed volume a disruption affects.

    It replaces any current assumption. Until a different analyst approves it, at-risk volume,
    gap and cost stay unavailable.
    """
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, f"Alert {alert_id} not found")
    scope.require(actor, alert.commodity, f"Alert {alert_id} not found")
    if assess.load(session, alert_id) is None:
        raise HTTPException(409, "This alert has no assessment yet, so there is nothing to apply an assumption to")

    new_id = next_id(session, Assumption.id, f"AS-{alert.commodity[0].upper()}-")
    for old in session.scalars(select(Assumption).where(Assumption.alert_id == alert_id, Assumption.status.in_(("proposed", "approved")))):
        old.status = "superseded"
    session.flush()  # free the one-active-assumption slot before inserting
    a = Assumption(
        id=new_id, alert_id=alert_id, affected_share_pct=body.affected_share_pct, basis=body.basis,
        proposed_by_id=actor.id, proposed_by_name=actor.name, proposed_at=clock.now(), status="proposed",
    )
    session.add(a)
    audit.record(session, actor.name, "assumption.proposed", new_id, f"{_pct(a)}% affected share")
    session.commit()
    return assumption_out(a)


@router.post("/assumptions/{assumption_id}/decision", response_model=AssumptionOut)
def decide_assumption(
    assumption_id: str,
    body: AssumptionDecisionIn,
    actor: Actor = Depends(require_role("analyst")),
    session: Session = Depends(get_session),
) -> AssumptionOut:
    """Approve or reject a proposed assumption. The proposer cannot decide their own.

    Approval creates a new assessment snapshot; earlier snapshots are never rewritten.
    """
    a = session.get(Assumption, assumption_id, with_for_update=True)
    if a is None:
        raise HTTPException(404, f"Assumption {assumption_id} not found")
    scope.require(actor, session.get(Alert, a.alert_id).commodity, f"Assumption {assumption_id} not found")
    if a.status != "proposed":
        raise HTTPException(409, f"This assumption is {a.status}; only a proposed assumption can be decided")
    if a.proposed_by_id == actor.id:
        raise HTTPException(403, "You proposed this assumption; a different analyst must decide it")

    now = clock.now()
    a.status, a.decided_by_id, a.decided_by_name, a.decided_at, a.decision_note = (
        body.decision, actor.id, actor.name, now, body.note or None,
    )
    if body.decision == "approved":
        ctx = assess.load(session, a.alert_id)
        latest = ctx.snapshot
        session.add(
            Assessment(
                alert_id=a.alert_id, version=latest.version + 1, created_at=now, calc_version=latest.calc_version,
                note=f"Assumption {a.id} approved ({_pct(a)}% affected share)", assumption_id=a.id,
                exposed_value=latest.exposed_value, exposed_unit=latest.exposed_unit, exposed_horizon=latest.exposed_horizon,
                reference_option_id=latest.reference_option_id, inputs=latest.inputs, paths=latest.paths, missing=latest.missing,
            )
        )
    audit.record(session, actor.name, f"assumption.{body.decision}", a.id, body.note or body.decision)
    session.commit()
    return assumption_out(a)
