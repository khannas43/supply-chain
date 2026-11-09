"""Rules and exposure: turn an observation into an alert, or explain why not.

Thresholds come from the published version of the matching rule; a draft never applies. The
alert records which rule version raised it. A regional hazard is a candidate exposure, never
proof of interruption, and an unmatched alert is shown as unassessed instead of as zero exposure.
Source staleness is deliberately not applied here: it needs an agreed meaning first.
"""

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, clock, network
from .ids import next_id
from .models import Alert, AlertExposedNode, Node, Observation, Rule, RuleVersion

SEVERITY = {1: "low", 2: "medium", 3: "high", 4: "critical"}
MERGE_WINDOW = timedelta(hours=72)
ACTOR = "Ingestion worker"


def confidence_level(pct: int) -> str:
    return "high" if pct >= 80 else "medium" if pct >= 50 else "low"


@dataclass(frozen=True)
class Spec:
    rule: str
    kind: str
    commodity: str
    event_types: frozenset[str]
    gate: str  # which threshold decides: confidence, delay or change
    title: str


SPECS = (
    Spec("wheat-export-policy", "policy", "wheat", frozenset({"export_restriction", "export_ban", "export_quota"}), "confidence", "Export restriction announced, {country}"),
    Spec("tungsten-export-policy", "policy", "tungsten", frozenset({"export_licence", "export_quota", "export_restriction"}), "confidence", "Export licence tightening, {country}"),
    Spec("wheat-logistics", "logistics", "wheat", frozenset({"port_delay"}), "delay", "Port congestion, {country}"),
    Spec("tungsten-price", "price", "tungsten", frozenset({"price_change_30d_pct"}), "change", "Price spike: {value}% over 30 days"),
)


def find_spec(obs: Observation) -> Spec | None:
    return next((s for s in SPECS if s.kind == obs.kind and s.commodity == obs.commodity and obs.event_type in s.event_types), None)


def published_version(session: Session, rule_name: str) -> tuple[Rule, RuleVersion, dict[str, Decimal]]:
    rule = session.scalars(select(Rule).where(Rule.name == rule_name)).one()
    version = session.scalars(select(RuleVersion).where(RuleVersion.rule_id == rule.id, RuleVersion.status == "published")).one()
    return rule, version, {t["key"]: Decimal(str(t["value"])) for t in version.thresholds}


def exposed_nodes(session: Session, commodity: str, country: str) -> list[str]:
    """Nodes in the event's country, then everything downstream of them, in discovery order."""
    if country == "Global":
        return []
    origins = session.scalars(select(Node.id).where(Node.commodity == commodity, Node.country == country).order_by(Node.id))
    ordered: list[str] = []
    for origin in origins:
        for node, _level in network.traverse(session, origin, "downstream", network.MAX_DEPTH, None, 100).nodes:
            if node.id not in ordered:
                ordered.append(node.id)
    return ordered


def evaluate(session: Session, obs: Observation, evidence_id: str) -> None:
    """Set the observation's outcome, and raise or join an alert when a rule says so."""
    spec = find_spec(obs)
    if spec is None:
        obs.outcome = "no_rule_match"
        return
    rule, version, thr = published_version(session, spec.rule)

    if spec.gate == "confidence":
        passed, why = obs.confidence_pct >= thr["conf"], f"confidence {obs.confidence_pct}% >= floor {thr['conf']:g}%"
    elif spec.gate == "delay":
        passed, why = (obs.value or 0) >= thr["delay"], f"delay {obs.value:g} days >= threshold {thr['delay']:g} days"
    else:
        passed, why = (obs.value or 0) >= thr["chg"], f"30-day change {obs.value:g}% >= threshold {thr['chg']:g}%"
    if not passed:
        obs.outcome = "below_threshold"
        return

    location = "Global" if obs.country == "Global" else obs.country
    existing = session.scalars(
        select(Alert).where(
            Alert.rule_id == rule.id, Alert.commodity == obs.commodity, Alert.location == location,
            Alert.disposition != "dismissed", Alert.scenario_run.is_not_distinct_from(obs.scenario_run),
            Alert.observed_at >= obs.published_at - MERGE_WINDOW, Alert.observed_at <= obs.published_at + MERGE_WINDOW,
        ).order_by(Alert.observed_at)
    ).first()
    if existing is not None:
        obs.outcome, obs.alert_id = "merged", existing.id
        return

    nodes = exposed_nodes(session, obs.commodity, obs.country)
    alert = Alert(
        id=next_id(session, Alert.id, f"AL-{obs.commodity[0].upper()}-", 3), commodity=obs.commodity,
        title=spec.title.format(country=obs.country, value=f"{obs.value:g}" if obs.value is not None else ""),
        summary=f"{obs.headline}. This is hazard evidence: it does not confirm an interruption or quantify lost supply.",
        location=location, severity=SEVERITY[int(thr["sev"])], confidence=confidence_level(obs.confidence_pct),
        observed_at=obs.published_at, mode=obs.mode, scenario_run=obs.scenario_run,
        assessment_status="partial" if nodes else "unassessed", disposition="new", rule_id=rule.id, rule_v=version.v,
        rule_inputs=[f"{obs.kind} = {obs.event_type}", f"country = {obs.country}", f"commodity = {obs.commodity}", why],
        evidence_id=evidence_id,
    )
    session.add(alert)
    session.flush()
    for i, node_id in enumerate(nodes):
        session.add(AlertExposedNode(alert_id=alert.id, node_id=node_id, position=i))
    obs.outcome, obs.alert_id = "alert_raised", alert.id
    audit.record(session, ACTOR, "alert.raised", alert.id, f"{spec.rule} v{version.v} from {obs.id}")
