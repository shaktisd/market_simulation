"""Equal-weight "Nifty 50" proxy.

Since we don't ingest the historical Nifty 50 constituent list, we approximate
it with the top 50 Nifty 500 names by market cap as of the rebalance date.
Equal-weighted across those names.
"""
from __future__ import annotations

from app.models import StockFundamental
from app.services.algos.base import RebalanceTarget, StrategyContext

BASKET_N = 50


class EqualWeightN50:
    key = "equal_weight_n50"
    display_name = "Equal-weight Nifty 50"
    description = (
        "Equal-weighted across the 50 largest Nifty 500 stocks by market cap. "
        "A simple, diversified benchmark that avoids the cap-weight concentration "
        "of the real Nifty 50."
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
            basket = ctx.universe[:BASKET_N]
        if not basket:
            return []
        w = 1.0 / len(basket)
        return [RebalanceTarget(symbol=s, weight=w) for s in basket]
