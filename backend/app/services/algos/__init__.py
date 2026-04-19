"""Algorithmic trading strategies that compete against the user's portfolio.

Each strategy exposes a `select(ctx)` method returning target weights. The
`simulator.run_strategy` function walks the game window, liquidating and
rebuilding the basket on each rebalance date, and produces a NAV curve.
"""
from app.services.algos.base import (
    AlgoRunResult,
    RebalanceTarget,
    StrategyContext,
    TradeLog,
)
from app.services.algos.registry import STRATEGIES, seed_catalog
from app.services.algos.simulator import run_strategy

__all__ = [
    "AlgoRunResult",
    "RebalanceTarget",
    "STRATEGIES",
    "StrategyContext",
    "TradeLog",
    "run_strategy",
    "seed_catalog",
]
