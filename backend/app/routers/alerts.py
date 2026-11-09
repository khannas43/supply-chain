from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import calc
from ..auth import Actor, require_role
from ..deps import get_session
from ..models import (
    Alert, AlertExposedNode, AuditEvent, Assessment, Assumption, Evidence, ResponseOption, Rule, RuleVersion,
)
from ..schemas import (
    AlertOut, AssessmentOut, AssumptionOut, CalcOut, Commodity, Disposition, DispositionIn, EvidenceOut, ExposedOut, Mode,
    PersonOut, ResponseOptionOut, Severity, VersionOut,
)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _latest_assessments(session: Session, alert_ids: list[str]) -> dict[str, Assessment]:
    rows = session.scalars(
        select(Assessment)
        .where(Assessment.alert_id.in_(alert_ids))
        .distinct(Assessment.alert_id)
        .order_by(Assessment.alert_id, Assessment.version.desc())
    )
    return {a.alert_id: a for a in rows}


def _active_assumption(session: Session, alert_id: str) -> Assumption | None:
    return session.scalars(
        select(Assumption)
        .where(Assumption.alert_id == alert_id, Assumption.status != "superseded")
        .order_by(Assumption.proposed_at.desc())
    ).first()


def _cover(inputs: dict) -> Decimal | None:
    return calc.cover_days(calc.d(inputs["usableStock"]), calc.d(inputs["demandPerDay"]))


def _build_alerts(session: Session, alerts: list[Alert]) -> list[AlertOut]:
    if not alerts:
        return []
    ids = [a.id for a in alerts]
    evidence = {e.id: e for e in session.scalars(select(Evidence).where(Evidence.id.in_([a.evidence_id for a in alerts])))}
    rules = {r.id: r.name for r in session.scalars(select(Rule))}
    exposed_nodes: dict[str, list[str]] = {i: [] for i in ids}
    for row in session.scalars(select(AlertExposedNode).where(AlertExposedNode.alert_id.in_(ids)).order_by(AlertExposedNode.position)):
        exposed_nodes[row.alert_id].append(row.node_id)
    latest = _latest_assessments(session, ids)

    out = []
    for a in alerts:
        asm = latest.get(a.id)
        out.append(
            AlertOut(
                id=a.id, commodity=a.commodity, title=a.title, summary=a.summary, location=a.location,
                severity=a.severity, confidence=a.confidence, observed_at=a.observed_at, mode=a.mode,
                scenario_run=a.scenario_run, assessment_status=a.assessment_status, disposition=a.disposition,
                rule_version=f"{rules[a.rule_id]} v{a.rule_v}", rule_inputs=a.rule_inputs,
                evidence=EvidenceOut.model_validate(evidence[a.evidence_id]),
                exposed_node_ids=exposed_nodes[a.id],
                exposed=ExposedOut(value=asm.exposed_value, unit=asm.exposed_unit, horizon=asm.exposed_horizon) if asm else None,
                days_of_cover=_cover(asm.inputs) if asm else None,
            )
        )
    return out


@router.get("", response_model=list[AlertOut])
def list_alerts(
    commodity: Commodity | None = None,
    severity: Severity | None = None,
    mode: Mode | None = None,
    disposition: Disposition | None = None,
    session: Session = Depends(get_session),
) -> list[AlertOut]:
    query = select(Alert).order_by(Alert.observed_at.desc(), Alert.id)
    for column, value in ((Alert.commodity, commodity), (Alert.severity, severity), (Alert.mode, mode), (Alert.disposition, disposition)):
        if value is not None:
            query = query.where(column == value)
    return _build_alerts(session, list(session.scalars(query)))


@router.get("/{alert_id}", response_model=AlertOut)
def get_alert(alert_id: str, session: Session = Depends(get_session)) -> AlertOut:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, f"Alert {alert_id} not found")
    return _build_alerts(session, [alert])[0]


@router.post("/{alert_id}/disposition", response_model=AlertOut)
def set_disposition(
    alert_id: str,
    body: DispositionIn,
    actor: Actor = Depends(require_role("analyst")),
    session: Session = Depends(get_session),
) -> AlertOut:
    """Confirm, monitor or dismiss an alert. A rationale is required and the change is audited."""
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, f"Alert {alert_id} not found")
    previous = alert.disposition
    alert.disposition = body.disposition
    session.add(
        AuditEvent(
            at=datetime.now(UTC), actor=actor.name, event="alert.disposition", ref=alert_id,
            detail=f"{previous} -> {body.disposition}: {body.rationale}",
        )
    )
    session.commit()
    return _build_alerts(session, [alert])[0]


def _assumption_out(a: Assumption) -> AssumptionOut:
    return AssumptionOut(
        id=a.id, alert_id=a.alert_id, affected_share_pct=a.affected_share_pct, basis=a.basis,
        proposed_by=PersonOut(id=a.proposed_by_id, name=a.proposed_by_name), proposed_at=a.proposed_at,
        status=a.status,
        decided_by=PersonOut(id=a.decided_by_id, name=a.decided_by_name) if a.decided_by_id else None,
        decided_at=a.decided_at, decision_note=a.decision_note,
    )


@router.get("/{alert_id}/assessment", response_model=AssessmentOut)
def get_assessment(alert_id: str, session: Session = Depends(get_session)) -> AssessmentOut:
    """The latest assessment snapshot with its calculated measures.

    Measures that need an approved disruption assumption stay null, with the reason, until one exists.
    """
    if session.get(Alert, alert_id) is None:
        raise HTTPException(404, f"Alert {alert_id} not found")
    snapshots = list(session.scalars(select(Assessment).where(Assessment.alert_id == alert_id).order_by(Assessment.version)))
    if not snapshots:
        raise HTTPException(404, f"Alert {alert_id} has no assessment yet")
    snap = snapshots[-1]
    reference = session.get(ResponseOption, snap.reference_option_id)
    active = _active_assumption(session, alert_id)
    bound = session.get(Assumption, snap.assumption_id) if snap.assumption_id else None

    approved = bound if bound is not None and bound.status == "approved" else None
    if approved is None:
        reason = {
            None: "No disruption assumption has been proposed.",
            "proposed": "The disruption assumption is awaiting approval.",
            "rejected": "The disruption assumption was rejected.",
        }.get(active.status if active else None, "Needs an approved disruption assumption.")
    else:
        reason = None

    i = snap.inputs
    result = calc.calculate(
        usable_stock=calc.d(i["usableStock"]),
        demand_per_day=calc.d(i["demandPerDay"]),
        baseline_price=calc.d(i["baselinePrice"]),
        exposed_value=snap.exposed_value,
        approved_share_pct=approved.affected_share_pct if approved else None,
        unavailable_reason=reason,
        reference_lead_days=reference.lead_time_days if reference else None,
        reference_price=reference.unit_price if reference else None,
    )
    return AssessmentOut(
        alert_id=alert_id, version=snap.version, created_at=snap.created_at, note=snap.note,
        calc_version=snap.calc_version,
        exposed=ExposedOut(value=snap.exposed_value, unit=snap.exposed_unit, horizon=snap.exposed_horizon),
        inputs=snap.inputs, paths=snap.paths, missing=snap.missing,
        reference_option=ResponseOptionOut.model_validate(reference),
        assumption=_assumption_out(active) if active else None,
        calc=CalcOut(
            cover_days=result.cover_days, at_risk=result.at_risk, gap_days=result.gap_days,
            incremental_cost=result.incremental_cost, reason=result.reason,
        ),
        versions=[VersionOut(v=s.version, at=s.created_at, note=s.note) for s in snapshots],
    )
