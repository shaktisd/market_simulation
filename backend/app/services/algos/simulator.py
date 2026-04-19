"""Walk a strategy across a date range, producing NAV curve + final holdings.

The simulator mirrors the user's trading mechanics: each rebalance liquidates
the current basket and buys the new one at quoted prices, paying the same
STT/GST/brokerage/DP charges a real trader would pay via `services.charges`.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.services.algos.base import (
    AlgoHoldingSnapshot,
    AlgoRunInFlight,
    AlgoRunResult,
    RebalanceEntry,
    Strategy,
    StrategyContext,
)
from app.services.algos.universe import nifty500_symbols, tradable_on
from app.services.benchmarks import cagr, max_drawdown
from app.services.charges import charges_for
from app.services.pricing import price_on_or_before

log = logging.getLogger(__name__)

CHARGE_BUFFER = 1.005  # small cushion so BUY legs don't overshoot cash after charges


def _rebalance_dates(start: date, end: date, every_days: int) -> list[date]:
    out: list[date] = []
    d = start
    while d < end:
        out.append(d)
        d = d + timedelta(days=every_days)
    return out


def _value_holdings(
    db: Session, holdings: dict[str, float], on: date
) -> tuple[float, dict[str, float]]:
    mv = 0.0
    prices: dict[str, float] = {}
    for sym, qty in holdings.items():
        if qty <= 0:
            continue
        p = price_on_or_before(db, sym, on)
        if p is None:
            continue
        prices[sym] = p
        mv += qty * p
    return mv, prices


def _liquidate(
    db: Session,
    holdings: dict[str, float],
    cash: float,
    on: date,
) -> tuple[float, float, int]:
    """Sell all positions at on-or-before prices. Returns (new_cash, charges, trades)."""
    charges_total = 0.0
    trades = 0
    for sym, qty in list(holdings.items()):
        if qty <= 0:
            continue
        p = price_on_or_before(db, sym, on)
        if p is None:
            # No price — keep the position; it'll be revalued next rebalance
            continue
        gross = p * qty
        c = charges_for("stock", gross, "SELL").total
        cash += gross - c
        charges_total += c
        trades += 1
        holdings.pop(sym, None)
    return cash, charges_total, trades


def _allocate(
    db: Session,
    targets: list,  # list[RebalanceTarget]
    cash: float,
    on: date,
    holdings: dict[str, float],
    avg_costs: dict[str, float],
) -> tuple[float, float, int]:
    """Buy the target basket. Weights are interpreted as fractions of the
    currently-available cash (after liquidation). Returns (cash_after, charges, trades).
    """
    charges_total = 0.0
    trades = 0
    budget_total = cash / CHARGE_BUFFER
    for t in targets:
        p = price_on_or_before(db, t.symbol, on)
        if p is None or p <= 0:
            continue
        budget = budget_total * t.weight
        qty = float(int(budget / p))  # whole shares
        if qty <= 0:
            continue
        gross = p * qty
        c = charges_for("stock", gross, "BUY").total
        total_out = gross + c
        if total_out > cash:
            # Not enough cash for this leg — skip it
            continue
        cash -= total_out
        charges_total += c
        trades += 1
        prev_qty = holdings.get(t.symbol, 0.0)
        prev_cost = avg_costs.get(t.symbol, 0.0) * prev_qty
        new_qty = prev_qty + qty
        holdings[t.symbol] = new_qty
        avg_costs[t.symbol] = (prev_cost + gross + c) / new_qty
    return cash, charges_total, trades


def init_run_state(starting_cash: float) -> AlgoRunInFlight:
    return AlgoRunInFlight(cash=float(starting_cash))


def _next_rebalance_date(
    last_rebal: date | None, first_rebal: date, every_days: int, up_to: date
) -> date | None:
    """Next rebalance date strictly after last_rebal, <= up_to."""
    if last_rebal is None:
        return first_rebal if first_rebal <= up_to else None
    nxt = last_rebal + timedelta(days=every_days)
    return nxt if nxt <= up_to else None


def advance_run_state(
    db: Session,
    strategy: Strategy,
    state: AlgoRunInFlight,
    as_of: date,
    starting_cash: float,
    first_rebalance_date: date,
    rebalance_days: int = 90,
) -> None:
    """Bring state up to `as_of`. Idempotent."""
    if state.last_processed_date is not None and state.last_processed_date >= as_of:
        return

    universe_full = nifty500_symbols(db)

    # Run any rebalances scheduled in (last_rebalance_date, as_of]
    while True:
        rd = _next_rebalance_date(
            state.last_rebalance_date, first_rebalance_date, rebalance_days, as_of
        )
        if rd is None:
            break

        cash, c_sell, t_sell = _liquidate(db, state.holdings, state.cash, rd)
        state.cash = cash
        state.total_charges += c_sell

        universe = tradable_on(db, rd, universe_full)
        ctx = StrategyContext(db=db, as_of=rd, universe=universe)
        try:
            targets = strategy.select(ctx)
        except Exception as e:  # noqa: BLE001
            log.warning("strategy %s failed on %s: %s", strategy.key, rd, e)
            targets = []

        cash, c_buy, t_buy = _allocate(
            db, targets, state.cash, rd, state.holdings, state.avg_costs
        )
        state.cash = cash
        state.total_charges += c_buy

        state.rebalances.append(
            RebalanceEntry(
                date=rd.isoformat(),
                trades=t_sell + t_buy,
                charges=round(c_sell + c_buy, 2),
                symbols=[t.symbol for t in targets],
            )
        )
        state.last_rebalance_date = rd

    # Value at as_of and append curve point
    if state.last_rebalance_date is None:
        nav = starting_cash
    else:
        mv, _ = _value_holdings(db, state.holdings, as_of)
        nav = state.cash + mv
    state.curve.append((as_of, nav))
    state.last_processed_date = as_of


def finalize_run_state(
    db: Session,
    state: AlgoRunInFlight,
    starting_cash: float,
    start: date,
    end: date,
) -> AlgoRunResult:
    mv_end, prices_end = _value_holdings(db, state.holdings, end)
    final_nav = state.cash + mv_end if state.last_rebalance_date else starting_cash

    snapshots: list[AlgoHoldingSnapshot] = []
    for sym, qty in state.holdings.items():
        if qty <= 0:
            continue
        p = prices_end.get(sym, 0.0)
        mv = p * qty
        weight = mv / final_nav if final_nav > 0 else 0.0
        snapshots.append(
            AlgoHoldingSnapshot(
                symbol=sym,
                qty=qty,
                avg_cost=state.avg_costs.get(sym, 0.0),
                last_price=p,
                market_value=mv,
                weight=weight,
            )
        )
    snapshots.sort(key=lambda s: s.market_value, reverse=True)

    days = max(1, (end - start).days)
    port_cagr = cagr(starting_cash, final_nav, days)
    mdd = max_drawdown([n for _, n in state.curve])

    return AlgoRunResult(
        final_nav=round(final_nav, 2),
        cagr=round(port_cagr, 6),
        max_drawdown=round(mdd, 6),
        total_charges=round(state.total_charges, 2),
        curve=list(state.curve),
        holdings=snapshots,
        rebalances=list(state.rebalances),
    )


def run_strategy(
    db: Session,
    strategy: Strategy,
    start: date,
    end: date,
    starting_cash: float,
    rebalance_days: int = 90,
    sample_cadence_days: int = 7,
) -> AlgoRunResult:
    cash = float(starting_cash)
    holdings: dict[str, float] = {}
    avg_costs: dict[str, float] = {}
    total_charges = 0.0
    rebalances: list[RebalanceEntry] = []

    universe_full = nifty500_symbols(db)
    rebal_dates = _rebalance_dates(start, end, rebalance_days)

    for rd in rebal_dates:
        # Liquidate current basket
        cash, c_sell, t_sell = _liquidate(db, holdings, cash, rd)
        total_charges += c_sell

        # Pick new basket
        universe = tradable_on(db, rd, universe_full)
        ctx = StrategyContext(db=db, as_of=rd, universe=universe)
        try:
            targets = strategy.select(ctx)
        except Exception as e:  # noqa: BLE001
            log.warning("strategy %s failed on %s: %s", strategy.key, rd, e)
            targets = []

        cash, c_buy, t_buy = _allocate(db, targets, cash, rd, holdings, avg_costs)
        total_charges += c_buy

        rebalances.append(
            RebalanceEntry(
                date=rd.isoformat(),
                trades=t_sell + t_buy,
                charges=round(c_sell + c_buy, 2),
                symbols=[t.symbol for t in targets],
            )
        )

    # Sample NAV curve from `start` to `end` at the chosen cadence
    curve: list[tuple[date, float]] = []
    d = start
    one_step = timedelta(days=sample_cadence_days)
    while d <= end:
        mv, _ = _value_holdings(db, holdings, d)
        # For dates before the first rebalance, the basket is empty — nav = starting_cash
        # For dates after the last rebalance, mv uses on-or-before prices (no forward peek).
        nav = cash + mv if d >= rebal_dates[0] else starting_cash if rebal_dates else starting_cash
        curve.append((d, nav))
        d = d + one_step
    # Ensure the final NAV is recorded at the actual end date
    mv_end, prices_end = _value_holdings(db, holdings, end)
    final_nav = cash + mv_end
    if not curve or curve[-1][0] != end:
        curve.append((end, final_nav))
    else:
        curve[-1] = (end, final_nav)

    # Build holdings snapshot
    snapshots: list[AlgoHoldingSnapshot] = []
    for sym, qty in holdings.items():
        if qty <= 0:
            continue
        p = prices_end.get(sym, 0.0)
        mv = p * qty
        weight = mv / final_nav if final_nav > 0 else 0.0
        snapshots.append(
            AlgoHoldingSnapshot(
                symbol=sym,
                qty=qty,
                avg_cost=avg_costs.get(sym, 0.0),
                last_price=p,
                market_value=mv,
                weight=weight,
            )
        )
    snapshots.sort(key=lambda s: s.market_value, reverse=True)

    days = max(1, (end - start).days)
    port_cagr = cagr(starting_cash, final_nav, days)
    mdd = max_drawdown([n for _, n in curve])

    return AlgoRunResult(
        final_nav=round(final_nav, 2),
        cagr=round(port_cagr, 6),
        max_drawdown=round(mdd, 6),
        total_charges=round(total_charges, 2),
        curve=curve,
        holdings=snapshots,
        rebalances=rebalances,
    )
