from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, clock
from .. import scope
from ..auth import Actor, current_actor, maybe_actor, require_role
from ..deps import get_session
from ..models import Action, ActionStatusHistory, Alert, Assessment, AuditEvent, ResponseOption
from ..schemas import ActionOut, AuditOut, Commodity, ReassignIn, StatusEntryOut, StatusIn

router = APIRouter(prefix="/api/actions", tags=["actions"])

ACTION_STATUSES = ("open", "in_progress", "review", "done")


def build_actions(session: Session, actions: list[Action], today: date, with_audit: bool = False) -> list[ActionOut]:
    if not actions:
        return []
    ids = [a.id for a in actions]
    alert_ids = {a.alert_id for a in actions}
    titles = dict(session.execute(select(Alert.id, Alert.title).where(Alert.id.in_(alert_ids))).all())
    options = dict(session.execute(select(ResponseOption.id, ResponseOption.name).where(ResponseOption.id.in_({a.option_id for a in actions}))).all())
    current = dict(session.execute(select(Assessment.alert_id, func.max(Assessment.version)).where(Assessment.alert_id.in_(alert_ids)).group_by(Assessment.alert_id)).all())
    history: dict[str, list[ActionStatusHistory]] = {i: [] for i in ids}
    for h in session.scalars(select(ActionStatusHistory).where(ActionStatusHistory.action_id.in_(ids)).order_by(ActionStatusHistory.at, ActionStatusHistory.id)):
        history[h.action_id].append(h)
    trail: dict[str, list[AuditEvent]] = {i: [] for i in ids}
    if with_audit:
        for e in session.scalars(select(AuditEvent).where(AuditEvent.ref.in_(ids)).order_by(AuditEvent.at, AuditEvent.id)):
            trail[e.ref].append(e)

    out = []
    for a in actions:
        version = current.get(a.alert_id, a.assessment_version)
        open_ = a.status != "done"
        out.append(
            ActionOut(
                id=a.id, alert_id=a.alert_id, alert_title=titles[a.alert_id], commodity=a.commodity, option_id=a.option_id,
                option_name=options[a.option_id], owner_id=a.owner_id, owner_name=a.owner_name, target_date=a.target_date,
                rationale=a.rationale, status=a.status, created_at=a.created_at, created_by=a.created_by,
                assessment_version=a.assessment_version, current_assessment_version=version, assumption_status=a.assumption_status,
                overdue=open_ and a.target_date < today, review_needed=open_ and a.assessment_version < version,
                history=[StatusEntryOut(at=h.at, actor=h.actor, from_status=h.from_status, to_status=h.to_status, note=h.note) for h in history[a.id]],
                audit=[AuditOut.model_validate(e) for e in trail[a.id]],
            )
        )
    return out


def _today(as_of: date | None) -> date:
    return as_of or clock.today()


@router.get("", response_model=list[ActionOut])
def list_actions(
    commodity: Commodity | None = None,
    status: str | None = Query(None, pattern="^(open|in_progress|review|done)$"),
    owner_id: str | None = Query(None, alias="ownerId"),
    overdue_only: bool = Query(False, alias="overdueOnly"),
    as_of: date | None = Query(None, alias="asOf"),
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> list[ActionOut]:
    today = _today(as_of)
    query = select(Action).order_by(Action.target_date, Action.id)
    if (visible := scope.clause(actor, Action.commodity)) is not None:
        query = query.where(visible)
    for column, value in ((Action.commodity, commodity), (Action.status, status), (Action.owner_id, owner_id)):
        if value is not None:
            query = query.where(column == value)
    if overdue_only:
        query = query.where(Action.status != "done", Action.target_date < today)
    return build_actions(session, list(session.scalars(query)), today)


def _get(session: Session, action_id: str) -> Action:
    action = session.get(Action, action_id, with_for_update=False)
    if action is None:
        raise HTTPException(404, f"Action {action_id} not found")
    return action


@router.get("/{action_id}", response_model=ActionOut)
def get_action(
    action_id: str,
    as_of: date | None = Query(None, alias="asOf"),
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> ActionOut:
    action = _get(session, action_id)
    scope.require(actor, action.commodity, f"Action {action_id} not found")
    return build_actions(session, [action], _today(as_of), with_audit=True)[0]


@router.post("/{action_id}/status", response_model=ActionOut)
def set_status(action_id: str, body: StatusIn, actor: Actor = Depends(current_actor), session: Session = Depends(get_session)) -> ActionOut:
    """Move an action to another status.

    A Procurement Manager can set any status, including closing and reopening. The assigned owner
    and a Platform Admin can set in progress or in review.
    """
    action = session.get(Action, action_id, with_for_update=True)
    if action is None:
        raise HTTPException(404, f"Action {action_id} not found")
    scope.require(actor, action.commodity, f"Action {action_id} not found")
    manager = actor.has("manager")
    if actor.has("demo_operator") and len(actor.roles) == 1 or not (manager or actor.has("admin") or actor.id == action.owner_id):
        raise HTTPException(403, "Only the owner, a Procurement Manager or an Admin can update this action")
    if not manager and body.status not in ("in_progress", "review"):
        raise HTTPException(403, "Only a Procurement Manager can set an action to open or done")
    if not manager and action.status == "done":
        raise HTTPException(403, "Only a Procurement Manager can reopen a closed action")
    if body.status == action.status:
        raise HTTPException(409, f"The action is already {action.status}")

    previous, now = action.status, clock.now()
    action.status = body.status
    session.add(ActionStatusHistory(action_id=action.id, at=now, actor=actor.name, from_status=previous, to_status=body.status, note=body.note))
    audit.record(session, actor.name, "action.status", action.id, f"{body.status}{': ' + body.note if body.note else ''}")
    session.commit()
    return build_actions(session, [action], _today(None), with_audit=True)[0]


@router.post("/{action_id}/reassign", response_model=ActionOut)
def reassign(action_id: str, body: ReassignIn, actor: Actor = Depends(require_role("manager")), session: Session = Depends(get_session)) -> ActionOut:
    action = session.get(Action, action_id, with_for_update=True)
    if action is None:
        raise HTTPException(404, f"Action {action_id} not found")
    scope.require(actor, action.commodity, f"Action {action_id} not found")
    if body.owner_id == action.owner_id:
        raise HTTPException(409, f"{action.owner_name} already owns this action")
    action.owner_id, action.owner_name = body.owner_id, body.owner_name
    note = f"Reassigned to {body.owner_name}{': ' + body.note if body.note else ''}"
    session.add(ActionStatusHistory(action_id=action.id, at=clock.now(), actor=actor.name, from_status=action.status, to_status=action.status, note=note))
    audit.record(session, actor.name, "action.reassigned", action.id, f"to {body.owner_name}")
    session.commit()
    return build_actions(session, [action], _today(None), with_audit=True)[0]
