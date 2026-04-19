"""Bulk-download historical prices for Nifty 500 stocks + Nifty 50/500 indices.

Usage:
    uv run python -m app.ingest.fetch_stocks

This is idempotent: running again will skip rows that already exist.
Takes ~15-25 minutes on first run. Internet required.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import pandas as pd
import yfinance as yf
from sqlalchemy import select
from sqlalchemy.orm import Session
from tqdm import tqdm

from app.core.config import settings
from app.core.db import init_db, session_scope
from app.ingest.load_universe import load_universe
from app.models import IndexPrice, Stock, StockFundamental, StockPrice

log = logging.getLogger(__name__)

INDEX_TICKERS = {"NIFTY50": "^NSEI", "NIFTY500": "^CRSLDX"}


def _last_stored_date(db: Session, symbol: str) -> date | None:
    return db.execute(
        select(StockPrice.date)
        .where(StockPrice.symbol == symbol)
        .order_by(StockPrice.date.desc())
        .limit(1)
    ).scalar_one_or_none()


def _last_index_date(db: Session, name: str) -> date | None:
    return db.execute(
        select(IndexPrice.date)
        .where(IndexPrice.index_name == name)
        .order_by(IndexPrice.date.desc())
        .limit(1)
    ).scalar_one_or_none()


def _download(ticker: str, start: str) -> pd.DataFrame:
    df = yf.download(
        ticker,
        start=start,
        progress=False,
        auto_adjust=False,
        actions=False,
        threads=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance may return MultiIndex columns for single-ticker calls in newer versions
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    return df


def fetch_indices() -> None:
    for name, tkr in INDEX_TICKERS.items():
        with session_scope() as db:
            last = _last_index_date(db, name)
            start = (last + timedelta(days=1)).isoformat() if last else settings.yf_start_date
            df = _download(tkr, start)
            if df.empty:
                log.info("No new data for index %s", name)
                continue
            for idx, row in df.iterrows():
                d = idx.date() if hasattr(idx, "date") else idx
                close = float(row.get("Adj Close", row.get("Close")))
                if pd.isna(close):
                    continue
                db.merge(IndexPrice(index_name=name, date=d, close=close))
            log.info("Index %s: %d rows upserted", name, len(df))


def fetch_stocks() -> None:
    init_db()
    load_universe()

    with session_scope() as db:
        symbols = [(s.symbol, s.yf_ticker) for s in db.query(Stock).all()]

    log.info("Downloading history for %d symbols", len(symbols))
    for symbol, tkr in tqdm(symbols):
        try:
            with session_scope() as db:
                last = _last_stored_date(db, symbol)
                start = (last + timedelta(days=1)).isoformat() if last else settings.yf_start_date
                df = _download(tkr, start)
                if df.empty:
                    continue

                # Track data coverage
                first_dt = df.index.min().date() if hasattr(df.index.min(), "date") else df.index.min()
                last_dt = df.index.max().date() if hasattr(df.index.max(), "date") else df.index.max()

                stock = db.get(Stock, symbol)
                if stock is not None:
                    stock.coverage_start = stock.coverage_start or first_dt
                    stock.coverage_end = last_dt

                for idx, row in df.iterrows():
                    d = idx.date() if hasattr(idx, "date") else idx
                    close = row.get("Close")
                    adj_close = row.get("Adj Close", close)
                    volume = row.get("Volume")
                    if pd.isna(close) or pd.isna(adj_close):
                        continue
                    db.merge(StockPrice(
                        symbol=symbol,
                        date=d,
                        close=float(close),
                        adj_close=float(adj_close),
                        volume=float(volume) if not pd.isna(volume) else None,
                    ))

                # Snapshot current fundamentals (latest only — yfinance doesn't
                # give historical P/E reliably). Stored against today's date.
                try:
                    tk = yf.Ticker(tkr)
                    info = tk.info or {}
                    today = datetime.utcnow().date()
                    db.merge(StockFundamental(
                        symbol=symbol,
                        date=today,
                        pe=_safe(info.get("trailingPE")),
                        pb=_safe(info.get("priceToBook")),
                        eps=_safe(info.get("trailingEps")),
                        market_cap=_safe(info.get("marketCap")),
                        roe=_safe(info.get("returnOnEquity")),
                    ))
                except Exception:  # noqa: BLE001 — fundamentals are best-effort
                    pass
        except Exception as e:  # noqa: BLE001
            log.warning("Failed for %s (%s): %s", symbol, tkr, e)


def _safe(x) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        return v if not (v != v) else None  # NaN check
    except (TypeError, ValueError):
        return None


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    init_db()
    fetch_indices()
    fetch_stocks()
    log.info("Done.")


if __name__ == "__main__":
    main()
