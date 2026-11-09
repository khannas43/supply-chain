"""API contracts. Field names are camelCase on the wire to match the frontend types."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer
from pydantic.alias_generators import to_camel

# Quantities are Decimal in the server and plain JSON numbers on the wire.
Num = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]

Commodity = Literal["wheat", "tungsten"]
Mode = Literal["live", "replay", "simulated"]
Severity = Literal["low", "medium", "high", "critical"]
Level = Literal["low", "medium", "high"]
AssessmentStatus = Literal["unassessed", "partial", "complete", "awaiting_validation"]
Disposition = Literal["new", "confirmed", "monitor", "dismissed"]
Direction = Literal["upstream", "downstream", "both"]


class Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class EvidenceOut(Out):
    source: str
    object_key: str
    sha256: str
    published_at: datetime
    ingested_at: datetime


class ExposedOut(Out):
    value: Num
    unit: str
    horizon: str


class AlertOut(Out):
    id: str
    commodity: Commodity
    title: str
    summary: str
    location: str
    severity: Severity
    confidence: Level
    observed_at: datetime
    mode: Mode
    scenario_run: str | None = None
    assessment_status: AssessmentStatus
    disposition: Disposition
    rule_version: str  # "name vX.Y"
    rule_inputs: list[str]
    evidence: EvidenceOut
    exposed_node_ids: list[str]
    exposed: ExposedOut | None = None
    days_of_cover: Num | None = None


class NodeOut(Out):
    id: str
    commodity: Commodity
    name: str
    kind: Literal["origin", "supplier", "plant", "product"]
    tier: str | None = None
    country: str
    site: str | None = None


class EdgeOut(Out):
    id: str
    from_node: str = Field(alias="from")
    to_node: str = Field(alias="to")
    material: str
    source: str
    confidence: Level
    effective_from: date
    effective_to: date | None = None
    uncertain: bool
    note: str | None = None


class TraverseNodeOut(Out):
    node: NodeOut
    level: int  # negative upstream, positive downstream, 0 for the focus


class TraverseOut(Out):
    focus: str
    direction: Direction
    depth: int
    limit: int
    total_reachable: int
    truncated: bool
    nodes: list[TraverseNodeOut]
    edges: list[EdgeOut]
    cycle_edge_ids: list[str]


class ResponseOptionOut(Out):
    id: str
    alert_id: str
    type: Literal["sourcing", "inventory", "logistics"]
    name: str
    qualification: Literal["qualified", "unknown", "expired"]
    spec_fit: Literal["meets", "partial", "unknown"]
    capacity: str
    unit_price: Num | None = None
    quantity_available: Num | None = None
    lead_time_days: int
    quote_valid_until: date | None = None
    note: str


class PersonOut(Out):
    id: str
    name: str


class AssumptionOut(Out):
    id: str
    alert_id: str
    affected_share_pct: Num
    basis: str
    proposed_by: PersonOut
    proposed_at: datetime
    status: Literal["proposed", "approved", "rejected", "superseded"]
    decided_by: PersonOut | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None


class InputsOut(Out):
    as_of: str
    usable_stock: Num
    stock_unit: str
    demand_per_day: Num
    baseline_price: Num
    currency: str
    price_unit: str
    notes: list[str]


class PathOut(Out):
    nodes: list[str]
    classification: Literal["confirmed", "potential", "unknown"]
    basis: str


class CalcOut(Out):
    cover_days: Num | None
    at_risk: Num | None
    gap_days: Num | None
    incremental_cost: Num | None
    reason: str | None  # why the dependent measures are unavailable


class VersionOut(Out):
    v: int
    at: datetime
    note: str


class AssessmentOut(Out):
    alert_id: str
    version: int
    created_at: datetime
    note: str
    calc_version: str
    exposed: ExposedOut
    inputs: InputsOut
    paths: list[PathOut]
    missing: list[str]
    reference_option: ResponseOptionOut
    assumption: AssumptionOut | None  # the active assumption, if any
    calc: CalcOut
    versions: list[VersionOut]
