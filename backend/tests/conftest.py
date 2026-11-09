import uuid

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

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
