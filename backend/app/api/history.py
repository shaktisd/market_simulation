from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_any_game
from app.core.db import get_db
from app.models import Game, GameResult, Order, Stock, MFScheme, TurnSnapshot
from app.schemas import GameHistoryItem, GameResultResponse
from app.services.benchmarks import benchmark_curve_fd, benchmark_curve_index

router = APIRouter(tags=["history"])


@router.get("/game/{game_id}/result", response_model=GameResultResponse)
def game_result(
    game: Game = Depends(get_any_game),
    db: Session = Depends(get_db),
) -> GameResultResponse:
    if game.status != "ended":
        raise HTTPException(400, "Game not yet ended")
    result = db.get(GameResult, game.id)
    if result is None:
        raise HTTPException(500, "Result not materialized")

    # Portfolio curve from snapshots (with real dates, now OK to reveal)
    snaps = (
        db.query(TurnSnapshot)
        .filter(TurnSnapshot.game_id == game.id)
        .order_by(TurnSnapshot.turn_index.asc())
        .all()
    )
    portfolio_curve = [
        {"date": s.hidden_date.isoformat(), "nav": round(s.nav, 2)} for s in snaps
    ]

    # Benchmark curves sampled to manageable size
    def _to_dicts(curve: list) -> list[dict]:
        return [{"date": d.isoformat(), "nav": round(v, 2)} for d, v in curve]

    n50 = _to_dicts(
        benchmark_curve_index(
            db, "NIFTY50", game.hidden_start_date, game.hidden_end_date, game.starting_cash
        )
    )
    n500 = _to_dicts(
        benchmark_curve_index(
            db, "NIFTY500", game.hidden_start_date, game.hidden_end_date, game.starting_cash
        )
    )
    fd = _to_dicts(
        benchmark_curve_fd(game.hidden_start_date, game.hidden_end_date, game.starting_cash)
    )

    # Trade log
    orders = (
        db.query(Order)
        .filter(Order.game_id == game.id)
        .order_by(Order.executed_hidden_date.asc(), Order.id.asc())
        .all()
    )
    # name lookup
    stock_names = {s.symbol: s.company_name for s in db.query(Stock).all()}
    fund_names = {str(s.scheme_code): s.scheme_name for s in db.query(MFScheme).all()}

    trade_log = []
    for o in orders:
        name = stock_names.get(o.symbol) if o.instrument_type == "stock" else fund_names.get(o.symbol, o.symbol)
        trade_log.append({
            "date": o.executed_hidden_date.isoformat(),
            "instrument_type": o.instrument_type,
            "symbol": o.symbol,
            "name": name or o.symbol,
            "side": o.side,
            "quantity": o.quantity,
            "price": round(o.price, 4),
            "gross": round(o.gross, 2),
            "charges": round(o.charges, 2),
            "net_cashflow": round(o.net_cashflow, 2),
            "charges_breakdown": json.loads(o.charges_breakdown or "{}"),
            "realized_pnl": round(o.realized_pnl, 2),
        })

    months = (game.hidden_end_date - game.hidden_start_date).days // 30

    return GameResultResponse(
        game_id=game.id,
        revealed_start_date=game.hidden_start_date.isoformat(),
        revealed_end_date=game.hidden_end_date.isoformat(),
        months_played=months,
        final_nav=result.final_nav,
        cagr=result.cagr,
        max_drawdown=result.max_drawdown,
        total_charges=result.total_charges,
        total_taxes=result.total_taxes,
        benchmarks={
            "nifty50_cagr": result.benchmark_nifty50_cagr,
            "nifty500_cagr": result.benchmark_nifty500_cagr,
            "fd_cagr": result.benchmark_fd_cagr,
        },
        portfolio_curve=portfolio_curve,
        benchmark_curves={"NIFTY50": n50, "NIFTY500": n500, "FD_7PCT": fd},
        trade_log=trade_log,
    )


@router.get("/history", response_model=list[GameHistoryItem])
def list_history(db: Session = Depends(get_db)) -> list[GameHistoryItem]:
    rows = (
        db.query(Game, GameResult)
        .join(GameResult, GameResult.game_id == Game.id)
        .order_by(Game.created_at.desc())
        .all()
    )
    return [
        GameHistoryItem(
            game_id=g.id,
            created_at=g.created_at.isoformat(),
            revealed_start_date=r.revealed_start_date.isoformat(),
            revealed_end_date=r.revealed_end_date.isoformat(),
            final_nav=r.final_nav,
            cagr=r.cagr,
            benchmark_nifty50_cagr=r.benchmark_nifty50_cagr,
        )
        for g, r in rows
    ]
