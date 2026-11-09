"""Load sample data from a JSON file (rows per table, in foreign-key order).

    python -m app.seed [--reset] [--file seed/demo-large.json]

The default file is seed/demo.json, built by seed/build_demo.py. A file may carry:

- ``_meta.anchor``: the moment its dates were written against. Every timestamp and date is moved
  by the time since then, so the demo is always "recent": sources are as fresh or stale as designed,
  quotes expire when intended, actions are overdue when intended. Without it, dates are loaded as written.
- ``_evidence``: original payloads by object key, written to the evidence store so alerts can be traced
  back to a real, checksummed file. Each must match the sha256 of its evidence row.

Re-running is safe: rows that already exist are left alone. audit_event and action_status_history have
no natural key, so they are loaded only while empty. Use --reset to empty the seeded tables, and the
tables the application fills while it runs, first.
"""

import argparse
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Date, DateTime, Engine, Numeric, Table, text
from sqlalchemy.dialects.postgresql import insert

from . import clock
from .db import get_engine
from .models import Base
from .storage import get_store, sha256

SEED_FILE = Path(__file__).resolve().parent.parent / "seed" / "demo.json"
LOAD_ONLY_IF_EMPTY = {"audit_event", "action_status_history"}
# Tables the application fills while it runs. They are emptied by --reset along with the seeded ones.
RUNTIME_TABLES = ("sim_log", "sim_run", "import_record", "option_shortlist", "outbox")


def canonical(body: object) -> bytes:
    """The bytes stored for a sample payload; its sha256 is what the evidence row records."""
    return json.dumps(body, sort_keys=True).encode()


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _convert(table: Table, row: dict, shift: timedelta) -> dict:
    out = {}
    for key, value in row.items():
        if key not in table.c:
            raise ValueError(f"{table.name}: unknown column {key!r}")
        kind = table.c[key].type
        if value is None:
            out[key] = None
        elif isinstance(kind, DateTime):
            out[key] = _parse(value) + shift
        elif isinstance(kind, Date):
            out[key] = date.fromisoformat(value) + timedelta(days=shift.days)
        elif isinstance(kind, Numeric):
            out[key] = Decimal(str(value))
        else:
            out[key] = value
    return out


def load(engine: Engine | None = None, path: Path = SEED_FILE, reset: bool = False, now: datetime | None = None) -> dict[str, int]:
    """Insert the rows. Returns the number of rows actually inserted per table."""
    engine = engine or get_engine()
    data: dict = json.loads(Path(path).read_text())
    meta, evidence = data.pop("_meta", {}), data.pop("_evidence", {})
    unknown = [name for name in data if name not in Base.metadata.tables]
    if unknown:
        raise ValueError(f"Seed has tables the schema does not: {unknown}")
    shift = (now or clock.now()) - _parse(meta["anchor"]) if "anchor" in meta else timedelta(0)

    expected = {r["object_key"]: r["sha256"] for r in data.get("evidence", [])}
    for key, body in evidence.items():
        if expected.get(key) != sha256(canonical(body)):
            raise ValueError(f"Sample payload {key} does not match the checksum of its evidence row")

    inserted: dict[str, int] = {}
    with engine.begin() as conn:
        if reset:
            names = ", ".join(f'"{name}"' for name in (*data, *RUNTIME_TABLES))
            conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        for name, rows in data.items():
            table = Base.metadata.tables[name]
            if not rows:
                continue
            if name in LOAD_ONLY_IF_EMPTY and conn.execute(text(f'SELECT EXISTS (SELECT 1 FROM "{name}")')).scalar_one():
                inserted[name] = 0
                continue
            converted = [_convert(table, r, shift) for r in rows]
            before = conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one()
            for start in range(0, len(converted), 2000):  # keeps parameter counts small for large files
                conn.execute(insert(table).on_conflict_do_nothing(), converted[start:start + 2000])
            after = conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one()
            inserted[name] = after - before
        # keep the id sequences ahead of the rows just inserted
        for name in LOAD_ONLY_IF_EMPTY:
            conn.execute(text(f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), COALESCE((SELECT MAX(id) FROM \"{name}\"), 1))"))
    store = get_store()  # after the database work: the files only matter once their rows exist
    for key, body in evidence.items():
        store.put(key, canonical(body))
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reset", action="store_true", help="empty the seeded tables and everything the app created, then load")
    parser.add_argument("--file", default=str(SEED_FILE), help="sample data file (default: seed/demo.json)")
    args = parser.parse_args()
    counts = load(path=Path(args.file), reset=args.reset)
    width = max(len(k) for k in counts)
    for name, n in counts.items():
        print(f"  {name:<{width}}  {n}")
    print(f"inserted {sum(counts.values())} rows")


if __name__ == "__main__":
    main()
