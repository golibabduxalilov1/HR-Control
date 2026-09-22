import asyncio
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

connect_args = {}
is_sqlite = settings.database_url.startswith("sqlite")
if is_sqlite:
    # dev only: wait for locks instead of failing, single shared connection
    connect_args = {"check_same_thread": False, "timeout": 30}

if is_sqlite:
    engine = create_async_engine(settings.database_url, echo=False, connect_args=connect_args)
else:
    engine = create_async_engine(settings.database_url, echo=False, connect_args=connect_args, pool_pre_ping=True, pool_size=10, max_overflow=20)

if is_sqlite:
    # SQLite allows a single writer; WAL + busy_timeout make concurrent requests wait instead of
    # failing. Heavy writers (timesheet recompute) additionally serialise via `write_lock`.
    # Production runs on PostgreSQL where none of this applies.
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_connect(dbapi_conn, _record):  # noqa: ANN001
        # SQLite lower()/LIKE are ASCII-only; register a Unicode-aware lower for Cyrillic search
        dbapi_conn.create_function("ulower", 1, lambda v: v.lower() if isinstance(v, str) else v)
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


class _NoLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


# Serialises heavy write sections on SQLite; a no-op on PostgreSQL.
write_lock = asyncio.Lock() if is_sqlite else _NoLock()
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    # On SQLite every request is serialised (single writer, no lock-upgrade failures).
    # PostgreSQL: `write_lock` is a no-op and requests run concurrently.
    async with write_lock:
        async with SessionLocal() as session:
            yield session


def ci_like(column, needle: str):
    """Case-insensitive LIKE that works for Cyrillic on both SQLite and PostgreSQL."""
    from sqlalchemy import func

    pattern = f"%{needle.strip().lower()}%"
    return (func.ulower(column) if is_sqlite else func.lower(column)).like(pattern)
