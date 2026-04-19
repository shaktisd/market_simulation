"""Short-term Mean Reversion: buy the worst 1-month performers."""
from __future__ import annotations

from datetime import timedelta

from app.services.algos.base import RebalanceTarget, StrategyContext
from app.services.pricing import price_on_or_before

BOTTOM_N = 30
LOOKBACK_DAYS = 30


class MeanReversion:
    key = "mean_reversion"
    display_name = "Short-term Reversal"
    description = (
        "Buys the 30 worst-performing Nifty 500 stocks over the past month — "
        "a contrarian strategy betting on short-term mean reversion."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        past = ctx.as_of - timedelta(days=LOOKBACK_DAYS)
        scored: list[tuple[str, float]] = []
        for sym in ctx.universe:
            p_now = price_on_or_before(ctx.db, sym, ctx.as_of)
            p_past = price_on_or_before(ctx.db, sym, past)
            if p_now is None or p_past is None or p_past <= 0:
                continue
            ret = p_now / p_past - 1.0
            scored.append((sym, ret))
        scored.sort(key=lambda kv: kv[1])  # ascending — worst first
        picks = scored[:BOTTOM_N]
        if not picks:
            return []
        w = 1.0 / len(picks)
        return [RebalanceTarget(symbol=s, weight=w) for s, _ in picks]
