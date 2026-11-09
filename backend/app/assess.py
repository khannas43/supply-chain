"""The latest assessment snapshot for an alert, with the assumption it rests on and its calculation."""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc
from .models import Assessment, Assumption, ResponseOption


@dataclass
class Context:
    snapshots: list[Assessment]
    reference: ResponseOption | None
    active: Assumption | None  # latest proposed or approved (or rejected) assumption
    approved: Assumption | None  # the approved assumption the snapshot is bound to
    reason: str | None  # why dependent measures are unavailable

    @property
    def snapshot(self) -> Assessment:
        return self.snapshots[-1]


def active_assumption(session: Session, alert_id: str) -> Assumption | None:
    return session.scalars(
        select(Assumption)
        .where(Assumption.alert_id == alert_id, Assumption.status != "superseded")
        .order_by(Assumption.proposed_at.desc())
    ).first()


def load(session: Session, alert_id: str) -> Context | None:
    """None when the alert has no assessment yet."""
    snapshots = list(session.scalars(select(Assessment).where(Assessment.alert_id == alert_id).order_by(Assessment.version)))
    if not snapshots:
        return None
    snap = snapshots[-1]
    active = active_assumption(session, alert_id)
    bound = session.get(Assumption, snap.assumption_id) if snap.assumption_id else None
    approved = bound if bound is not None and bound.status == "approved" else None
    reason = None
    if approved is None:
        reason = {
            None: "No disruption assumption has been proposed.",
            "proposed": "The disruption assumption is awaiting approval.",
            "rejected": "The disruption assumption was rejected.",
        }.get(active.status if active else None, "Needs an approved disruption assumption.")
    return Context(snapshots, session.get(ResponseOption, snap.reference_option_id), active, approved, reason)


def calculate(ctx: Context, lead_days: int | None, price: Decimal | None) -> calc.Calc:
    i = ctx.snapshot.inputs
    return calc.calculate(
        usable_stock=calc.d(i["usableStock"]),
        demand_per_day=calc.d(i["demandPerDay"]),
        baseline_price=calc.d(i["baselinePrice"]),
        exposed_value=ctx.snapshot.exposed_value,
        approved_share_pct=ctx.approved.affected_share_pct if ctx.approved else None,
        unavailable_reason=ctx.reason,
        reference_lead_days=lead_days,
        reference_price=price,
    )
