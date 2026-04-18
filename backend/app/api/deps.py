from __future__ import annotations

from fastapi import Depends, HTTPException, Path
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Game


def get_active_game(
    game_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
) -> Game:
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(404, "Game not found")
    return game


def get_any_game(
    game_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
) -> Game:
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(404, "Game not found")
    return game
