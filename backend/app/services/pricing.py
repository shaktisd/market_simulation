"""Read price / NAV data from SQLite with on-or-before date semantics."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import IndexPrice, MFNav, Stock, StockFundamental, StockPrice


def price_on_or_before(db: Session, symbol: str, on: date) -> float | None:
    row = db.execute(
        select(StockPrice.adj_close)
        .where(StockPrice.symbol == symbol, StockPrice.date <= on)
        .order_by(StockPrice.date.desc())
        .limit(1)
    ).scalar_one_or_none()
    return float(row) if row is not None else None


def price_window(
    db: Session, symbol: str, end: date, lookback_days: int = 365
) -> list[tuple[date, float]]:
    start = end - timedelta(days=lookback_days)
    rows = db.execute(
        select(StockPrice.date, StockPrice.adj_close)
        .where(StockPrice.symbol == symbol, StockPrice.date <= end, StockPrice.date >= start)
        .order_by(StockPrice.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def price_between(
    db: Session, symbol: str, start: date, end: date
) -> list[tuple[date, float]]:
    rows = db.execute(
        select(StockPrice.date, StockPrice.adj_close)
        .where(StockPrice.symbol == symbol, StockPrice.date >= start, StockPrice.date <= end)
        .order_by(StockPrice.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def mf_nav_on_or_before(db: Session, scheme_code: int, on: date) -> float | None:
    row = db.execute(
        select(MFNav.nav)
        .where(MFNav.scheme_code == scheme_code, MFNav.date <= on)
        .order_by(MFNav.date.desc())
        .limit(1)
    ).scalar_one_or_none()
    return float(row) if row is not None else None


def mf_nav_window(
    db: Session, scheme_code: int, end: date, lookback_days: int = 365
) -> list[tuple[date, float]]:
    start = end - timedelta(days=lookback_days)
    rows = db.execute(
        select(MFNav.date, MFNav.nav)
        .where(MFNav.scheme_code == scheme_code, MFNav.date <= end, MFNav.date >= start)
        .order_by(MFNav.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def mf_latest_date_on_or_before(db: Session, scheme_code: int, on: date) -> date | None:
    row = db.execute(
        select(MFNav.date)
        .where(MFNav.scheme_code == scheme_code, MFNav.date <= on)
        .order_by(MFNav.date.desc())
        .limit(1)
    ).scalar_one_or_none()
    return row


def mf_nav_between(
    db: Session, scheme_code: int, start: date, end: date
) -> list[tuple[date, float]]:
    rows = db.execute(
        select(MFNav.date, MFNav.nav)
        .where(MFNav.scheme_code == scheme_code, MFNav.date >= start, MFNav.date <= end)
        .order_by(MFNav.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def index_window(
    db: Session, name: str, end: date, lookback_days: int = 365
) -> list[tuple[date, float]]:
    start = end - timedelta(days=lookback_days)
    rows = db.execute(
        select(IndexPrice.date, IndexPrice.close)
        .where(IndexPrice.index_name == name, IndexPrice.date <= end, IndexPrice.date >= start)
        .order_by(IndexPrice.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def index_between(
    db: Session, name: str, start: date, end: date
) -> list[tuple[date, float]]:
    rows = db.execute(
        select(IndexPrice.date, IndexPrice.close)
        .where(IndexPrice.index_name == name, IndexPrice.date >= start, IndexPrice.date <= end)
        .order_by(IndexPrice.date.asc())
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def latest_fundamentals(db: Session, symbol: str, on: date) -> dict[str, float | None]:
    row = db.execute(
        select(StockFundamental)
        .where(StockFundamental.symbol == symbol, StockFundamental.date <= on)
        .order_by(StockFundamental.date.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return {"pe": None, "pb": None, "eps": None, "market_cap": None}
    return {"pe": row.pe, "pb": row.pb, "eps": row.eps, "market_cap": row.market_cap}


def stock_by_symbol(db: Session, symbol: str) -> Stock | None:
    return db.get(Stock, symbol)
