from __future__ import annotations

import math
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.models import Game, Holding, IndexPrice, MFScheme, Order, Stock, TurnSnapshot
from app.schemas import (
    CompositionResponse,
    CompositionSlice,
    HoldingMover,
    NavHistoryPoint,
    NavHistoryResponse,
    RiskMetricsResponse,
    TurnAnalyticsResponse,
)
from app.services import pricing

router = APIRouter(prefix="/game", tags=["analytics"])


@router.get("/{game_id}/nav-history", response_model=NavHistoryResponse)
def nav_history(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> NavHistoryResponse:
    """NAV at every turn, indexed by turn number. Real dates intentionally
    omitted so the time period stays hidden during play."""
    snaps = (
        db.query(TurnSnapshot)
        .filter(TurnSnapshot.game_id == game.id)
        .order_by(TurnSnapshot.turn_index.asc())
        .all()
    )
    return NavHistoryResponse(
        starting_nav=round(game.starting_cash, 2),
        points=[
            NavHistoryPoint(
                turn=s.turn_index,
                nav=round(s.nav, 2),
                cash=round(s.cash, 2),
                holdings_mv=round(s.holdings_mv, 2),
            )
            for s in snaps
        ],
    )


def _round(v: float, d: int = 2) -> float:
    return round(v, d)


@router.get("/{game_id}/composition", response_model=CompositionResponse)
def composition(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> CompositionResponse:
    holdings = db.query(Holding).filter(Holding.game_id == game.id).all()

    asset_value = {"stock": 0.0, "mf": 0.0}
    sector_value: dict[str, float] = defaultdict(float)
    on = game.current_date

    for h in holdings:
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            price = pricing.price_on_or_before(db, h.symbol, on)
            stock = db.get(Stock, h.symbol)
            sector = (stock.industry if stock else None) or "Unknown"
        else:
            price = pricing.mf_nav_on_or_before(db, int(h.symbol), on)
            scheme = db.get(MFScheme, int(h.symbol))
            sector = (scheme.category if scheme else None) or "Other MF"
        if price is None:
            continue
        mv = h.quantity * price
        asset_value[h.instrument_type] += mv
        sector_value[sector] += mv

    cash = game.cash
    nav = cash + asset_value["stock"] + asset_value["mf"]

    def _slice(label: str, value: float) -> CompositionSlice:
        weight = (value / nav) if nav > 0 else 0.0
        return CompositionSlice(label=label, value=_round(value), weight=round(weight, 6))

    by_asset = [
        _slice("Stocks", asset_value["stock"]),
        _slice("Mutual Funds", asset_value["mf"]),
        _slice("Cash", cash),
    ]
    # filter out zero-weight rows except Cash (always informative)
    by_asset = [s for s in by_asset if s.value > 0 or s.label == "Cash"]

    by_sector = [_slice(s, v) for s, v in sorted(sector_value.items(), key=lambda kv: -kv[1])]
    by_sector.append(_slice("Cash", cash))

    return CompositionResponse(nav=_round(nav), by_asset_class=by_asset, by_sector=by_sector)


@router.get("/{game_id}/turn-analytics", response_model=TurnAnalyticsResponse)
def turn_analytics(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> TurnAnalyticsResponse:
    """Snapshot the change between this turn and the previous one."""
    snaps = (
        db.query(TurnSnapshot)
        .filter(TurnSnapshot.game_id == game.id)
        .order_by(TurnSnapshot.turn_index.desc())
        .limit(2)
        .all()
    )
    if not snaps:
        return TurnAnalyticsResponse(
            turn_index=game.turn_index, has_previous=False, nav_now=game.cash,
            nav_prev=None, nav_delta=0, nav_delta_pct=None, holdings_delta=0,
            cash_delta=0, net_invested_change=0, top_gainers=[], top_losers=[],
        )
    cur = snaps[0]
    prev = snaps[1] if len(snaps) > 1 else None

    if prev is None:
        return TurnAnalyticsResponse(
            turn_index=cur.turn_index, has_previous=False, nav_now=_round(cur.nav),
            nav_prev=None, nav_delta=0, nav_delta_pct=None, holdings_delta=0,
            cash_delta=0, net_invested_change=0, top_gainers=[], top_losers=[],
        )

    nav_delta = cur.nav - prev.nav
    nav_pct = (nav_delta / prev.nav) * 100 if prev.nav > 0 else None
    holdings_delta = cur.holdings_mv - prev.holdings_mv
    cash_delta = cur.cash - prev.cash

    # Net invested change this turn (orders executed at cur turn_index)
    orders_this_turn = (
        db.query(Order)
        .filter(Order.game_id == game.id, Order.turn_index == cur.turn_index)
        .all()
    )
    net_invested = sum(o.gross if o.side == "BUY" else -o.gross for o in orders_this_turn)

    # Per-holding contribution: qty_now * (price_now - price_prev_snapshot_date)
    movers: list[HoldingMover] = []
    for h in db.query(Holding).filter(Holding.game_id == game.id).all():
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            curr = pricing.price_on_or_before(db, h.symbol, cur.hidden_date)
            prevp = pricing.price_on_or_before(db, h.symbol, prev.hidden_date)
            stock = db.get(Stock, h.symbol)
            name = stock.company_name if stock else h.symbol
        else:
            curr = pricing.mf_nav_on_or_before(db, int(h.symbol), cur.hidden_date)
            prevp = pricing.mf_nav_on_or_before(db, int(h.symbol), prev.hidden_date)
            scheme = db.get(MFScheme, int(h.symbol))
            name = scheme.scheme_name if scheme else h.symbol
        if curr is None:
            continue
        contrib = h.quantity * ((curr - (prevp or curr)))
        pct = ((curr / prevp) - 1) * 100 if prevp and prevp > 0 else None
        movers.append(
            HoldingMover(
                instrument_type=h.instrument_type,  # type: ignore[arg-type]
                symbol=h.symbol,
                name=name,
                quantity=round(h.quantity, 6),
                prev_price=round(prevp, 4) if prevp is not None else None,
                curr_price=round(curr, 4),
                contribution=_round(contrib),
                pct_change=round(pct, 2) if pct is not None else None,
            )
        )
    movers.sort(key=lambda m: m.contribution, reverse=True)
    top_gainers = [m for m in movers if m.contribution > 0][:3]
    top_losers = sorted([m for m in movers if m.contribution < 0], key=lambda m: m.contribution)[:3]

    return TurnAnalyticsResponse(
        turn_index=cur.turn_index,
        has_previous=True,
        nav_now=_round(cur.nav),
        nav_prev=_round(prev.nav),
        nav_delta=_round(nav_delta),
        nav_delta_pct=round(nav_pct, 4) if nav_pct is not None else None,
        holdings_delta=_round(holdings_delta),
        cash_delta=_round(cash_delta),
        net_invested_change=_round(net_invested),
        top_gainers=top_gainers,
        top_losers=top_losers,
    )


_ANN_FACTOR = {"day": 252, "week": 52, "month": 12}
_RISK_FREE = 0.07


@router.get("/{game_id}/risk-metrics", response_model=RiskMetricsResponse)
def risk_metrics(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> RiskMetricsResponse:
    """Live portfolio risk dashboard. Volatility uses the last 30 turn returns;
    beta pairs those returns against NIFTY50 close on the same snapshot dates;
    HHI buckets current holdings plus cash."""
    snaps = (
        db.query(TurnSnapshot)
        .filter(TurnSnapshot.game_id == game.id)
        .order_by(TurnSnapshot.turn_index.asc())
        .all()
    )
    nav_series = [s.nav for s in snaps]
    dates = [s.hidden_date for s in snaps]

    returns: list[float] = []
    for i in range(1, len(nav_series)):
        prev, cur = nav_series[i - 1], nav_series[i]
        if prev > 0:
            returns.append(cur / prev - 1)

    ann_factor = _ANN_FACTOR.get(game.step_unit, 12)

    vol_ann: float | None = None
    tail = returns[-30:]
    if len(tail) >= 2:
        mean = sum(tail) / len(tail)
        var = sum((r - mean) ** 2 for r in tail) / (len(tail) - 1)
        vol_ann = math.sqrt(var) * math.sqrt(ann_factor)

    beta: float | None = None
    if len(returns) >= 2:
        nifty: list[float | None] = []
        for d in dates:
            row = db.execute(
                select(IndexPrice.close)
                .where(IndexPrice.index_name == "NIFTY50", IndexPrice.date <= d)
                .order_by(IndexPrice.date.desc())
                .limit(1)
            ).scalar_one_or_none()
            nifty.append(float(row) if row is not None else None)

        port_rets: list[float] = []
        mkt_rets: list[float] = []
        for i in range(1, len(dates)):
            pn, cn = nifty[i - 1], nifty[i]
            pp, cp = nav_series[i - 1], nav_series[i]
            if pn and cn and pn > 0 and pp > 0:
                port_rets.append(cp / pp - 1)
                mkt_rets.append(cn / pn - 1)
        if len(port_rets) >= 2:
            mp = sum(port_rets) / len(port_rets)
            mm = sum(mkt_rets) / len(mkt_rets)
            cov = sum(
                (port_rets[i] - mp) * (mkt_rets[i] - mm) for i in range(len(port_rets))
            ) / (len(port_rets) - 1)
            var_m = sum((r - mm) ** 2 for r in mkt_rets) / (len(mkt_rets) - 1)
            if var_m > 1e-12:
                beta = cov / var_m

    drawdown: float | None = None
    if nav_series:
        all_navs = [game.starting_cash, *nav_series]
        peak = max(all_navs)
        last = nav_series[-1]
        if peak > 0:
            drawdown = (last - peak) / peak

    on = game.current_date
    holding_values: list[float] = []
    for h in db.query(Holding).filter(Holding.game_id == game.id).all():
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            p = pricing.price_on_or_before(db, h.symbol, on)
        else:
            p = pricing.mf_nav_on_or_before(db, int(h.symbol), on)
        if p is not None:
            holding_values.append(h.quantity * p)
    holding_values.append(game.cash)
    total = sum(holding_values)
    hhi: float | None = None
    if total > 0:
        hhi = sum((v / total) ** 2 for v in holding_values)

    sharpe: float | None = None
    if len(returns) >= 2 and vol_ann and vol_ann > 1e-9:
        mean_per_step = sum(returns) / len(returns)
        ann_ret = (1 + mean_per_step) ** ann_factor - 1
        sharpe = (ann_ret - _RISK_FREE) / vol_ann

    return RiskMetricsResponse(
        volatility_ann=round(vol_ann, 4) if vol_ann is not None else None,
        beta=round(beta, 3) if beta is not None else None,
        drawdown=round(drawdown, 4) if drawdown is not None else None,
        hhi=round(hhi, 4) if hhi is not None else None,
        sharpe=round(sharpe, 3) if sharpe is not None else None,
        turns_observed=len(returns),
    )
