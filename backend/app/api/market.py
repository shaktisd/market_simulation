from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.core.time_masking import mask_series
from app.models import Game, MFScheme, Stock
from app.schemas import (
    BenchmarkSeries,
    InstrumentInfo,
    PricePoint,
    PriceWindow,
    SectorRow,
)
from app.services import pricing
from app.services.mf_api import ensure_nav_history, list_schemes

router = APIRouter(prefix="/game", tags=["market"])


def _pct_change(series: list[tuple], lookback_days: int, end) -> float | None:
    if not series:
        return None
    target = end - timedelta(days=lookback_days)
    # Find first point on-or-after target
    older = None
    for d, v in series:
        if d >= target:
            older = v
            break
    if older is None or older == 0:
        return None
    latest = series[-1][1]
    return (latest / older - 1) * 100


@router.get("/{game_id}/market/stocks", response_model=list[InstrumentInfo])
def list_stocks(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    sector: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(600, le=600),
) -> list[InstrumentInfo]:
    query = db.query(Stock)
    if sector:
        query = query.filter(Stock.industry == sector)
    if q:
        like = f"%{q.lower()}%"
        from sqlalchemy import func, or_
        query = query.filter(or_(
            func.lower(Stock.symbol).like(like),
            func.lower(Stock.company_name).like(like),
        ))
    stocks = query.order_by(Stock.symbol).limit(limit).all()
    out: list[InstrumentInfo] = []
    for s in stocks:
        series = pricing.price_window(db, s.symbol, game.current_date, 365)
        if not series:
            continue
        last = series[-1][1]
        out.append(
            InstrumentInfo(
                symbol=s.symbol,
                name=s.company_name,
                sector=s.industry,
                last_price=round(last, 4),
                change_pct_1m=_pct_change(series, 30, game.current_date),
                change_pct_6m=_pct_change(series, 182, game.current_date),
                change_pct_12m=_pct_change(series, 365, game.current_date),
            )
        )
    return out


@router.get("/{game_id}/market/stocks/{symbol}", response_model=PriceWindow)
def stock_detail(
    symbol: str,
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    lookback_days: int = Query(365, ge=30, le=1825),
) -> PriceWindow:
    stock = db.get(Stock, symbol)
    if stock is None:
        raise HTTPException(404, "Unknown stock")
    series = pricing.price_window(db, symbol, game.current_date, lookback_days)
    if not series:
        raise HTTPException(404, "No price data for period")
    masked = mask_series(series, game.current_date)
    fund = pricing.latest_fundamentals(db, symbol, game.current_date)
    return PriceWindow(
        symbol=stock.symbol,
        name=stock.company_name,
        instrument_type="stock",
        sector=stock.industry,
        points=[PricePoint(t=t, price=round(p, 4)) for t, p in masked],
        last_price=round(series[-1][1], 4),
        fundamentals=fund,
    )


@router.get("/{game_id}/market/funds", response_model=list[InstrumentInfo])
def list_funds(
    _game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    category: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(200, le=500),
) -> list[InstrumentInfo]:
    """Scheme metadata only. Per-scheme NAV is fetched lazily on detail click —
    eager-fetching across the full ~10k Direct-Growth catalog would take
    minutes on first call. Use the search box to narrow down."""
    schemes = list(list_schemes(db, category=category))
    if q:
        ql = q.lower()
        schemes = [s for s in schemes if ql in s.scheme_name.lower()]
    schemes = schemes[:limit]
    return [
        InstrumentInfo(
            symbol=str(s.scheme_code),
            name=s.scheme_name,
            sector=s.category,
            last_price=None,
            change_pct_1m=None,
            change_pct_6m=None,
            change_pct_12m=None,
        )
        for s in schemes
    ]


@router.get("/{game_id}/market/funds/{scheme_code}", response_model=PriceWindow)
def fund_detail(
    scheme_code: int,
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    lookback_days: int = Query(365, ge=30, le=1825),
) -> PriceWindow:
    scheme = db.get(MFScheme, scheme_code)
    if scheme is None:
        raise HTTPException(404, "Unknown scheme")
    ensure_nav_history(db, scheme_code)

    end = game.current_date
    series = pricing.mf_nav_window(db, scheme_code, end, lookback_days)
    if not series:
        # Fallback: many funds have inception dates after the (hidden) game
        # period or have sparse history. Anchor the window to the most recent
        # available NAV at-or-before current_date instead of failing outright.
        latest = pricing.mf_latest_date_on_or_before(db, scheme_code, end)
        if latest is None:
            raise HTTPException(
                404,
                "This fund has no NAV history within the current game period — "
                "it was likely launched later. Try a different scheme.",
            )
        series = pricing.mf_nav_window(db, scheme_code, latest, lookback_days)
        if not series:
            raise HTTPException(404, "No NAV data available for this scheme.")

    masked = mask_series(series, end)
    return PriceWindow(
        symbol=str(scheme_code),
        name=scheme.scheme_name,
        instrument_type="mf",
        sector=scheme.category,
        points=[PricePoint(t=t, price=round(p, 4)) for t, p in masked],
        last_price=round(series[-1][1], 4),
        fundamentals=None,
    )


@router.get("/{game_id}/market/sectors", response_model=list[SectorRow])
def sectors(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    lookback_days: int = Query(30, ge=7, le=365),
) -> list[SectorRow]:
    stocks = db.query(Stock).all()
    per_sector: dict[str, list[float]] = defaultdict(list)
    for s in stocks:
        series = pricing.price_window(db, s.symbol, game.current_date, lookback_days + 15)
        if len(series) < 2:
            continue
        pct = _pct_change(series, lookback_days, game.current_date)
        if pct is not None:
            per_sector[s.industry].append(pct)
    return [
        SectorRow(sector=k, change_pct=round(sum(v) / len(v), 2), count=len(v))
        for k, v in sorted(per_sector.items())
    ]


@router.get("/{game_id}/market/benchmarks", response_model=list[BenchmarkSeries])
def benchmarks(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
    lookback_days: int = Query(365, ge=30, le=3650),
) -> list[BenchmarkSeries]:
    out: list[BenchmarkSeries] = []
    for name in ("NIFTY50", "NIFTY500"):
        series = pricing.index_window(db, name, game.current_date, lookback_days)
        if not series:
            continue
        masked = mask_series(series, game.current_date)
        out.append(
            BenchmarkSeries(
                name=name,
                points=[PricePoint(t=t, price=round(p, 4)) for t, p in masked],
            )
        )
    return out


@router.get("/{game_id}/market/mf-categories", response_model=list[str])
def mf_categories(db: Session = Depends(get_db)) -> list[str]:
    rows = db.query(MFScheme.category).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


@router.get("/{game_id}/market/stock-sectors", response_model=list[str])
def stock_sectors(db: Session = Depends(get_db)) -> list[str]:
    rows = db.query(Stock.industry).distinct().all()
    return sorted({r[0] for r in rows if r[0]})
