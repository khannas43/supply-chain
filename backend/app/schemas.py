"""API contracts. Field names are camelCase on the wire to match the frontend types."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, StringConstraints
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
    id: str
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


class DispositionIn(BaseModel):
    disposition: Literal["confirmed", "monitor", "dismissed"]
    rationale: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class SourceOut(Out):
    id: str
    name: str
    mode: Mode
    enabled: bool
    commodities: list[Commodity]
    last_attempt: datetime | None
    last_usable: datetime | None
    policy_hours: int
    last_error: str | None
    state: Literal["fresh", "stale", "failing", "paused"]
    hours_since_usable: Num | None


class ActionCountsOut(Out):
    open: int
    in_progress: int
    review: int
    done: int


class TrendPoint(Out):
    day: date
    count: int


class OverviewOut(Out):
    commodity: Commodity
    as_of: datetime
    active_alerts: int  # not dismissed
    alerts_by_severity: dict[str, int]
    assessed_alerts: int  # active alerts that have an assessment
    actions: ActionCountsOut
    last_assessment_at: datetime | None
    trend: list[TrendPoint]  # alerts observed per day, last 7 days
    sources: list[SourceOut]


# ---- Assumptions, options, actions ----


class In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class AssumptionIn(In):
    affected_share_pct: Annotated[Decimal, Field(ge=0, le=100, decimal_places=2)]
    basis: Text


class AssumptionDecisionIn(In):
    decision: Literal["approved", "rejected"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class ShortlistIn(In):
    shortlisted: bool


class OptionRowOut(Out):
    option: ResponseOptionOut
    rank: int | None = None
    gap_days: Num | None = None
    incremental_cost: Num | None = None
    extra_cover_days: Num | None = None
    quote_status: Literal["none", "valid", "expiring", "expired"]
    days_to_quote_expiry: int | None = None
    shortlisted: bool = False
    reasons: list[str] = []  # why an option is not eligible


class ResponseOptionsOut(Out):
    alert_id: str
    assessment_version: int
    currency: str
    cover_days: Num | None
    assumption_status: Literal["none", "proposed", "approved", "rejected", "superseded"]
    unavailable_reason: str | None
    ranked: list[OptionRowOut]
    complementary: list[OptionRowOut]
    ineligible: list[OptionRowOut]


class DecisionIn(In):
    owner_id: ShortText
    owner_name: ShortText
    target_date: date
    rationale: Text


class StatusIn(In):
    status: Literal["open", "in_progress", "review", "done"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class ReassignIn(In):
    owner_id: ShortText
    owner_name: ShortText
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class StatusEntryOut(Out):
    at: datetime
    actor: str
    from_status: str | None = Field(alias="from")
    to_status: str = Field(alias="to")
    note: str


class AuditOut(Out):
    at: datetime
    actor: str
    event: str
    ref: str
    detail: str


class ActionOut(Out):
    id: str
    alert_id: str
    alert_title: str
    commodity: Commodity
    option_id: str
    option_name: str
    owner_id: str
    owner_name: str
    target_date: date
    rationale: str
    status: Literal["open", "in_progress", "review", "done"]
    created_at: datetime
    created_by: str
    assessment_version: int
    current_assessment_version: int
    assumption_status: str
    overdue: bool
    review_needed: bool  # assessment moved on since this decision; the decision itself is unchanged
    history: list[StatusEntryOut]
    audit: list[AuditOut] = []


# ---- Pipeline, rules, reference data, imports, simulator ----


class RunOut(Out):
    id: str
    source_id: str
    started_at: datetime
    status: Literal["ok", "partial", "failed"]
    accepted: int
    duplicate: int
    quarantined: int
    note: str


class QuarantineOut(Out):
    id: str
    source_id: str
    source_name: str
    run_id: str
    received_at: datetime
    reason: str
    source_row: str
    object_key: str
    field: str
    bad_value: str
    status: Literal["quarantined", "replay_requested", "resolved"]
    correction: str | None = None


class ReplayIn(In):
    correction: Text


class DeadOut(Out):
    id: str
    source_id: str
    source_name: str
    received_at: datetime
    reason: str
    object_key: str
    attempts: int


class QueueOut(Out):
    worker_backlog: int
    dead_messages: int
    oldest_pending_seconds: int | None
    kafka: Literal["connected", "not_connected"]
    nifi: Literal["connected", "not_connected"]


class EnabledIn(In):
    enabled: bool


class ThresholdOut(Out):
    key: str
    label: str
    value: Num
    unit: str


class RuleVersionOut(Out):
    v: str
    status: Literal["draft", "published", "superseded"]
    thresholds: list[ThresholdOut]
    created_by: str
    created_at: datetime
    published_by: str | None = None
    published_at: datetime | None = None


class RuleOut(Out):
    id: str
    name: str
    commodity: Commodity
    versions: list[RuleVersionOut]  # oldest first


class ThresholdIn(In):
    key: ShortText
    value: Decimal


class DraftIn(In):
    thresholds: Annotated[list[ThresholdIn], Field(min_length=1, max_length=20)]


class ConversionOut(Out):
    id: str
    from_unit: str = Field(alias="from")
    to_unit: str = Field(alias="to")
    factor: Num
    effective_from: date
    source: str


class ConversionIn(In):
    from_unit: ShortText = Field(alias="from")
    to_unit: ShortText = Field(alias="to")
    factor: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=8)]
    effective_from: date
    source: ShortText


class CountryOut(Out):
    code: str
    name: str
    aliases: list[str]


class FormOut(Out):
    commodity: Commodity
    form: str
    note: str


class ReferenceOut(Out):
    countries: list[CountryOut]
    forms: list[FormOut]
    conversions: list[ConversionOut]


class DatasetOut(Out):
    id: str
    label: str
    required: list[str]
    sample: str
    applied: bool  # valid rows are written to business tables


class ImportIn(In):
    dataset: str
    csv: Annotated[str, StringConstraints(min_length=1, max_length=1_000_000)]


class RejectedOut(Out):
    row: int
    reason: str
    field: str
    bad_value: str


class ImportReportOut(Out):
    dataset: str
    checksum: str
    header_errors: list[str]
    valid: int
    duplicates: int
    rejected: list[RejectedOut]
    already_imported_as: str | None = None


class ImportOut(Out):
    id: str
    dataset: str
    version: int
    rows: int
    rejected: int
    checksum: str
    committed_by: str
    committed_at: datetime
    applied: bool


class SimEventOut(Out):
    at: int
    text: str


class ScenarioOut(Out):
    id: str
    name: str
    commodity: Commodity
    seed: int
    events: list[SimEventOut]


class SimLogOut(Out):
    at: datetime
    run_id: str
    text: str


class SimStateOut(Out):
    status: Literal["idle", "running", "paused"]
    scenario_id: str | None = None
    run_id: str | None = None
    seed: int | None = None
    offset_hours: int = 0
    virtual_now: datetime
    emitted: int = 0
    total_events: int = 0
    log: list[SimLogOut] = []


class StartIn(In):
    scenario_id: ShortText


class AdvanceIn(In):
    hours: Annotated[int, Field(ge=1, le=168)]


class InjectIn(In):
    kind: Literal["rate_limit", "timeout", "recover", "duplicate", "late", "malformed", "missing_field"]
