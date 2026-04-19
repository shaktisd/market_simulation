"""Momentum 12-1: rank by trailing 252-day return excluding last 21 days."""
from __future__ import annotations

from datetime import timedelta

from app.services.algos.base import RebalanceTarget, StrategyContext
from app.services.pricing import price_on_or_before

TOP_N = 30
LOOKBACK_DAYS = 365
SKIP_DAYS = 31


class Momentum:
    key = "momentum"
    display_name = "Momentum 12-1"
    description = (
        "Buys the 30 Nifty 500 stocks with the strongest trailing 12-month return "
        "excluding the most recent month (classic 12-1 momentum factor)."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        recent = ctx.as_of - timedelta(days=SKIP_DAYS)
        far = ctx.as_of - timedelta(days=LOOKBACK_DAYS)
        scored: list[tuple[str, float]] = []
        for sym in ctx.universe:
            p_recent = price_on_or_before(ctx.db, sym, recent)
            p_far = price_on_or_before(ctx.db, sym, far)
            if p_recent is None or p_far is None or p_far <= 0:
                continue
            ret = p_recent / p_far - 1.0
            scored.append((sym, ret))
        scored.sort(key=lambda kv: kv[1], reverse=True)
        picks = scored[:TOP_N]
        if not picks:
            return []
        w = 1.0 / len(picks)
        return [RebalanceTarget(symbol=s, weight=w) for s, _ in picks]
