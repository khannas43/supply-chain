from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit, clock
from .. import imports as csvimport
from ..auth import Actor, require_role
from ..deps import get_session
from ..ids import next_id
from ..models import ImportRecord, IngestionRun, Node, QuarantineItem, Source, SupplyEdge
from ..schemas import DatasetOut, ImportIn, ImportOut, ImportReportOut, RejectedOut

router = APIRouter(prefix="/api/imports", tags=["imports"])


def _check(session: Session, body: ImportIn) -> tuple[csvimport.Dataset, csvimport.Report]:
    spec = csvimport.DATASETS.get(body.dataset)
    if spec is None:
        raise HTTPException(422, f"Unknown dataset: {body.dataset}")
    nodes = edges = None
    if spec.id == "supplier_network":
        nodes = set(session.scalars(select(Node.id)))
        edges = {(e.from_node, e.to_node, e.material, e.effective_from.isoformat()) for e in session.scalars(select(SupplyEdge))}
    return spec, csvimport.validate(spec, body.csv, nodes, edges)


def _previous(session: Session, dataset: str, checksum: str) -> ImportRecord | None:
    return session.scalars(select(ImportRecord).where(ImportRecord.dataset == dataset, ImportRecord.checksum == checksum)).first()


@router.get("/datasets", response_model=list[DatasetOut])
def datasets() -> list[DatasetOut]:
    return [DatasetOut(id=d.id, label=d.label, required=list(d.required), sample=d.sample, applied=d.applied) for d in csvimport.DATASETS.values()]


@router.get("", response_model=list[ImportOut])
def history(session: Session = Depends(get_session)) -> list[ImportOut]:
    rows = session.scalars(select(ImportRecord).order_by(ImportRecord.committed_at.desc(), ImportRecord.id.desc()))
    return [ImportOut.model_validate(r) for r in rows]


@router.post("/validate", response_model=ImportReportOut)
def validate_file(
    body: ImportIn,
    actor: Actor = Depends(require_role("analyst", "steward", "admin")),
    session: Session = Depends(get_session),
) -> ImportReportOut:
    """A dry run: the same checks as a commit, nothing is saved."""
    spec, report = _check(session, body)
    prev = _previous(session, spec.id, report.checksum)
    return ImportReportOut(
        dataset=spec.id, checksum=report.checksum, header_errors=report.header_errors, valid=len(report.valid),
        duplicates=report.duplicates, already_imported_as=prev.id if prev else None,
        rejected=[RejectedOut(row=r.row, reason=r.reason, field=r.field, bad_value=r.bad_value) for r in report.rejected],
    )


@router.post("", response_model=ImportOut, status_code=201)
def commit_file(
    body: ImportIn,
    actor: Actor = Depends(require_role("steward", "admin")),
    session: Session = Depends(get_session),
) -> ImportOut:
    """Import the valid rows. Rejected rows go to quarantine; the same file cannot be imported twice.

    Supplier network rows are applied to the network. The other datasets are validated and
    recorded here; they are not yet used by assessments.
    """
    spec, report = _check(session, body)
    if report.header_errors:
        raise HTTPException(422, "; ".join(report.header_errors))
    prev = _previous(session, spec.id, report.checksum)
    if prev:
        raise HTTPException(409, f"This exact file was already imported as {prev.id} (v{prev.version}). Nothing changed.")
    if not report.valid:
        raise HTTPException(422, "There are no valid rows to import")

    now = clock.now()
    imp_id = next_id(session, ImportRecord.id, "IMP-", 3)
    version = (session.scalar(select(func.max(ImportRecord.version)).where(ImportRecord.dataset == spec.id)) or 0) + 1

    if spec.id == "supplier_network":
        first = int(next_id(session, SupplyEdge.id, "e")[1:])
        for i, row in enumerate(report.valid):
            session.add(SupplyEdge(
                id=f"e{first + i}", from_node=row["from_id"], to_node=row["to_id"], material=row["material"],
                source=row["source"], confidence=row["confidence"], effective_from=date.fromisoformat(row["effective_from"]),
                uncertain=False,
            ))

    record = ImportRecord(
        id=imp_id, dataset=spec.id, version=version, rows=len(report.valid), rejected=len(report.rejected),
        checksum=report.checksum, committed_by=actor.name, committed_at=now, applied=spec.applied, content=body.csv,
    )
    session.add(record)

    q = int(next_id(session, QuarantineItem.id, "Q-", 4)[2:])
    for i, r in enumerate(report.rejected):
        session.add(QuarantineItem(
            id=f"Q-{q + i:04d}", source_id="src-import", run_id=imp_id, received_at=now, reason=r.reason,
            source_row=f"row {r.row} of {imp_id}.csv", object_key=f"evidence/import/{imp_id}.csv", field=r.field,
            bad_value=r.bad_value, status="quarantined",
        ))
    session.add(IngestionRun(
        id=next_id(session, IngestionRun.id, "RUN-", 4), source_id="src-import", started_at=now,
        status="partial" if report.rejected else "ok", accepted=len(report.valid), duplicate=report.duplicates,
        quarantined=len(report.rejected), note=f"{spec.label} import {imp_id} v{version}",
    ))
    src = session.get(Source, "src-import")
    if src:
        src.last_attempt, src.last_usable = now, now
    audit.record(session, actor.name, "import.committed", imp_id, f"{spec.id} v{version}: {len(report.valid)} accepted, {len(report.rejected)} quarantined")
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Another import was committed at the same time; try again") from None
    return ImportOut.model_validate(record)
