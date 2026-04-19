from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.db_url,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _enable_sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401 — register mappers
    from sqlalchemy.exc import OperationalError

    try:
        Base.metadata.create_all(bind=engine)
    except OperationalError as e:
        if "already exists" not in str(e):
            raise
    _apply_lightweight_migrations()


def _apply_lightweight_migrations() -> None:
    """Add columns that were introduced after a DB was first created.

    SQLAlchemy's create_all won't ALTER existing tables, so we handle
    forward-compat column additions manually here.
    """
    from sqlalchemy import text

    with engine.begin() as conn:
        cols = {
            r[1]
            for r in conn.exec_driver_sql("PRAGMA table_info(stock_fundamentals)").fetchall()
        }
        if "roe" not in cols:
            conn.exec_driver_sql("ALTER TABLE stock_fundamentals ADD COLUMN roe FLOAT")
