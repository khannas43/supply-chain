from sqlalchemy import select
from sqlalchemy.orm import Session


def next_id(session: Session, column, prefix: str, width: int = 0) -> str:
    """Next readable id such as AS-W-3 or AC-T-004. A concurrent clash fails on the primary key."""
    taken = session.scalars(select(column).where(column.like(f"{prefix}%")))
    suffixes = [int(v[len(prefix):]) for v in taken if v[len(prefix):].isdigit()]
    return f"{prefix}{max(suffixes, default=0) + 1:0{width}d}"
