import uuid
from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app import clock, storage
from app.config import get_settings


def _alembic(url: str) -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


@pytest.fixture
def alembic_cfg():
    return _alembic


@pytest.fixture
def scratch_db():
    """A throwaway database on the stack's PostgreSQL server. Yields its URL."""
    base = make_url(get_settings().database_url)
    name = f"sc_test_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.set(database=name).render_as_string(hide_password=False)
    try:
        yield url
    finally:
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture
def engine(scratch_db):
    """Migrated, empty schema."""
    command.upgrade(_alembic(scratch_db), "head")
    eng = create_engine(scratch_db)
    yield eng
    eng.dispose()


@pytest.fixture
def seeded(engine):
    from app import seed

    seed.load(engine)
    return engine


@pytest.fixture(autouse=True)
def frozen_clock():
    """Demo data is dated around 7 to 9 November 2026; keep the clock there so quotes and dates behave."""
    clock.freeze(datetime(2026, 11, 9, 9, 0, tzinfo=UTC))
    yield
    clock.freeze(None)


@pytest.fixture
def client(seeded):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.deps import get_session
    from app.main import app

    def override():
        with Session(seeded) as s:
            yield s

    app.dependency_overrides[get_session] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def evidence_store(tmp_path):
    """A throwaway evidence directory per test."""
    store = storage.FileEvidenceStore(tmp_path / "evidence")
    storage.set_store(store)
    yield store
    storage.set_store(None)
