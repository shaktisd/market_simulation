from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_active_game
from app.core.db import get_db
from app.models import Game
from app.schemas import GameStateResponse, NextTurnResponse, StartGameRequest
from app.services.engine import EngineError, next_turn, start_game, value_portfolio

router = APIRouter(prefix="/game", tags=["game"])


@router.post("/start", response_model=GameStateResponse)
def start(req: StartGameRequest, db: Session = Depends(get_db)) -> GameStateResponse:
    try:
        g = start_game(db, req.step_unit)
    except EngineError as e:
        raise HTTPException(400, str(e))
    v = value_portfolio(db, g)
    return GameStateResponse(
        game_id=g.id,
        turn_index=g.turn_index,
        step_unit=g.step_unit,  # type: ignore[arg-type]
        cash=round(v.cash, 2),
        holdings_mv=round(v.holdings_mv, 2),
        nav=round(v.nav, 2),
        status=g.status,
        ended=g.status == "ended",
    )


@router.get("/{game_id}/state", response_model=GameStateResponse)
def state(game: Game = Depends(get_active_game), db: Session = Depends(get_db)) -> GameStateResponse:
    v = value_portfolio(db, game)
    return GameStateResponse(
        game_id=game.id,
        turn_index=game.turn_index,
        step_unit=game.step_unit,  # type: ignore[arg-type]
        cash=round(v.cash, 2),
        holdings_mv=round(v.holdings_mv, 2),
        nav=round(v.nav, 2),
        status=game.status,
        ended=game.status == "ended",
    )


@router.post("/{game_id}/next", response_model=NextTurnResponse)
def advance(game: Game = Depends(get_active_game), db: Session = Depends(get_db)) -> NextTurnResponse:
    if game.status == "ended":
        raise HTTPException(400, "Game already ended")
    ended = next_turn(db, game)
    v = value_portfolio(db, game)
    return NextTurnResponse(
        game_id=game.id,
        turn_index=game.turn_index,
        ended=ended,
        cash=round(v.cash, 2),
        holdings_mv=round(v.holdings_mv, 2),
        nav=round(v.nav, 2),
    )


@router.post("/{game_id}/end", response_model=NextTurnResponse)
def end_now(game: Game = Depends(get_active_game), db: Session = Depends(get_db)) -> NextTurnResponse:
    from app.services.engine import _finalize  # internal but intentional
    if game.status == "ended":
        raise HTTPException(400, "Game already ended")
    # Jump current date to end date for valuation consistency
    game.current_date = game.hidden_end_date
    game.turn_index += 1
    from app.services.engine import _snapshot
    _snapshot(db, game)
    _finalize(db, game)
    db.commit()
    v = value_portfolio(db, game)
    return NextTurnResponse(
        game_id=game.id,
        turn_index=game.turn_index,
        ended=True,
        cash=round(v.cash, 2),
        holdings_mv=round(v.holdings_mv, 2),
        nav=round(v.nav, 2),
    )
