"""Adapter between engine turns and the incremental simulator.

Owns (de)serialization of AlgoRunState <-> AlgoRunInFlight, and provides the
three entry points the engine uses: ensure_state_rows (on game start),
advance_all_algos (every turn), finalize_all_algos (at game end).
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict
from datetime import date

from sqlalchemy.orm import Session

from app.models import AlgoRun, AlgoRunState, Game, Stock
from app.schemas import (
    AlgoHoldingOut,
    AlgoRebalanceEntry,
    AlgoResultsResponse,
    AlgoStrategyResult,
)
from app.services.algos.base import AlgoRunInFlight, RebalanceEntry
from app.services.algos.registry import STRATEGIES
from app.services.algos.simulator import (
    _value_holdings,
    advance_run_state,
    finalize_run_state,
    init_run_state,
)
from app.services.benchmarks import cagr, max_drawdown

log = logging.getLogger(__name__)


def _state_to_inflight(row: AlgoRunState) -> AlgoRunInFlight:
    holdings = {k: float(v) for k, v in json.loads(row.holdings_json or "{}").items()}
    avg_costs = {k: float(v) for k, v in json.loads(row.avg_costs_json or "{}").items()}
    curve_raw = json.loads(row.curve_json or "[]")
    curve = [(date.fromisoformat(d), float(n)) for d, n in curve_raw]
    rebalances = [
        RebalanceEntry(
            date=r["date"], trades=r["trades"], charges=r["charges"], symbols=r.get("symbols", [])
        )
        for r in json.loads(row.rebalance_log_json or "[]")
    ]
    return AlgoRunInFlight(
        cash=float(row.cash),
        total_charges=float(row.total_charges or 0.0),
        last_processed_date=row.last_processed_date,
        last_rebalance_date=row.last_rebalance_date,
        holdings=holdings,
        avg_costs=avg_costs,
        curve=curve,
        rebalances=rebalances,
    )


def _inflight_to_state(state: AlgoRunInFlight, row: AlgoRunState) -> None:
    row.cash = state.cash
    row.total_charges = state.total_charges
    row.last_processed_date = state.last_processed_date
    row.last_rebalance_date = state.last_rebalance_date
    row.holdings_json = json.dumps({k: v for k, v in state.holdings.items()})
    row.avg_costs_json = json.dumps({k: v for k, v in state.avg_costs.items()})
    row.curve_json = json.dumps([[d.isoformat(), round(n, 2)] for d, n in state.curve])
    row.rebalance_log_json = json.dumps([asdict(r) for r in state.rebalances])


def ensure_state_rows(db: Session, game: Game) -> None:
    existing = {
        r.strategy_key
        for r in db.query(AlgoRunState).filter(AlgoRunState.game_id == game.id).all()
    }
    for key in STRATEGIES:
        if key in existing:
            continue
        db.add(
            AlgoRunState(
                game_id=game.id,
                strategy_key=key,
                cash=float(game.starting_cash),
                total_charges=0.0,
                last_processed_date=None,
                last_rebalance_date=None,
                holdings_json="{}",
                avg_costs_json="{}",
                curve_json="[]",
                rebalance_log_json="[]",
            )
        )
    db.flush()


def advance_all_algos(db: Session, game: Game, as_of: date) -> None:
    ensure_state_rows(db, game)
    for key, strategy in STRATEGIES.items():
        row = db.get(AlgoRunState, (game.id, key))
        if row is None:
            continue
        try:
            inflight = _state_to_inflight(row)
            advance_run_state(
                db,
                strategy,
                inflight,
                as_of,
                starting_cash=float(game.starting_cash),
                first_rebalance_date=game.hidden_start_date,
                rebalance_days=90,
            )
            _inflight_to_state(inflight, row)
        except Exception as e:  # noqa: BLE001
            log.warning("advance_all_algos: %s failed on %s: %s", key, as_of, e)
    db.flush()


def load_live_results(db: Session, game: Game) -> AlgoResultsResponse:
    from app.models import AlgoStrategy as AlgoStrategyModel

    rows = db.query(AlgoRunState).filter(AlgoRunState.game_id == game.id).all()
    catalog = {s.key: s for s in db.query(AlgoStrategyModel).all()}
    stock_names = {s.symbol: s.company_name for s in db.query(Stock).all()}

    out: list[AlgoStrategyResult] = []
    for row in rows:
        meta = catalog.get(row.strategy_key)
        if meta is None:
            continue
        inflight = _state_to_inflight(row)
        curve = inflight.curve
        nav_curve = [[d.isoformat(), round(n, 2)] for d, n in curve]
        final_nav = curve[-1][1] if curve else float(game.starting_cash)

        if curve and len(curve) >= 2:
            days = max(1, (curve[-1][0] - curve[0][0]).days)
            port_cagr = cagr(float(game.starting_cash), final_nav, days)
            mdd = max_drawdown([n for _, n in curve])
        else:
            port_cagr = 0.0
            mdd = 0.0

        on = row.last_processed_date or game.current_date
        mv, prices = _value_holdings(db, inflight.holdings, on)
        total_for_weights = inflight.cash + mv
        holdings_out: list[AlgoHoldingOut] = []
        for sym, qty in inflight.holdings.items():
            if qty <= 0:
                continue
            p = prices.get(sym, 0.0)
            h_mv = p * qty
            weight = (h_mv / total_for_weights) if total_for_weights > 0 else 0.0
            holdings_out.append(
                AlgoHoldingOut(
                    symbol=sym,
                    name=stock_names.get(sym, sym),
                    qty=round(qty, 4),
                    avg_cost=round(inflight.avg_costs.get(sym, 0.0), 2),
                    last_price=round(p, 2),
                    market_value=round(h_mv, 2),
                    weight=round(weight, 6),
                )
            )
        holdings_out.sort(key=lambda h: h.market_value, reverse=True)

        rebalance_log = [
            AlgoRebalanceEntry(
                date=r.date, trades=r.trades, charges=r.charges, symbols=r.symbols
            )
            for r in inflight.rebalances
        ]

        out.append(
            AlgoStrategyResult(
                key=row.strategy_key,
                display_name=meta.display_name,
                description=meta.description,
                final_nav=round(final_nav, 2),
                cagr=round(port_cagr, 6),
                max_drawdown=round(mdd, 6),
                total_charges=round(inflight.total_charges, 2),
                nav_curve=nav_curve,
                final_holdings=holdings_out,
                rebalance_log=rebalance_log,
            )
        )
    out.sort(key=lambda r: r.cagr, reverse=True)
    return AlgoResultsResponse(
        game_id=game.id,
        starting_nav=round(game.starting_cash, 2),
        strategies=out,
    )


def finalize_all_algos(db: Session, game: Game) -> None:
    """At game end: catch each state up to hidden_end_date, compute scalars, upsert AlgoRun."""
    ensure_state_rows(db, game)
    for key, strategy in STRATEGIES.items():
        row = db.get(AlgoRunState, (game.id, key))
        if row is None:
            continue
        try:
            inflight = _state_to_inflight(row)
            # Catch up to end date in case the user ended early
            advance_run_state(
                db,
                strategy,
                inflight,
                game.hidden_end_date,
                starting_cash=float(game.starting_cash),
                first_rebalance_date=game.hidden_start_date,
                rebalance_days=90,
            )
            _inflight_to_state(inflight, row)

            res = finalize_run_state(
                db,
                inflight,
                float(game.starting_cash),
                game.hidden_start_date,
                game.hidden_end_date,
            )
            curve_json = json.dumps([[d.isoformat(), round(n, 2)] for d, n in res.curve])
            holdings_json = json.dumps([asdict(h) for h in res.holdings])
            rebalance_json = json.dumps([asdict(r) for r in res.rebalances])
            db.merge(
                AlgoRun(
                    game_id=game.id,
                    strategy_key=key,
                    final_nav=res.final_nav,
                    cagr=res.cagr,
                    max_drawdown=res.max_drawdown,
                    total_charges=res.total_charges,
                    nav_curve_json=curve_json,
                    final_holdings_json=holdings_json,
                    rebalance_log_json=rebalance_json,
                )
            )
        except Exception as e:  # noqa: BLE001
            log.warning("finalize_all_algos: %s failed: %s", key, e)
    db.flush()
