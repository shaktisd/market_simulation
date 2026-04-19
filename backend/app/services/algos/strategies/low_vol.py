"""Low Volatility: rank by trailing 126-day daily-return stdev, pick bottom 30."""
from __future__ import annotations

import math
from datetime import timedelta

from app.services.algos.base import RebalanceTarget, StrategyContext
from app.services.pricing import price_window

BOTTOM_N = 30
LOOKBACK_DAYS = 180


class LowVolatility:
    key = "low_vol"
    display_name = "Low Volatility"
    description = (
        "Buys the 30 Nifty 500 stocks with the lowest 6-month daily-return "
        "volatility — a defensive factor that targets stability over excitement."
    )

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]:
        scored: list[tuple[str, float]] = []
        for sym in ctx.universe:
            series = price_window(ctx.db, sym, ctx.as_of, lookback_days=LOOKBACK_DAYS)
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
            scored.append((sym, sd))
        scored.sort(key=lambda kv: kv[1])
        picks = scored[:BOTTOM_N]
        if not picks:
            return []
        w = 1.0 / len(picks)
        return [RebalanceTarget(symbol=s, weight=w) for s, _ in picks]
