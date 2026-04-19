"""Value: rank by inverse P/E (earnings yield). Top 30 lowest positive P/E."""
from __future__ import annotations

from app.models import StockFundamental
from app.services.algos.base import RebalanceTarget, StrategyContext

TOP_N = 30


class Value:
    key = "value"
    display_name = "Low P/E Value"
    description = (
        "Buys the 30 Nifty 500 stocks with the lowest positive trailing P/E "
        "— classic value factor. Note: fundamentals are a current snapshot, "
        "not strictly point-in-time."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        # Fundamentals are stored as a single current snapshot, not a historical
        # series — we intentionally use the latest-available row for every
        # rebalance date and document the resulting look-ahead bias.
        rows = (
            ctx.db.query(StockFundamental)
            .filter(StockFundamental.symbol.in_(ctx.universe))
            .all()
        )
        # keep latest row per symbol
        latest: dict[str, StockFundamental] = {}
        for r in rows:
            prev = latest.get(r.symbol)
            if prev is None or r.date > prev.date:
                latest[r.symbol] = r

        scored: list[tuple[str, float]] = []
        for sym, row in latest.items():
            if row.pe is None or row.pe <= 0:
                continue
            scored.append((sym, row.pe))
        scored.sort(key=lambda kv: kv[1])
        picks = scored[:TOP_N]
        if not picks:
            return []
        w = 1.0 / len(picks)
        return [RebalanceTarget(symbol=s, weight=w) for s, _ in picks]
