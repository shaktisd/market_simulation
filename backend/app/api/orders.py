from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.models import Game
from app.schemas import ChargeBreakdown, OrderResponse, PlaceOrderRequest
from app.services.engine import EngineError, place_order

router = APIRouter(prefix="/game", tags=["orders"])


@router.post("/{game_id}/orders", response_model=OrderResponse)
def place(
    req: PlaceOrderRequest,
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> OrderResponse:
    try:
        out = place_order(
            db, game, req.instrument_type, req.symbol, req.side, req.value, req.mode
        )
    except EngineError as e:
        raise HTTPException(400, str(e))
    return OrderResponse(
        order_id=out["order_id"],
        price=out["price"],
        quantity=out["quantity"],
        gross=out["gross"],
        charges=ChargeBreakdown(**out["charges"]),
        net_cashflow=out["net_cashflow"],
        cash_after=out["cash_after"],
    )
