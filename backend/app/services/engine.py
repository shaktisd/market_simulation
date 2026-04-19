"""Game engine: start, advance turns, place orders, finalize and reveal.

Key invariant: this module and `core.time_masking` are the only places that
touch real calendar dates. API layer must use what's returned here.
"""
from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    AlgoRun,
    Game,
    GameResult,
    Holding,
    IndexPrice,
    MFScheme,
    Order,
    Stock,
    StockPrice,
    TurnSnapshot,
)
from app.services import pricing
from app.services.algos import STRATEGIES, run_strategy
from app.services.benchmarks import benchmark_curve_fd, benchmark_curve_index, cagr, max_drawdown
from app.services.charges import charges_for
from app.services.mf_api import ensure_nav_history
from app.services.taxes import compute_game_end_taxes

log = logging.getLogger(__name__)


StepUnit = Literal["day", "week", "month"]


class EngineError(Exception):
    """Raised for business-rule violations (insufficient cash, etc.)."""


@dataclass
class HoldingsValuation:
    cash: float
    holdings_mv: float
    nav: float


# ---------- Game lifecycle ----------


def _pick_hidden_period(db: Session, rng: random.Random) -> tuple[date, date]:
    """Pick a random (start, end) inside available price data.

    Start year >= settings.earliest_start_year.
    Length uniform in [min_game_days, max_game_days], clipped to available range.
    """
    earliest = max(
        date(settings.earliest_start_year, 1, 1),
        _min_data_date(db) or date(settings.earliest_start_year, 1, 1),
    )
    latest = _max_data_date(db) or date.today()
    if earliest >= latest:
        raise EngineError("Not enough historical data — run the ingest script first.")

    # Maximum possible game length given available data
    max_possible = (latest - earliest).days
    if max_possible < settings.min_game_days:
        raise EngineError("Insufficient historical data window for a game.")

    length = rng.randint(
        settings.min_game_days, min(settings.max_game_days, max_possible)
    )
    latest_start = latest - timedelta(days=length)
    start = earliest + timedelta(days=rng.randint(0, (latest_start - earliest).days))
    end = start + timedelta(days=length)
    return start, end


def _min_data_date(db: Session) -> date | None:
    return db.execute(select(IndexPrice.date).order_by(IndexPrice.date.asc()).limit(1)).scalar_one_or_none()


def _max_data_date(db: Session) -> date | None:
    return db.execute(select(IndexPrice.date).order_by(IndexPrice.date.desc()).limit(1)).scalar_one_or_none()


def _advance(d: date, step: StepUnit) -> date:
    if step == "day":
        return d + timedelta(days=1)
    if step == "week":
        return d + timedelta(weeks=1)
    return d + relativedelta(months=1)


def start_game(db: Session, step_unit: StepUnit, seed: int | None = None) -> Game:
    rng = random.Random(seed)
    start, end = _pick_hidden_period(db, rng)

    game = Game(
        step_unit=step_unit,
        hidden_start_date=start,
        hidden_end_date=end,
        current_date=start,
        starting_cash=settings.starting_cash,
        cash=settings.starting_cash,
        status="active",
        turn_index=0,
    )
    db.add(game)
    db.flush()

    _snapshot(db, game)
    db.commit()
    log.info("Started game %d: %s -> %s (hidden)", game.id, start, end)
    return game


def next_turn(db: Session, game: Game) -> bool:
    """Advance one step. Returns True if the game ended on this step."""
    if game.status != "active":
        return True

    proposed = _advance(game.current_date, game.step_unit)  # type: ignore[arg-type]
    if proposed >= game.hidden_end_date:
        game.current_date = game.hidden_end_date
        game.turn_index += 1
        _snapshot(db, game)
        _finalize(db, game)
        db.commit()
        return True

    game.current_date = proposed
    game.turn_index += 1
    _snapshot(db, game)
    db.commit()
    return False


# ---------- Valuation ----------


def value_portfolio(db: Session, game: Game) -> HoldingsValuation:
    mv = 0.0
    for h in db.query(Holding).filter(Holding.game_id == game.id).all():
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            p = pricing.price_on_or_before(db, h.symbol, game.current_date)
        else:
            p = pricing.mf_nav_on_or_before(db, int(h.symbol), game.current_date)
        if p is None:
            continue
        mv += h.quantity * p
    return HoldingsValuation(cash=game.cash, holdings_mv=mv, nav=game.cash + mv)


def _snapshot(db: Session, game: Game) -> None:
    v = value_portfolio(db, game)
    snap = TurnSnapshot(
        game_id=game.id,
        turn_index=game.turn_index,
        nav=v.nav,
        cash=v.cash,
        holdings_mv=v.holdings_mv,
        hidden_date=game.current_date,
    )
    db.merge(snap)


# ---------- Orders ----------


CHARGE_BUFFER = 1.005  # ~0.5% buffer to leave room for charges on weight/value buys


def _resolve_quantity(
    instrument_type: str,
    side: str,
    mode: str,
    value: float,
    price: float,
    cash_available: float,
    nav: float,
    quantity_held: float,
) -> float:
    """Translate mode+value into a concrete quantity.

    For BUY in weight/value modes, the result is capped at cash available
    (minus a small charges buffer). For SELL in weight/value modes, capped at
    holding quantity.
    """
    if mode == "qty":
        qty = value
    elif mode == "weight":
        if not (0 < value <= 100):
            raise EngineError("Weight must be in (0, 100].")
        target_inr = (value / 100.0) * nav
        qty = target_inr / price
    elif mode == "value":
        qty = value / price
    else:
        raise EngineError(f"Unknown order mode: {mode}")

    if side == "BUY":
        max_affordable = cash_available / (price * CHARGE_BUFFER)
        qty = min(qty, max_affordable)
    else:
        qty = min(qty, quantity_held)

    if instrument_type == "stock":
        qty = float(int(qty))  # floor to whole share

    if qty <= 0:
        raise EngineError(
            "Resolved quantity is zero — not enough cash, not enough holding, "
            "or weight/value too small for one share."
        )
    return qty


def place_order(
    db: Session,
    game: Game,
    instrument_type: Literal["stock", "mf"],
    symbol: str,
    side: Literal["BUY", "SELL"],
    value: float,
    mode: str = "qty",
) -> dict:
    if game.status != "active":
        raise EngineError("Game has already ended.")
    if value <= 0:
        raise EngineError("Value must be positive.")

    if instrument_type == "stock":
        if db.get(Stock, symbol) is None:
            raise EngineError(f"Unknown stock symbol: {symbol}")
        price = pricing.price_on_or_before(db, symbol, game.current_date)
    else:
        try:
            scheme_code = int(symbol)
        except ValueError:
            raise EngineError("Mutual fund symbol must be a scheme code.")
        if db.get(MFScheme, scheme_code) is None:
            raise EngineError(f"Unknown MF scheme: {symbol}")
        ensure_nav_history(db, scheme_code)
        price = pricing.mf_nav_on_or_before(db, scheme_code, game.current_date)

    if price is None:
        raise EngineError(f"No price data available for {symbol} at current turn.")

    # Need NAV + current holding for resolution
    valuation = value_portfolio(db, game)
    held = (
        db.query(Holding)
        .filter(
            Holding.game_id == game.id,
            Holding.instrument_type == instrument_type,
            Holding.symbol == str(symbol),
        )
        .one_or_none()
    )
    qty_held = held.quantity if held else 0.0
    quantity = _resolve_quantity(
        instrument_type=instrument_type,
        side=side,
        mode=mode,
        value=value,
        price=price,
        cash_available=valuation.cash,
        nav=valuation.nav,
        quantity_held=qty_held,
    )

    gross = price * quantity
    charge_line = charges_for(instrument_type, gross, side)
    charge_total = charge_line.total

    holding = held
    realized_pnl = 0.0
    if side == "BUY":
        total_out = gross + charge_total
        if game.cash < total_out - 1e-6:
            raise EngineError("Insufficient cash for this order.")
        game.cash -= total_out
        if holding is None:
            holding = Holding(
                game_id=game.id,
                instrument_type=instrument_type,
                symbol=str(symbol),
                quantity=quantity,
                avg_cost=(gross + charge_total) / quantity,
                first_buy_date=game.current_date,
            )
            db.add(holding)
        else:
            prev_total_cost = holding.avg_cost * holding.quantity
            new_total_cost = prev_total_cost + gross + charge_total
            new_qty = holding.quantity + quantity
            holding.avg_cost = new_total_cost / new_qty
            holding.quantity = new_qty
            if holding.first_buy_date is None:
                holding.first_buy_date = game.current_date
        net_cashflow = -total_out
    else:  # SELL
        if holding is None or holding.quantity < quantity - 1e-9:
            raise EngineError("Insufficient quantity held to sell (short-selling disabled).")
        proceeds = gross - charge_total
        realized_pnl = (price - holding.avg_cost) * quantity - charge_total
        game.cash += proceeds
        holding.quantity -= quantity
        if holding.quantity < 1e-9:
            # Preserve first_buy_date if the user re-buys later? We reset.
            db.delete(holding)
        net_cashflow = proceeds

    order = Order(
        game_id=game.id,
        turn_index=game.turn_index,
        instrument_type=instrument_type,
        symbol=str(symbol),
        side=side,
        quantity=quantity,
        price=price,
        gross=round(gross, 4),
        charges=round(charge_total, 4),
        net_cashflow=round(net_cashflow, 4),
        charges_breakdown=json.dumps(charge_line.to_dict()),
        executed_hidden_date=game.current_date,
        realized_pnl=round(realized_pnl, 4),
    )
    db.add(order)
    # Flush so the deleted/updated Holding rows are visible to the snapshot query
    db.flush()

    _snapshot(db, game)
    db.commit()

    return {
        "order_id": order.id,
        "price": round(price, 4),
        "quantity": round(quantity, 6),
        "gross": round(gross, 4),
        "charges": charge_line.to_dict(),
        "net_cashflow": round(net_cashflow, 4),
        "cash_after": round(game.cash, 4),
    }


# ---------- End-of-game ----------


def _finalize(db: Session, game: Game) -> None:
    game.status = "ended"
    v = value_portfolio(db, game)
    tax_report = compute_game_end_taxes(db, game)
    final_nav = v.nav - tax_report.total_tax

    # Curves
    nav_curve = [
        (s.hidden_date, s.nav)
        for s in db.query(TurnSnapshot)
        .filter(TurnSnapshot.game_id == game.id)
        .order_by(TurnSnapshot.turn_index.asc())
        .all()
    ]
    days = max(1, (game.hidden_end_date - game.hidden_start_date).days)
    port_cagr = cagr(game.starting_cash, final_nav, days)
    mdd = max_drawdown([nav for _, nav in nav_curve])

    n50 = benchmark_curve_index(
        db, "NIFTY50", game.hidden_start_date, game.hidden_end_date, game.starting_cash
    )
    n500 = benchmark_curve_index(
        db, "NIFTY500", game.hidden_start_date, game.hidden_end_date, game.starting_cash
    )
    fd = benchmark_curve_fd(game.hidden_start_date, game.hidden_end_date, game.starting_cash)

    def _final(curve: list[tuple[date, float]]) -> float | None:
        return curve[-1][1] if curve else None

    n50_cagr = cagr(game.starting_cash, _final(n50), days) if _final(n50) else None
    n500_cagr = cagr(game.starting_cash, _final(n500), days) if _final(n500) else None
    fd_cagr = cagr(game.starting_cash, _final(fd), days) if _final(fd) else None

    total_charges = sum(o.charges for o in db.query(Order).filter(Order.game_id == game.id).all())

    result = GameResult(
        game_id=game.id,
        final_nav=round(final_nav, 2),
        cagr=round(port_cagr, 6),
        max_drawdown=round(mdd, 6),
        total_charges=round(total_charges, 2),
        total_taxes=round(tax_report.total_tax, 2),
        benchmark_nifty50_cagr=round(n50_cagr, 6) if n50_cagr is not None else None,
        benchmark_nifty500_cagr=round(n500_cagr, 6) if n500_cagr is not None else None,
        benchmark_fd_cagr=round(fd_cagr, 6) if fd_cagr is not None else None,
        revealed_start_date=game.hidden_start_date,
        revealed_end_date=game.hidden_end_date,
    )
    db.merge(result)

    if settings.enable_algo_strategies:
        _run_algo_strategies(db, game)


def _run_algo_strategies(db: Session, game: Game) -> None:
    """Compute each algo strategy over the game window and persist results."""
    import json as _json
    import time as _time

    from dataclasses import asdict as _asdict

    for strat in STRATEGIES.values():
        t0 = _time.perf_counter()
        try:
            res = run_strategy(
                db,
                strat,
                game.hidden_start_date,
                game.hidden_end_date,
                game.starting_cash,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("algo %s failed for game %d: %s", strat.key, game.id, e)
            continue
        elapsed = _time.perf_counter() - t0

        curve_json = _json.dumps(
            [[d.isoformat(), round(n, 2)] for d, n in res.curve]
        )
        holdings_json = _json.dumps([_asdict(h) for h in res.holdings])
        rebalance_json = _json.dumps([_asdict(r) for r in res.rebalances])

        db.merge(
            AlgoRun(
                game_id=game.id,
                strategy_key=strat.key,
                final_nav=res.final_nav,
                cagr=res.cagr,
                max_drawdown=res.max_drawdown,
                total_charges=res.total_charges,
                nav_curve_json=curve_json,
                final_holdings_json=holdings_json,
                rebalance_log_json=rebalance_json,
            )
        )
        log.info(
            "algo %s: final_nav=%.0f cagr=%.3f (%.2fs)",
            strat.key, res.final_nav, res.cagr, elapsed,
        )
