from alembic import context
from sqlalchemy import create_engine, pool

from app.config import get_settings
from app.models import Base

target_metadata = Base.metadata

# Tables owned by the PostGIS extension are not ours to manage.
EXTENSION_TABLES = {"spatial_ref_sys"}


def include_object(obj, name, type_, reflected, compare_to):
    return not (type_ == "table" and name in EXTENSION_TABLES)


def _url() -> str:
    # An explicit URL (used by the tests) wins over the environment.
    return context.config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, compare_type=True, include_object=include_object
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
