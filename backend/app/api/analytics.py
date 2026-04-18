from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.models import Game, Holding, MFScheme, Order, Stock, TurnSnapshot
from app.schemas import (
    CompositionResponse,
    CompositionSlice,
    HoldingMover,
    NavHistoryPoint,
    NavHistoryResponse,
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
