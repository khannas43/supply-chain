"""Read-only reports. Each answers one management question from the data already held."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import clock, scope, sources as source_health
from ..auth import Actor, maybe_actor, read_role
from ..deps import get_session
from ..models import (
    Action, Alert, AlertExposedNode, Assessment, Assumption, DeadLetter, Evidence, Ingestion, IngestionRun,
    Node, Observation, QuarantineItem, Source, SupplyEdge,
)
from ..schemas import Commodity
from ..storage import EvidenceMissing, get_store, sha256

router = APIRouter(prefix="/api/reports", tags=["reports"])

SEVERITIES = ("critical", "high", "medium", "low")


def _commodities(actor: Actor | None, commodity: str | None) -> list[str]:
    wanted = [commodity] if commodity else ["wheat", "tungsten"]
    return [c for c in wanted if scope.allowed(actor, c)]


@router.get("/risk-exposure")
def risk_exposure(
    commodity: Commodity | None = None,
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> dict:
    """Where the open risk sits: by severity, by place, and how far it has been assessed."""
    cs = _commodities(actor, commodity)
    alerts = list(session.scalars(select(Alert).where(Alert.commodity.in_(cs), Alert.disposition != "dismissed")))
    ids = [a.id for a in alerts]
    exposed = dict(session.execute(select(AlertExposedNode.alert_id, func.count()).where(AlertExposedNode.alert_id.in_(ids)).group_by(AlertExposedNode.alert_id)).all())
    latest = {}
    for a in session.scalars(select(Assessment).where(Assessment.alert_id.in_(ids)).order_by(Assessment.version)):
        latest[a.alert_id] = a

    by_sev = {c: {s: 0 for s in SEVERITIES} for c in cs}
    by_status: dict[str, int] = {}
    by_place: dict[tuple[str, str], dict] = {}
    for a in alerts:
        by_sev[a.commodity][a.severity] += 1
        by_status[a.assessment_status] = by_status.get(a.assessment_status, 0) + 1
        row = by_place.setdefault((a.commodity, a.location), {"commodity": a.commodity, "location": a.location, "alerts": 0, "exposedNodes": 0})
        row["alerts"] += 1
        row["exposedNodes"] += exposed.get(a.id, 0)
    rank = {s: i for i, s in enumerate(SEVERITIES)}
    top = sorted(alerts, key=lambda a: (rank[a.severity], -a.observed_at.timestamp()))[:10]
    return {
        "asOf": clock.now(),
        "totals": {"activeAlerts": len(alerts), "assessed": len(latest), "unassessed": len(alerts) - len(latest)},
        "bySeverity": [{"commodity": c, **by_sev[c]} for c in cs],
        "byAssessmentStatus": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "byLocation": sorted(by_place.values(), key=lambda r: (-r["alerts"], r["location"])),
        "topAlerts": [
            {
                "id": a.id, "commodity": a.commodity, "title": a.title, "severity": a.severity, "confidence": a.confidence,
                "mode": a.mode, "location": a.location, "exposedNodes": exposed.get(a.id, 0),
                "assessmentStatus": a.assessment_status, "disposition": a.disposition,
                "exposedValue": float(latest[a.id].exposed_value) if a.id in latest else None,
                "exposedUnit": latest[a.id].exposed_unit if a.id in latest else None,
            }
            for a in top
        ],
    }


@router.get("/supplier-concentration")
def supplier_concentration(
    commodity: Commodity,
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> dict:
    """How dependent the network is on single countries and single links."""
    scope.require(actor, commodity, "That commodity is outside your access")
    nodes = list(session.scalars(select(Node).where(Node.commodity == commodity)))
    ids = {n.id for n in nodes}
    edges = list(session.scalars(select(SupplyEdge).where(SupplyEdge.from_node.in_(ids), SupplyEdge.effective_to.is_(None))))
    by_id = {n.id: n for n in nodes}

    countries: dict[str, dict] = {}
    for n in nodes:
        row = countries.setdefault(n.country, {"country": n.country, "nodes": 0, "kinds": {}})
        row["nodes"] += 1
        row["kinds"][n.kind] = row["kinds"].get(n.kind, 0) + 1
    total = len(nodes) or 1
    by_country = sorted(
        ({**r, "share": round(100 * r["nodes"] / total, 1)} for r in countries.values()), key=lambda r: (-r["nodes"], r["country"])
    )

    inbound: dict[str, list[SupplyEdge]] = {}
    for e in edges:
        inbound.setdefault(e.to_node, []).append(e)
    single = [
        {
            "node": by_id[n].name, "kind": by_id[n].kind, "country": by_id[n].country,
            "supplier": by_id[es[0].from_node].name, "supplierCountry": by_id[es[0].from_node].country,
            "confidence": es[0].confidence, "uncertain": es[0].uncertain,
        }
        for n, es in inbound.items() if len(es) == 1 and by_id[n].kind in ("supplier", "plant")
        and es[0].from_node in by_id
    ]
    by_kind: dict[str, int] = {}
    for n in nodes:
        by_kind[n.kind] = by_kind.get(n.kind, 0) + 1
    conf: dict[str, int] = {}
    for e in edges:
        conf[e.confidence] = conf.get(e.confidence, 0) + 1
    return {
        "commodity": commodity,
        "totals": {
            "nodes": len(nodes), "links": len(edges), "countries": len(countries),
            "uncertainLinks": sum(1 for e in edges if e.uncertain), "singleSourceNodes": len(single),
        },
        "byCountry": by_country[:12],
        "byKind": [{"kind": k, "count": v} for k, v in sorted(by_kind.items())],
        "linkConfidence": [{"confidence": k, "count": v} for k, v in sorted(conf.items())],
        "singleSource": sorted(single, key=lambda r: (r["country"], r["node"])),
    }


@router.get("/actions")
def action_report(
    commodity: Commodity | None = None,
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> dict:
    """Decisions taken: progress, ownership, what is late, and what rests on an out-of-date assessment."""
    cs = _commodities(actor, commodity)
    today = clock.today()
    actions = list(session.scalars(select(Action).where(Action.commodity.in_(cs))))
    current = dict(session.execute(select(Assessment.alert_id, func.max(Assessment.version)).group_by(Assessment.alert_id)).all())
    by_status: dict[str, int] = {}
    owners: dict[str, dict] = {}
    for a in actions:
        by_status[a.status] = by_status.get(a.status, 0) + 1
        o = owners.setdefault(a.owner_id, {"owner": a.owner_name, "total": 0, "open": 0, "overdue": 0})
        o["total"] += 1
        if a.status != "done":
            o["open"] += 1
            if a.target_date < today:
                o["overdue"] += 1
    open_ = [a for a in actions if a.status != "done"]
    overdue = [a for a in open_ if a.target_date < today]
    stale = [a for a in open_ if a.assessment_version < current.get(a.alert_id, a.assessment_version)]
    pending = {
        a.alert_id for a in session.scalars(select(Assumption).where(Assumption.status == "proposed"))
    }
    return {
        "asOf": clock.now(),
        "totals": {"actions": len(actions), "open": len(open_), "overdue": len(overdue), "reviewNeeded": len(stale), "done": by_status.get("done", 0)},
        "byStatus": [{"status": s, "count": by_status.get(s, 0)} for s in ("open", "in_progress", "review", "done")],
        "byOwner": sorted(owners.values(), key=lambda r: (-r["overdue"], -r["open"], r["owner"])),
        "attention": [
            {
                "id": a.id, "commodity": a.commodity, "alertId": a.alert_id, "owner": a.owner_name, "status": a.status,
                "targetDate": a.target_date, "daysLate": (today - a.target_date).days if a.target_date < today else 0,
                "reviewNeeded": a in stale, "assumptionPending": a.alert_id in pending,
            }
            for a in sorted(open_, key=lambda a: a.target_date) if a.target_date < today or a in stale
        ],
    }


# Each check counts rows that break a rule of the data life cycle. Zero is healthy.
INTEGRITY = [
    ("Every alert points at preserved evidence", "select count(*) from alert a left join evidence e on e.id = a.evidence_id where e.id is null"),
    ("Every alert records the rule version that raised it", "select count(*) from alert a left join rule_version r on r.rule_id = a.rule_id and r.v = a.rule_v where r.rule_id is null"),
    ("Every observation belongs to a collected payload", "select count(*) from observation o left join ingestion i on i.id = o.ingestion_id where i.id is null"),
    ("Every alert raised from an observation has one", "select count(*) from observation o left join alert a on a.id = o.alert_id where o.alert_id is not null and a.id is null"),
    ("Every assessment rests on an existing alert and option", "select count(*) from assessment s left join alert a on a.id = s.alert_id left join response_option o on o.id = s.reference_option_id where a.id is null or o.id is null"),
    ("Every action is tied to an assessment snapshot", "select count(*) from action x left join assessment s on s.alert_id = x.alert_id and s.version = x.assessment_version where s.alert_id is null"),
    ("Every action has a status history", "select count(*) from action x where not exists (select 1 from action_status_history h where h.action_id = x.id)"),
    ("No assumption was approved by its proposer", "select count(*) from assumption where decided_by_id is not null and decided_by_id = proposed_by_id"),
    ("No alert has two live assumptions", "select count(*) from (select alert_id from assumption where status in ('proposed','approved') group by alert_id having count(*) > 1) t"),
    ("Every link joins two nodes of the same commodity", "select count(*) from supply_edge e join node f on f.id = e.from_node join node t on t.id = e.to_node where f.commodity <> t.commodity"),
    ("Complete or awaiting-validation alerts have an assessment; unassessed ones have none", "select count(*) from alert a where (a.assessment_status in ('complete','awaiting_validation') and not exists (select 1 from assessment s where s.alert_id = a.id)) or (a.assessment_status = 'unassessed' and exists (select 1 from assessment s where s.alert_id = a.id))"),
    ("Every observation that raised or merged into an alert names it", "select count(*) from observation where outcome in ('alert_raised','merged') and alert_id is null"),
    ("Every finished action shows when it was finished", "select count(*) from action x where x.status = 'done' and not exists (select 1 from action_status_history h where h.action_id = x.id and h.to_status = 'done')"),
    ("Simulated or replayed data is never marked live", "select count(*) from alert a join evidence e on e.id = a.evidence_id where e.mode <> a.mode"),
]


def _evidence_unreadable(session: Session) -> int:
    """Evidence rows whose stored bytes are missing or no longer match the recorded checksum."""
    store = get_store()
    bad = 0
    for key, digest in session.execute(select(Evidence.object_key, Evidence.sha256)):
        try:
            if sha256(store.get(key)) != digest:
                bad += 1
        except (EvidenceMissing, OSError):
            bad += 1
    return bad


@router.get(
    "/data-lifecycle",
    dependencies=[Depends(read_role("analyst", "steward", "admin", "demo_operator"))],
)
def data_lifecycle(
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> dict:
    """The path from source to decision, how much stands at each step, and whether the links between steps hold."""
    now = clock.now()
    cs = _commodities(actor, None)

    def n(model, *where):
        return session.scalar(select(func.count()).select_from(model).where(*where)) or 0

    funnel = [
        ("Payloads collected", n(Ingestion)),
        ("Observations accepted", n(Observation, Observation.commodity.in_(cs))),
        ("Alerts raised", n(Alert, Alert.commodity.in_(cs))),
        ("Alerts assessed", session.scalar(select(func.count(func.distinct(Assessment.alert_id))).join(Alert, Alert.id == Assessment.alert_id).where(Alert.commodity.in_(cs))) or 0),
        ("Actions created", n(Action, Action.commodity.in_(cs))),
        ("Actions done", n(Action, Action.commodity.in_(cs), Action.status == "done")),
    ]
    outcomes = dict(session.execute(select(Observation.outcome, func.count()).where(Observation.commodity.in_(cs)).group_by(Observation.outcome)).all())
    runs = session.execute(select(func.coalesce(func.sum(IngestionRun.accepted), 0), func.coalesce(func.sum(IngestionRun.duplicate), 0), func.coalesce(func.sum(IngestionRun.quarantined), 0))).one()
    quarantine = dict(session.execute(select(QuarantineItem.status, func.count()).group_by(QuarantineItem.status)).all())
    src = []
    for s in session.scalars(select(Source).order_by(Source.name)):
        age = source_health.hours_since(s.last_usable, now)
        src.append({"id": s.id, "name": s.name, "mode": s.mode, "state": source_health.state(s, now), "hoursSinceUsable": round(age, 1) if age is not None else None, "policyHours": s.policy_hours})

    # the checks span both commodities, so a commodity-scoped user does not see them
    unscoped = scope.allowed(actor, "wheat") and scope.allowed(actor, "tungsten")
    integrity = [{"check": label, "violations": session.execute(text(sql)).scalar_one()} for label, sql in INTEGRITY] if unscoped else None
    if integrity is not None:
        integrity.append({"check": "Every stored original is present and matches its checksum", "violations": _evidence_unreadable(session)})
    return {
        "asOf": now,
        "funnel": [{"step": s, "count": c} for s, c in funnel],
        "observationOutcomes": [{"outcome": k, "count": v} for k, v in sorted(outcomes.items())],
        "runTotals": {"accepted": runs[0], "duplicate": runs[1], "quarantined": runs[2]},
        "quarantine": [{"status": k, "count": v} for k, v in sorted(quarantine.items())],
        "deadLetters": n(DeadLetter),
        "evidenceStored": n(Evidence),
        "sources": src,
        "integrity": integrity,
    }
