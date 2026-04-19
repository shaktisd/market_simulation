"""Shared types and protocol for algo strategies."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Protocol

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class RebalanceTarget:
    symbol: str
    weight: float  # fraction of portfolio value; weights across a basket sum to 1.0


@dataclass
class StrategyContext:
    db: Session
    as_of: date
    universe: list[str]  # symbols tradable on this date (have a price)


@dataclass
class TradeLog:
    date: str
    symbol: str
    side: str
    quantity: float
    price: float
    gross: float
    charges: float


@dataclass
class RebalanceEntry:
    date: str
    trades: int
    charges: float
    symbols: list[str]


@dataclass
class AlgoHoldingSnapshot:
    symbol: str
    qty: float
    avg_cost: float
    last_price: float
    market_value: float
    weight: float


@dataclass
class AlgoRunResult:
    final_nav: float
    cagr: float
    max_drawdown: float
    total_charges: float
    curve: list[tuple[date, float]]
    holdings: list[AlgoHoldingSnapshot]
    rebalances: list[RebalanceEntry] = field(default_factory=list)


@dataclass
class AlgoRunInFlight:
    """Mutable per-strategy state persisted between turns."""
    cash: float
    total_charges: float = 0.0
    last_processed_date: date | None = None
    last_rebalance_date: date | None = None
    holdings: dict[str, float] = field(default_factory=dict)
    avg_costs: dict[str, float] = field(default_factory=dict)
    curve: list[tuple[date, float]] = field(default_factory=list)
    rebalances: list[RebalanceEntry] = field(default_factory=list)


class Strategy(Protocol):
    key: str
    display_name: str
    description: str

    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]: ...
