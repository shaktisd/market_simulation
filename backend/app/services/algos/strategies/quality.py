"""Quality: pick 30 stocks by high ROE. Falls back to high earnings yield
(low P/E) when ROE is unavailable for most of the universe."""
from __future__ import annotations

from app.models import StockFundamental
from app.services.algos.base import RebalanceTarget, StrategyContext

TOP_N = 30


class Quality:
    key = "quality"
    display_name = "High-ROE Quality"
    description = (
        "Buys the 30 Nifty 500 stocks with the highest Return on Equity — "
        "quality factor favoring efficient, profitable businesses. Falls back "
        "to earnings yield if ROE is unavailable for most names."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        # See note in value.py — fundamentals are a current snapshot.
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

        by_roe: list[tuple[str, float]] = [
            (sym, row.roe) for sym, row in latest.items()
            if row.roe is not None and row.roe > 0
        ]
        # If we have ROE on at least a third of the universe, use it
        if len(by_roe) >= max(TOP_N, len(latest) // 3):
            by_roe.sort(key=lambda kv: kv[1], reverse=True)
            picks = by_roe[:TOP_N]
        else:
            # Fallback: earnings yield (1/PE) — profitable, reasonable P/E
            ey: list[tuple[str, float]] = [
                (sym, 1.0 / row.pe)
                for sym, row in latest.items()
                if row.pe is not None and row.pe > 0
            ]
            ey.sort(key=lambda kv: kv[1], reverse=True)
            picks = ey[:TOP_N]

        if not picks:
            return []
        w = 1.0 / len(picks)
        return [RebalanceTarget(symbol=s, weight=w) for s, _ in picks]
