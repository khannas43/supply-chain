from collections.abc import Iterator

from sqlalchemy.orm import Session

from .db import get_engine


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
