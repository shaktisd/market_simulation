"""Capital-gains tax computation applied once at game end.

Rules (simulation approximation, Indian equity):
  - STCG (holding ≤ 1 year): 15% on realized gains
  - LTCG (holding > 1 year): 10% on realized gains above ₹1,00,000 exemption/year

Unrealized gains on holdings at game end are treated as if liquidated on the
final turn (so the "final NAV" reflects post-tax wealth).

For mutual funds we use the same equity rates — a coarse approximation. A
production implementation would branch on equity-vs-debt scheme category.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.models import Game, Holding, Order
from app.services.pricing import mf_nav_on_or_before, price_on_or_before

STCG_RATE = 0.15
LTCG_RATE = 0.10
LTCG_EXEMPTION_PER_YEAR = 1_00_000.0


@dataclass
class TaxReport:
    stcg_gains: float
    ltcg_gains: float
    total_tax: float
    detail: list[dict]


def _is_long_term(buy_dt: date, sell_dt: date) -> bool:
    return (sell_dt - buy_dt).days > 365


def compute_game_end_taxes(db: Session, game: Game) -> TaxReport:
    """Compute total capital-gains tax for the entire game.

    Walks actual realized trades FIFO-style using stored orders, then marks
    remaining holdings to market at the game's end date as a final liquidation.
    """
    orders = (
        db.query(Order)
        .filter(Order.game_id == game.id)
        .order_by(Order.executed_hidden_date.asc(), Order.id.asc())
        .all()
    )

    # FIFO lots per (instrument_type, symbol)
    lots: dict[tuple[str, str], list[list]] = defaultdict(list)
    stcg = 0.0
    ltcg = 0.0
    detail: list[dict] = []

    for o in orders:
        key = (o.instrument_type, o.symbol)
        if o.side == "BUY":
            # store as [qty, cost_per_unit including buy charges allocated, buy_date]
            cost_per_unit = (o.gross + o.charges) / o.quantity if o.quantity else 0.0
            lots[key].append([o.quantity, cost_per_unit, o.executed_hidden_date])
        else:
            qty_remaining = o.quantity
            sell_price_net = (o.gross - o.charges) / o.quantity if o.quantity else 0.0
            while qty_remaining > 1e-9 and lots[key]:
                lot = lots[key][0]
                take = min(lot[0], qty_remaining)
                gain = (sell_price_net - lot[1]) * take
                if _is_long_term(lot[2], o.executed_hidden_date):
                    ltcg += gain
                else:
                    stcg += gain
                detail.append({
                    "symbol": o.symbol,
                    "qty": round(take, 6),
                    "gain": round(gain, 2),
                    "term": "LTCG" if _is_long_term(lot[2], o.executed_hidden_date) else "STCG",
                })
                lot[0] -= take
                qty_remaining -= take
                if lot[0] <= 1e-9:
                    lots[key].pop(0)

    # Mark-to-market remaining holdings at game end
    end = game.current_date
    for h in db.query(Holding).filter(Holding.game_id == game.id).all():
        if h.quantity <= 0:
            continue
        if h.instrument_type == "stock":
            last = price_on_or_before(db, h.symbol, end)
        else:
            last = mf_nav_on_or_before(db, int(h.symbol), end)
        if last is None:
            continue
        # Use first_buy_date for term test; if missing, assume short-term
        buy_dt = h.first_buy_date or end
        gain = (last - h.avg_cost) * h.quantity
        if _is_long_term(buy_dt, end):
            ltcg += gain
        else:
            stcg += gain
        detail.append({
            "symbol": h.symbol,
            "qty": round(h.quantity, 6),
            "gain": round(gain, 2),
            "term": "LTCG(MTM)" if _is_long_term(buy_dt, end) else "STCG(MTM)",
        })

    taxable_stcg = max(0.0, stcg)
    taxable_ltcg = max(0.0, ltcg - LTCG_EXEMPTION_PER_YEAR)
    total_tax = taxable_stcg * STCG_RATE + taxable_ltcg * LTCG_RATE

    return TaxReport(
        stcg_gains=round(stcg, 2),
        ltcg_gains=round(ltcg, 2),
        total_tax=round(total_tax, 2),
        detail=detail,
    )


def orders_charges_breakdown_json(charges_dict: dict[str, float]) -> str:
    return json.dumps(charges_dict)
