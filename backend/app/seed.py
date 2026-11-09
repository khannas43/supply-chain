"""Load the demo data from seed/demo.json (rows per table, in foreign-key order).

The file is generated from the frontend demo data: `npm run seed:export` in frontend/.
Re-running is safe: rows that already exist are left alone. audit_event and
action_status_history have no natural key, so they are loaded only while empty.
Use --reset to empty the seeded tables, and the simulator, import and shortlist tables, first.

    python -m app.seed [--reset]
"""

import argparse
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Date, DateTime, Engine, Numeric, Table, text
from sqlalchemy.dialects.postgresql import insert

from .db import get_engine
from .models import Base

SEED_FILE = Path(__file__).resolve().parent.parent / "seed" / "demo.json"
LOAD_ONLY_IF_EMPTY = {"audit_event", "action_status_history"}
# Tables the application fills while it runs. They are emptied by --reset along with the seeded ones.
RUNTIME_TABLES = ("sim_log", "sim_run", "import_record", "option_shortlist")


def _convert(table: Table, row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if key not in table.c:
            raise ValueError(f"{table.name}: unknown column {key!r}")
        kind = table.c[key].type
        if value is None:
            out[key] = None
        elif isinstance(kind, DateTime):
            out[key] = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif isinstance(kind, Date):
            out[key] = date.fromisoformat(value)
        elif isinstance(kind, Numeric):
            out[key] = Decimal(str(value))
        else:
            out[key] = value
    return out


def load(engine: Engine | None = None, path: Path = SEED_FILE, reset: bool = False) -> dict[str, int]:
    """Insert the seed rows. Returns the number of rows actually inserted per table."""
    engine = engine or get_engine()
    data: dict[str, list[dict]] = json.loads(path.read_text())
    unknown = [name for name in data if name not in Base.metadata.tables]
    if unknown:
        raise ValueError(f"Seed has tables the schema does not: {unknown}")

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
            before = conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one()
            conn.execute(insert(table).on_conflict_do_nothing(), [_convert(table, r) for r in rows])
            after = conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one()
            inserted[name] = after - before
        # keep the id sequences ahead of the rows just inserted
        for name in LOAD_ONLY_IF_EMPTY:
            conn.execute(text(f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), COALESCE((SELECT MAX(id) FROM \"{name}\"), 1))"))
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reset", action="store_true", help="empty the seeded tables first")
    args = parser.parse_args()
    counts = load(reset=args.reset)
    width = max(len(k) for k in counts)
    for name, n in counts.items():
        print(f"  {name:<{width}}  {n}")
    print(f"inserted {sum(counts.values())} rows")


if __name__ == "__main__":
    main()
