"""Build the tradable universe on a given date."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Stock, StockPrice


def nifty500_symbols(db: Session) -> list[str]:
    return [s for (s,) in db.execute(select(Stock.symbol)).all()]


def tradable_on(db: Session, on: date, symbols: list[str] | None = None) -> list[str]:
    """Return the subset of `symbols` that have a price on or before `on` AND
    have at least one later price (i.e. the stock is still live in the data).

    If `symbols` is None, uses the full Nifty 500 universe.
    """
    if symbols is None:
        symbols = nifty500_symbols(db)
    if not symbols:
        return []

    # Symbols with at least one price <= on
    have_price_before = {
        r[0]
        for r in db.execute(
            select(StockPrice.symbol)
            .where(StockPrice.date <= on, StockPrice.symbol.in_(symbols))
            .distinct()
        ).all()
    }
    # Stock coverage_end acts as a soft delisting check — if we know the stock
    # only has data up to X < on, exclude it.
    coverage = {
        s.symbol: (s.coverage_start, s.coverage_end)
        for s in db.query(Stock).filter(Stock.symbol.in_(symbols)).all()
    }
    out: list[str] = []
    for sym in symbols:
        if sym not in have_price_before:
            continue
        cov = coverage.get(sym)
        if cov and cov[1] is not None and cov[1] < on:
            # Stock's last known price is before the game date — treat as unavailable
            continue
        out.append(sym)
    return out
