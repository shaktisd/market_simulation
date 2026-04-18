"""Load the Nifty 500 universe from the CSV at docs/ind_nifty500list.csv."""
from __future__ import annotations

import csv
import logging
from pathlib import Path

from sqlalchemy import select

from app.core.config import UNIVERSE_CSV
from app.core.db import init_db, session_scope
from app.models import Stock

log = logging.getLogger(__name__)


def _yf_ticker(symbol: str) -> str:
    # NSE tickers on yfinance use .NS suffix
    return f"{symbol}.NS"


def load_universe(csv_path: Path = UNIVERSE_CSV) -> int:
    init_db()
    if not csv_path.exists():
        raise FileNotFoundError(f"Universe CSV not found: {csv_path}")

    inserted = 0
    with session_scope() as db, open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        existing = {s for (s,) in db.execute(select(Stock.symbol)).all()}
        for row in reader:
            sym = (row.get("Symbol") or "").strip()
            if not sym:
                continue
            stock = Stock(
                symbol=sym,
                company_name=(row.get("Company Name") or "").strip(),
                industry=(row.get("Industry") or "").strip(),
                isin=(row.get("ISIN Code") or "").strip(),
                yf_ticker=_yf_ticker(sym),
            )
            if sym in existing:
                db.merge(stock)
            else:
                db.add(stock)
                inserted += 1
    log.info("Universe loaded: %d new stocks", inserted)
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    n = load_universe()
    print(f"Inserted {n} new stocks (existing rows upserted).")
