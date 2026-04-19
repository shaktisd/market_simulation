"""Risk Parity: top 50 by market cap, weighted by inverse volatility."""
from __future__ import annotations

import math
from datetime import timedelta

from app.models import StockFundamental
from app.services.algos.base import RebalanceTarget, StrategyContext
from app.services.pricing import price_window

BASKET_N = 50
VOL_LOOKBACK_DAYS = 180


class RiskParity:
    key = "risk_parity"
    display_name = "Risk Parity"
    description = (
        "Holds the top 50 Nifty 500 names by market cap, weighted inversely "
        "to their 6-month volatility — each position contributes roughly the "
        "same amount of portfolio risk."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        # Fundamentals are a current snapshot; see value.py.
        rows = (
            ctx.db.query(StockFundamental)
            .filter(StockFundamental.symbol.in_(ctx.universe))
            .all()
        )
        latest: dict[str, StockFundamental] = {}
        for r in rows:
            prev = latest.get(r.symbol)
            if prev is None or r.date > prev.date:
                latest[r.symbol] = r

        by_mcap: list[tuple[str, float]] = [
            (sym, row.market_cap) for sym, row in latest.items()
            if row.market_cap is not None and row.market_cap > 0
        ]
        by_mcap.sort(key=lambda kv: kv[1], reverse=True)
        basket = [sym for sym, _ in by_mcap[:BASKET_N]]
        if not basket:
            # Fallback: equal-weight whatever we have
            basket = ctx.universe[:BASKET_N]
            if not basket:
                return []
            w = 1.0 / len(basket)
            return [RebalanceTarget(symbol=s, weight=w) for s in basket]

        inv_vols: list[tuple[str, float]] = []
        for sym in basket:
            series = price_window(ctx.db, sym, ctx.as_of, lookback_days=VOL_LOOKBACK_DAYS)
            if len(series) < 30:
                continue
            rets: list[float] = []
            for i in range(1, len(series)):
                p0 = series[i - 1][1]
                p1 = series[i][1]
                if p0 > 0:
                    rets.append(p1 / p0 - 1.0)
            if len(rets) < 20:
                continue
            mean = sum(rets) / len(rets)
            var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
            sd = math.sqrt(var)
            if sd <= 0:
                continue
            inv_vols.append((sym, 1.0 / sd))

        if not inv_vols:
            w = 1.0 / len(basket)
            return [RebalanceTarget(symbol=s, weight=w) for s in basket]

        total = sum(v for _, v in inv_vols)
        return [RebalanceTarget(symbol=s, weight=v / total) for s, v in inv_vols]
