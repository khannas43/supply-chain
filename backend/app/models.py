"""Database schema. Mirrors the entities used by the nine screens.

Rules enforced in the database, not only in the API:
- an assumption cannot be decided by the person who proposed it (maker-checker);
- at most one proposed-or-approved assumption per alert;
- at most one published and one draft version per rule;
- an action points at an assessment snapshot that exists;
- audit events cannot be updated or deleted (trigger, see the first migration).
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index,
    Integer, Numeric, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

COMMODITIES = ("wheat", "tungsten")
MODES = ("live", "replay", "simulated")
LEVELS = ("low", "medium", "high")
SEVERITIES = ("low", "medium", "high", "critical")
ASSESSMENT_STATUSES = ("unassessed", "partial", "complete", "awaiting_validation")
DISPOSITIONS = ("new", "confirmed", "monitor", "dismissed")
NODE_KINDS = ("origin", "supplier", "plant", "product")
RUN_STATUSES = ("ok", "partial", "failed")
QUARANTINE_STATUSES = ("quarantined", "replay_requested")
OPTION_TYPES = ("sourcing", "inventory", "logistics")
QUALIFICATIONS = ("qualified", "unknown", "expired")
SPEC_FITS = ("meets", "partial", "unknown")
ASSUMPTION_STATUSES = ("proposed", "approved", "rejected", "superseded")
ACTION_STATUSES = ("open", "in_progress", "review", "done")
RULE_STATUSES = ("draft", "published", "superseded")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _check(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(_in(column, values), name=name)


TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


# ---- Reference data ----


class Country(Base):
    __tablename__ = "country"
    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class CountryAlias(Base):
    __tablename__ = "country_alias"
    alias: Mapped[str] = mapped_column(String(100), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("country.code"))


class CommodityForm(Base):
    __tablename__ = "commodity_form"
    __table_args__ = (UniqueConstraint("commodity", "form"), _check("commodity", COMMODITIES, "ck_commodity_form_commodity"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commodity: Mapped[str] = mapped_column(String(20))
    form: Mapped[str] = mapped_column(String(100))
    note: Mapped[str] = mapped_column(Text, server_default=text("''"))


class UnitConversion(Base):
    """Dated conversion factors. New rows are added; old rows are never overwritten."""

    __tablename__ = "unit_conversion"
    __table_args__ = (
        UniqueConstraint("from_unit", "to_unit", "effective_from"),
        CheckConstraint("factor > 0", name="ck_unit_conversion_factor"),
    )
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    from_unit: Mapped[str] = mapped_column(String(60))
    to_unit: Mapped[str] = mapped_column(String(60))
    factor: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    effective_from: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(200))


# ---- Sources and pipeline ----


class Source(Base):
    __tablename__ = "source"
    __table_args__ = (_check("mode", MODES, "ck_source_mode"), CheckConstraint("policy_hours > 0", name="ck_source_policy"))
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(20))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    last_attempt: Mapped[datetime | None] = mapped_column(TS)
    last_usable: Mapped[datetime | None] = mapped_column(TS)
    policy_hours: Mapped[int] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(Text)


class SourceCommodity(Base):
    __tablename__ = "source_commodity"
    __table_args__ = (_check("commodity", COMMODITIES, "ck_source_commodity_commodity"),)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id", ondelete="CASCADE"), primary_key=True)
    commodity: Mapped[str] = mapped_column(String(20), primary_key=True)


class IngestionRun(Base):
    __tablename__ = "ingestion_run"
    __table_args__ = (
        _check("status", RUN_STATUSES, "ck_ingestion_run_status"),
        CheckConstraint("accepted >= 0 AND duplicate >= 0 AND quarantined >= 0", name="ck_ingestion_run_counts"),
        Index("ix_ingestion_run_source_started", "source_id", "started_at"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id"))
    started_at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(20))
    accepted: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    duplicate: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    quarantined: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    note: Mapped[str] = mapped_column(Text, server_default=text("''"))


class Evidence(Base):
    """Pointer to the preserved original payload. The bytes live in object or file storage."""

    __tablename__ = "evidence"
    __table_args__ = (_check("mode", MODES, "ck_evidence_mode"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source: Mapped[str] = mapped_column(String(200))
    object_key: Mapped[str] = mapped_column(String(500), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    published_at: Mapped[datetime] = mapped_column(TS)
    ingested_at: Mapped[datetime] = mapped_column(TS)
    mode: Mapped[str] = mapped_column(String(20))
    scenario_run: Mapped[str | None] = mapped_column(String(100))


class QuarantineItem(Base):
    __tablename__ = "quarantine_item"
    __table_args__ = (_check("status", QUARANTINE_STATUSES, "ck_quarantine_status"), Index("ix_quarantine_status", "status"))
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id"))
    run_id: Mapped[str] = mapped_column(String(60))  # an ingestion run or an import
    received_at: Mapped[datetime] = mapped_column(TS)
    reason: Mapped[str] = mapped_column(Text)
    source_row: Mapped[str] = mapped_column(String(200))
    object_key: Mapped[str] = mapped_column(String(500))
    field: Mapped[str] = mapped_column(String(100), server_default=text("''"))
    bad_value: Mapped[str] = mapped_column(Text, server_default=text("''"))
    status: Mapped[str] = mapped_column(String(30), server_default=text("'quarantined'"))
    correction: Mapped[str | None] = mapped_column(Text)


class DeadLetter(Base):
    __tablename__ = "dead_letter"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id"))
    received_at: Mapped[datetime] = mapped_column(TS)
    reason: Mapped[str] = mapped_column(Text)
    object_key: Mapped[str] = mapped_column(String(500))
    attempts: Mapped[int] = mapped_column(Integer)


class ImportRecord(Base):
    """A committed file import. The same file for the same dataset can only be committed once."""

    __tablename__ = "import_record"
    __table_args__ = (UniqueConstraint("dataset", "checksum"), UniqueConstraint("dataset", "version"))
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer)
    rows: Mapped[int] = mapped_column(Integer)
    rejected: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64))
    committed_by: Mapped[str] = mapped_column(String(200))
    committed_at: Mapped[datetime] = mapped_column(TS)
    applied: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))  # rows written to business tables
    content: Mapped[str | None] = mapped_column(Text)  # original file, kept until object storage is in place


# ---- Risk rules ----


class Rule(Base):
    __tablename__ = "rule"
    __table_args__ = (_check("commodity", COMMODITIES, "ck_rule_commodity"),)
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    commodity: Mapped[str] = mapped_column(String(20))


class RuleVersion(Base):
    __tablename__ = "rule_version"
    __table_args__ = (
        _check("status", RULE_STATUSES, "ck_rule_version_status"),
        Index("uq_rule_one_published", "rule_id", unique=True, postgresql_where=text("status = 'published'")),
        Index("uq_rule_one_draft", "rule_id", unique=True, postgresql_where=text("status = 'draft'")),
    )
    rule_id: Mapped[str] = mapped_column(ForeignKey("rule.id"), primary_key=True)
    v: Mapped[str] = mapped_column(String(20), primary_key=True)
    status: Mapped[str] = mapped_column(String(20))
    thresholds: Mapped[list] = mapped_column(JSONB)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(TS)
    published_by: Mapped[str | None] = mapped_column(String(200))
    published_at: Mapped[datetime | None] = mapped_column(TS)


# ---- Supplier network ----


class Node(Base):
    __tablename__ = "node"
    __table_args__ = (
        _check("commodity", COMMODITIES, "ck_node_commodity"),
        _check("kind", NODE_KINDS, "ck_node_kind"),
        Index("ix_node_commodity", "commodity"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    commodity: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    tier: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(100))
    site: Mapped[str | None] = mapped_column(String(200))


class SupplyEdge(Base):
    """Directed link from an upstream node to a downstream node. Confidence and dates live on the link."""

    __tablename__ = "supply_edge"
    __table_args__ = (
        _check("confidence", LEVELS, "ck_supply_edge_confidence"),
        CheckConstraint("from_node <> to_node", name="ck_supply_edge_not_self"),
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_supply_edge_dates"),
        UniqueConstraint("from_node", "to_node", "material", "effective_from", name="uq_supply_edge_identity"),
        Index("ix_supply_edge_from", "from_node"),
        Index("ix_supply_edge_to", "to_node"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    from_node: Mapped[str] = mapped_column(ForeignKey("node.id"))
    to_node: Mapped[str] = mapped_column(ForeignKey("node.id"))
    material: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(200))
    confidence: Mapped[str] = mapped_column(String(20))
    effective_from: Mapped[date] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date)
    uncertain: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    note: Mapped[str | None] = mapped_column(Text)


# ---- Alerts, assessments, responses ----


class Alert(Base):
    __tablename__ = "alert"
    __table_args__ = (
        _check("commodity", COMMODITIES, "ck_alert_commodity"),
        _check("severity", SEVERITIES, "ck_alert_severity"),
        _check("confidence", LEVELS, "ck_alert_confidence"),
        _check("mode", MODES, "ck_alert_mode"),
        _check("assessment_status", ASSESSMENT_STATUSES, "ck_alert_assessment_status"),
        _check("disposition", DISPOSITIONS, "ck_alert_disposition"),
        ForeignKeyConstraint(["rule_id", "rule_v"], ["rule_version.rule_id", "rule_version.v"]),
        Index("ix_alert_commodity_observed", "commodity", "observed_at"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    commodity: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(20))  # kept separate from confidence
    confidence: Mapped[str] = mapped_column(String(20))
    observed_at: Mapped[datetime] = mapped_column(TS)
    mode: Mapped[str] = mapped_column(String(20))
    scenario_run: Mapped[str | None] = mapped_column(String(100))
    assessment_status: Mapped[str] = mapped_column(String(30))
    disposition: Mapped[str] = mapped_column(String(20), server_default=text("'new'"))
    rule_id: Mapped[str] = mapped_column(String(20))
    rule_v: Mapped[str] = mapped_column(String(20))
    rule_inputs: Mapped[list] = mapped_column(JSONB)
    evidence_id: Mapped[str] = mapped_column(ForeignKey("evidence.id"))


class AlertExposedNode(Base):
    """Nodes matched to an alert. A match is a candidate exposure, not proof of interruption."""

    __tablename__ = "alert_exposed_node"
    alert_id: Mapped[str] = mapped_column(ForeignKey("alert.id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("node.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, server_default=text("0"))


class ResponseOption(Base):
    __tablename__ = "response_option"
    __table_args__ = (
        _check("type", OPTION_TYPES, "ck_response_option_type"),
        _check("qualification", QUALIFICATIONS, "ck_response_option_qualification"),
        _check("spec_fit", SPEC_FITS, "ck_response_option_spec_fit"),
        CheckConstraint("lead_time_days >= 0", name="ck_response_option_lead"),
        CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="ck_response_option_price"),
        Index("ix_response_option_alert", "alert_id"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alert.id"))
    type: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    qualification: Mapped[str] = mapped_column(String(20))
    spec_fit: Mapped[str] = mapped_column(String(20))
    capacity: Mapped[str] = mapped_column(String(200))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    quantity_available: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    lead_time_days: Mapped[int] = mapped_column(Integer)
    quote_valid_until: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text, server_default=text("''"))


class OptionShortlist(Base):
    """Options an analyst or manager has shortlisted. Shared, not per user."""

    __tablename__ = "option_shortlist"
    option_id: Mapped[str] = mapped_column(ForeignKey("response_option.id", ondelete="CASCADE"), primary_key=True)
    shortlisted_by_id: Mapped[str] = mapped_column(String(100))
    shortlisted_by_name: Mapped[str] = mapped_column(String(200))
    shortlisted_at: Mapped[datetime] = mapped_column(TS)


class Assumption(Base):
    __tablename__ = "assumption"
    __table_args__ = (
        _check("status", ASSUMPTION_STATUSES, "ck_assumption_status"),
        CheckConstraint("affected_share_pct >= 0 AND affected_share_pct <= 100", name="ck_assumption_share"),
        CheckConstraint("decided_by_id IS NULL OR decided_by_id <> proposed_by_id", name="ck_assumption_maker_checker"),
        Index("uq_assumption_one_active", "alert_id", unique=True, postgresql_where=text("status IN ('proposed', 'approved')")),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alert.id"))
    affected_share_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    basis: Mapped[str] = mapped_column(Text)
    proposed_by_id: Mapped[str] = mapped_column(String(100))
    proposed_by_name: Mapped[str] = mapped_column(String(200))
    proposed_at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(20))
    decided_by_id: Mapped[str | None] = mapped_column(String(100))
    decided_by_name: Mapped[str | None] = mapped_column(String(200))
    decided_at: Mapped[datetime | None] = mapped_column(TS)
    decision_note: Mapped[str | None] = mapped_column(Text)


class Assessment(Base):
    """One immutable snapshot per version. A new approval creates a new row; old rows are never rewritten."""

    __tablename__ = "assessment"
    __table_args__ = (CheckConstraint("version >= 1", name="ck_assessment_version"),)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alert.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(TS)
    note: Mapped[str] = mapped_column(Text)
    calc_version: Mapped[str] = mapped_column(String(40))
    assumption_id: Mapped[str | None] = mapped_column(ForeignKey("assumption.id"))
    exposed_value: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    exposed_unit: Mapped[str] = mapped_column(String(40))
    exposed_horizon: Mapped[str] = mapped_column(String(40))
    reference_option_id: Mapped[str] = mapped_column(ForeignKey("response_option.id"))
    inputs: Mapped[dict] = mapped_column(JSONB)  # input snapshot: stock, demand, prices, units, dates
    paths: Mapped[list] = mapped_column(JSONB)  # exposure paths and their classification
    missing: Mapped[list] = mapped_column(JSONB)  # inputs that were not available


class Action(Base):
    __tablename__ = "action"
    __table_args__ = (
        _check("commodity", COMMODITIES, "ck_action_commodity"),
        _check("status", ACTION_STATUSES, "ck_action_status"),
        _check("assumption_status", ASSUMPTION_STATUSES + ("none",), "ck_action_assumption_status"),
        ForeignKeyConstraint(["alert_id", "assessment_version"], ["assessment.alert_id", "assessment.version"]),
        Index("ix_action_commodity_status", "commodity", "status"),
        Index("ix_action_owner", "owner_id"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    alert_id: Mapped[str] = mapped_column(String(40))
    commodity: Mapped[str] = mapped_column(String(20))
    option_id: Mapped[str] = mapped_column(ForeignKey("response_option.id"))
    owner_id: Mapped[str] = mapped_column(String(100))
    owner_name: Mapped[str] = mapped_column(String(200))
    target_date: Mapped[date] = mapped_column(Date)
    rationale: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), server_default=text("'open'"))
    created_at: Mapped[datetime] = mapped_column(TS)
    created_by: Mapped[str] = mapped_column(String(200))
    assessment_version: Mapped[int] = mapped_column(Integer)  # the snapshot the decision was made on
    assumption_status: Mapped[str] = mapped_column(String(20))


class ActionStatusHistory(Base):
    __tablename__ = "action_status_history"
    __table_args__ = (
        _check("to_status", ACTION_STATUSES, "ck_action_history_to"),
        CheckConstraint(f"from_status IS NULL OR {_in('from_status', ACTION_STATUSES)}", name="ck_action_history_from"),
        Index("ix_action_history_action", "action_id", "at"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    action_id: Mapped[str] = mapped_column(ForeignKey("action.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(TS)
    actor: Mapped[str] = mapped_column(String(200))
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, server_default=text("''"))


class AuditEvent(Base):
    """Append-only. A trigger rejects UPDATE and DELETE."""

    __tablename__ = "audit_event"
    __table_args__ = (Index("ix_audit_ref", "ref"), Index("ix_audit_at", "at"))
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(TS)
    actor: Mapped[str] = mapped_column(String(200))
    event: Mapped[str] = mapped_column(String(100))
    ref: Mapped[str] = mapped_column(String(100))
    detail: Mapped[str] = mapped_column(Text, server_default=text("''"))


# ---- Simulator ----


class SimRun(Base):
    """A simulator run. At most one run can be running or paused at a time."""

    __tablename__ = "sim_run"
    __table_args__ = (
        _check("status", ("running", "paused", "ended"), "ck_sim_run_status"),
        CheckConstraint("offset_hours >= 0 AND emitted >= 0", name="ck_sim_run_counts"),
        CheckConstraint("(status = 'ended') = (active_slot IS NULL)", name="ck_sim_run_slot"),
        UniqueConstraint("active_slot", name="uq_sim_one_active_run"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(40))
    seed: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    active_slot: Mapped[int | None] = mapped_column(Integer)  # 1 while running or paused, NULL once ended
    offset_hours: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    emitted: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    started_at: Mapped[datetime] = mapped_column(TS)
    started_by: Mapped[str] = mapped_column(String(200))
    ended_at: Mapped[datetime | None] = mapped_column(TS)


class SimLog(Base):
    __tablename__ = "sim_log"
    __table_args__ = (Index("ix_sim_log_run", "run_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("sim_run.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(TS)  # virtual time
    text: Mapped[str] = mapped_column(Text)
