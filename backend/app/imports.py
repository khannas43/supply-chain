"""CSV imports: validation, and for the supplier network, applying valid rows.

A dry run (validate) and a commit share the same checks. Rejected rows are never applied; on commit
they go to quarantine with their location. Importing the same file twice changes nothing.
"""

import csv
import hashlib
import io
from dataclasses import dataclass, field
from datetime import date

MAX_ROWS = 5000
MAX_CHARS = 1_000_000


@dataclass(frozen=True)
class Dataset:
    id: str
    label: str
    required: tuple[str, ...]
    sample: str
    numeric: tuple[str, ...] = ()
    dates: tuple[str, ...] = ()
    enums: tuple[tuple[str, tuple[str, ...]], ...] = ()
    applied: bool = False  # valid rows are written to business tables


DATASETS: dict[str, Dataset] = {
    d.id: d
    for d in (
        Dataset(
            "supplier_network", "Supplier network",
            ("from_id", "to_id", "material", "source", "effective_from", "confidence"),
            dates=("effective_from",), enums=(("confidence", ("low", "medium", "high")),), applied=True,
            sample=(
                "from_id,to_id,material,source,effective_from,confidence\n"
                'w-prairie,w-hmv,durum wheat,Curated file v2,2026-01-01,medium\n'
                '"w-pampa","w-istanbul","wheat, milling grade",Curated file v2,2026-01-01,low\n'
                'w-eyre,w-rott,"wheat, milling grade",Curated file v2,2026-13-40,low\n'
                "w-nowhere,w-rott,wheat flour,Curated file v2,2026-01-01,low"
            ),
        ),
        Dataset(
            "inventory", "Inventory snapshot", ("plant_id", "material", "usable_qty", "unit", "as_of"),
            numeric=("usable_qty",), dates=("as_of",),
            sample=(
                "plant_id,material,usable_qty,unit,as_of\n"
                "w-p-duisburg,wheat flour input,640,t,2026-11-06\n"
                "t-p-essen,tungsten carbide powder,2.4,t,2026-11-06\n"
                "w-p-lyon,durum semolina,n/a,t,2026-11-06"
            ),
        ),
        Dataset(
            "demand", "Demand rate", ("plant_id", "material", "rate_per_day", "unit", "as_of"),
            numeric=("rate_per_day",), dates=("as_of",),
            sample=(
                "plant_id,material,rate_per_day,unit,as_of\n"
                "w-p-duisburg,wheat flour input,40,t,2026-11-06\n"
                "t-p-essen,tungsten carbide powder,0.06,t,2026-11-06"
            ),
        ),
        Dataset(
            "price", "Price and contract", ("material", "price", "currency", "unit", "effective_date"),
            numeric=("price",), dates=("effective_date",),
            sample=(
                "material,price,currency,unit,effective_date\n"
                "wheat milling,285,USD,t,2026-11-01\n"
                "tungsten concentrate,41500,USD,t,2026-11-01\n"
                "tungsten concentrate,41800,,t,2026-11-02"
            ),
        ),
        Dataset(
            "alternatives", "Qualified alternatives",
            ("supplier_id", "material", "qualification", "lead_time_days", "unit_price", "quote_valid_until"),
            numeric=("lead_time_days", "unit_price"), dates=("quote_valid_until",),
            enums=(("qualification", ("qualified", "unknown", "expired")),),
            sample=(
                "supplier_id,material,qualification,lead_time_days,unit_price,quote_valid_until\n"
                "w-rouen,wheat milling,qualified,30,318,2026-12-03\n"
                "t-goslar,APT,maybe,55,52400,2026-12-14"
            ),
        ),
    )
}


@dataclass
class Rejected:
    row: int  # line number in the file, header is row 1
    reason: str
    field: str
    bad_value: str


@dataclass
class Report:
    checksum: str
    header_errors: list[str] = field(default_factory=list)
    valid: list[dict] = field(default_factory=list)  # rows that passed, as dicts
    duplicates: int = 0
    rejected: list[Rejected] = field(default_factory=list)


def checksum(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def valid_date(value: str) -> bool:
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def validate(spec: Dataset, text: str, known_nodes: set[str] | None = None, existing_edges: set[tuple] | None = None) -> Report:
    """Check a CSV against a dataset's rules. `known_nodes` and `existing_edges` add network checks."""
    report = Report(checksum=checksum(text))
    rows = list(csv.reader(io.StringIO(text.replace("\r", ""), newline=""), skipinitialspace=True))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        report.header_errors.append("File is empty")
        return report
    header = [h.strip() for h in rows[0]]
    report.header_errors = [f"Missing column: {c}" for c in spec.required if c not in header]
    if report.header_errors:
        return report
    if len(rows) - 1 > MAX_ROWS:
        report.header_errors.append(f"Too many rows (limit {MAX_ROWS})")
        return report

    seen: set[tuple] = set()
    for line, cells in enumerate(rows[1:], start=2):
        cells = [c.strip() for c in cells]
        row = {h: (cells[i] if i < len(cells) else "") for i, h in enumerate(header)}

        def reject(reason: str, column: str) -> None:
            report.rejected.append(Rejected(line, reason, column, row.get(column, "")))

        bad = next((c for c in spec.required if not row[c]), None)
        if bad:
            reject(f"Missing required field: {bad}", bad)
            continue
        bad = next((c for c in spec.numeric if not _is_number(row[c])), None)
        if bad:
            reject(f"{bad} is not a number", bad)
            continue
        bad = next((c for c in spec.dates if not valid_date(row[c])), None)
        if bad:
            reject(f"{bad} is not a valid date (YYYY-MM-DD)", bad)
            continue
        bad = next(((c, allowed) for c, allowed in spec.enums if row[c] not in allowed), None)
        if bad:
            reject(f"{bad[0]} must be one of {', '.join(bad[1])}", bad[0])
            continue
        if known_nodes is not None:
            unknown = next((c for c in ("from_id", "to_id") if row[c] not in known_nodes), None)
            if unknown:
                reject(f"{unknown} is not a known supplier or site", unknown)
                continue
            if row["from_id"] == row["to_id"]:
                reject("A supplier cannot supply itself", "to_id")
                continue
        key = tuple(cells)
        edge_key = (row.get("from_id"), row.get("to_id"), row.get("material"), row.get("effective_from"))
        if key in seen or (existing_edges is not None and edge_key in existing_edges):
            report.duplicates += 1
            continue
        seen.add(key)
        report.valid.append(row)
    return report


def _is_number(value: str) -> bool:
    try:
        float(value)
        return value.lower() not in ("nan", "inf", "-inf", "infinity", "-infinity")
    except ValueError:
        return False
