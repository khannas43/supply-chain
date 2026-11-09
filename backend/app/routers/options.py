from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import assess, audit, calc, clock
from .. import options as rules
from ..auth import Actor, require_role
from ..deps import get_session
from ..ids import next_id
from ..models import Action, ActionStatusHistory, Alert, OptionShortlist, ResponseOption
from ..routers.actions import build_actions
from ..schemas import ActionOut, DecisionIn, OptionRowOut, ResponseOptionOut, ResponseOptionsOut, ShortlistIn

router = APIRouter(prefix="/api", tags=["response options"])


@router.get("/alerts/{alert_id}/options", response_model=ResponseOptionsOut)
def list_options(
    alert_id: str,
    as_of: date | None = Query(None, alias="asOf"),
    session: Session = Depends(get_session),
) -> ResponseOptionsOut:
    """Options for an alert: eligible ones ranked, inventory listed apart, ineligible ones with the reason.

    Gap and cost need an approved disruption assumption and stay null without one.
    """
    if session.get(Alert, alert_id) is None:
        raise HTTPException(404, f"Alert {alert_id} not found")
    ctx = assess.load(session, alert_id)
    if ctx is None:
        raise HTTPException(404, f"Alert {alert_id} has no assessment yet")
    today = as_of or clock.today()
    shortlisted = set(session.scalars(select(OptionShortlist.option_id)))
    demand = calc.d(ctx.snapshot.inputs["demandPerDay"])

    def row(o: ResponseOption, scored: rules.Scored, rank: int | None = None, reasons: list[str] | None = None) -> OptionRowOut:
        status, days = rules.quote_status(o, today)
        return OptionRowOut(
            option=ResponseOptionOut.model_validate(o), rank=rank, gap_days=scored.gap_days,
            incremental_cost=scored.incremental_cost, extra_cover_days=scored.extra_cover_days,
            quote_status=status, days_to_quote_expiry=days, shortlisted=o.id in shortlisted, reasons=reasons or [],
        )

    ranked, complementary, ineligible = [], [], []
    for o in session.scalars(select(ResponseOption).where(ResponseOption.alert_id == alert_id).order_by(ResponseOption.id)):
        reasons = rules.ineligible_reasons(o, today)
        scored = rules.Scored(o)
        if o.type == "inventory":
            if o.quantity_available is not None and demand > 0:
                scored.extra_cover_days = o.quantity_available / demand
        else:
            c = assess.calculate(ctx, o.lead_time_days, o.unit_price)
            scored.gap_days, scored.incremental_cost = c.gap_days, c.incremental_cost
        if reasons:
            ineligible.append(row(o, scored, reasons=reasons))
        elif o.type == "inventory":
            complementary.append(row(o, scored))
        else:
            ranked.append(scored)

    ranked.sort(key=rules.rank_key)
    cover = assess.calculate(ctx, None, None).cover_days
    return ResponseOptionsOut(
        alert_id=alert_id, assessment_version=ctx.snapshot.version, currency=ctx.snapshot.inputs["currency"], cover_days=cover,
        assumption_status=ctx.active.status if ctx.active else "none", unavailable_reason=ctx.reason,
        ranked=[row(s.option, s, rank=i + 1) for i, s in enumerate(ranked)],
        complementary=complementary, ineligible=ineligible,
    )


@router.post("/options/{option_id}/shortlist", response_model=dict)
def set_shortlist(
    option_id: str,
    body: ShortlistIn,
    actor: Actor = Depends(require_role("analyst", "manager")),
    session: Session = Depends(get_session),
) -> dict:
    if session.get(ResponseOption, option_id) is None:
        raise HTTPException(404, f"Option {option_id} not found")
    current = session.get(OptionShortlist, option_id)
    if body.shortlisted and current is None:
        session.add(OptionShortlist(option_id=option_id, shortlisted_by_id=actor.id, shortlisted_by_name=actor.name, shortlisted_at=clock.now()))
    elif not body.shortlisted and current is not None:
        session.delete(current)
    session.commit()
    return {"optionId": option_id, "shortlisted": body.shortlisted}


@router.post("/options/{option_id}/decision", response_model=ActionOut, status_code=201)
def create_decision(
    option_id: str,
    body: DecisionIn,
    actor: Actor = Depends(require_role("manager")),
    session: Session = Depends(get_session),
) -> ActionOut:
    """Record the chosen response as an action with an owner and target date.

    Only eligible options can be chosen. The decision records the assessment version and the
    assumption status it was made on. Nothing here places an order.
    """
    option = session.get(ResponseOption, option_id)
    if option is None:
        raise HTTPException(404, f"Option {option_id} not found")
    alert = session.get(Alert, option.alert_id)
    ctx = assess.load(session, option.alert_id)
    if ctx is None:
        raise HTTPException(409, "This alert has no assessment yet")
    today = clock.today()
    reasons = rules.ineligible_reasons(option, today)
    if reasons:
        raise HTTPException(422, "This option is not eligible: " + " ".join(reasons))
    if body.target_date < today:
        raise HTTPException(422, "The target date cannot be in the past")

    now = clock.now()
    action = Action(
        id=next_id(session, Action.id, f"AC-{alert.commodity[0].upper()}-", 3), alert_id=alert.id,
        commodity=alert.commodity, option_id=option.id, owner_id=body.owner_id, owner_name=body.owner_name,
        target_date=body.target_date, rationale=body.rationale, status="open", created_at=now, created_by=actor.name,
        assessment_version=ctx.snapshot.version, assumption_status=ctx.active.status if ctx.active else "none",
    )
    session.add(action)
    session.flush()
    session.add(ActionStatusHistory(action_id=action.id, at=now, actor=actor.name, from_status=None, to_status="open", note="Decision recorded"))
    audit.record(session, actor.name, "decision.created", action.id, f"{option.name}, owner {body.owner_name}")
    session.commit()
    return build_actions(session, [action], today)[0]
