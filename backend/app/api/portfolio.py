from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.models import Game, Holding, MFScheme, Stock
from app.schemas import HoldingOut, PortfolioResponse
from app.services import pricing

router = APIRouter(prefix="/game", tags=["portfolio"])


@router.get("/{game_id}/portfolio", response_model=PortfolioResponse)
def portfolio(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> PortfolioResponse:
    rows: list[HoldingOut] = []
    mv_total = 0.0
    for h in db.query(Holding).filter(Holding.game_id == game.id).all():
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            last = pricing.price_on_or_before(db, h.symbol, game.current_date)
            stock = db.get(Stock, h.symbol)
            name = stock.company_name if stock else h.symbol
        else:
            last = pricing.mf_nav_on_or_before(db, int(h.symbol), game.current_date)
            scheme = db.get(MFScheme, int(h.symbol))
            name = scheme.scheme_name if scheme else h.symbol
        if last is None:
            continue
        mv = h.quantity * last
        mv_total += mv
        pnl = mv - h.quantity * h.avg_cost
        pct = (pnl / (h.quantity * h.avg_cost)) * 100 if h.avg_cost > 0 else 0.0
        rows.append(
            HoldingOut(
                instrument_type=h.instrument_type,  # type: ignore[arg-type]
                symbol=h.symbol,
                name=name,
                quantity=round(h.quantity, 6),
                avg_cost=round(h.avg_cost, 4),
                last_price=round(last, 4),
                market_value=round(mv, 2),
                unrealized_pnl=round(pnl, 2),
                unrealized_pct=round(pct, 2),
            )
        )
    return PortfolioResponse(
        cash=round(game.cash, 2),
        holdings_mv=round(mv_total, 2),
        nav=round(game.cash + mv_total, 2),
        holdings=rows,
    )
