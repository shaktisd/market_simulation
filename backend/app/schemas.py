from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


StepUnit = Literal["day", "week", "month"]
InstrumentType = Literal["stock", "mf"]
Side = Literal["BUY", "SELL"]


class StartGameRequest(BaseModel):
    step_unit: StepUnit = "month"


class GameStateResponse(BaseModel):
    game_id: int
    turn_index: int
    step_unit: StepUnit
    cash: float
    holdings_mv: float
    nav: float
    status: str
    ended: bool


class HoldingOut(BaseModel):
    instrument_type: InstrumentType
    symbol: str
    name: str
    quantity: float
    avg_cost: float
    last_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pct: float


class PortfolioResponse(BaseModel):
    cash: float
    holdings_mv: float
    nav: float
    holdings: list[HoldingOut]


class InstrumentInfo(BaseModel):
    symbol: str
    name: str
    sector: str | None = None
    # Nullable so list endpoints can stay fast and skip NAV lookups for
    # large universes (e.g., the full ~10k MF Direct-Growth catalog).
    last_price: float | None = None
    change_pct_1m: float | None = None
    change_pct_6m: float | None = None
    change_pct_12m: float | None = None


class NavHistoryPoint(BaseModel):
    turn: int
    nav: float
    cash: float
    holdings_mv: float


class NavHistoryResponse(BaseModel):
    starting_nav: float
    points: list[NavHistoryPoint]


class PricePoint(BaseModel):
    t: int  # relative turn-index from window end (0 = current)
    price: float


class PriceWindow(BaseModel):
    symbol: str
    name: str
    instrument_type: InstrumentType
    sector: str | None = None
    points: list[PricePoint]
    last_price: float
    fundamentals: dict[str, float | None] | None = None


class SectorRow(BaseModel):
    sector: str
    change_pct: float
    count: int


class BenchmarkSeries(BaseModel):
    name: str
    points: list[PricePoint]


OrderMode = Literal["qty", "weight", "value"]


class PlaceOrderRequest(BaseModel):
    """Three input modes:

    - mode="qty"    : value = number of shares/units (current behavior)
    - mode="weight" : value = % of current NAV to allocate (e.g. 5 for 5%)
    - mode="value"  : value = INR amount to allocate

    For BUY in weight/value modes, the quantity is auto-computed and capped at
    available cash (minus a small charges buffer). For stocks, qty is floored to
    a whole share.
    """
    instrument_type: InstrumentType
    symbol: str
    side: Side
    value: float = Field(gt=0)
    mode: OrderMode = "qty"


class ChargeBreakdown(BaseModel):
    brokerage: float
    stt: float
    exchange: float
    sebi: float
    stamp_duty: float
    gst: float
    dp_charges: float
    total: float


class OrderResponse(BaseModel):
    order_id: int
    price: float
    quantity: float
    gross: float
    charges: ChargeBreakdown
    net_cashflow: float
    cash_after: float


class CompositionSlice(BaseModel):
    label: str
    value: float
    weight: float  # 0..1


class CompositionResponse(BaseModel):
    nav: float
    by_asset_class: list[CompositionSlice]   # stock / mf / cash
    by_sector: list[CompositionSlice]        # sector + "Cash" bucket


class HoldingMover(BaseModel):
    instrument_type: InstrumentType
    symbol: str
    name: str
    quantity: float
    prev_price: float | None
    curr_price: float
    contribution: float           # qty * (curr - prev) — INR
    pct_change: float | None      # % change of price between snapshots


class TurnAnalyticsResponse(BaseModel):
    turn_index: int
    has_previous: bool
    nav_now: float
    nav_prev: float | None
    nav_delta: float
    nav_delta_pct: float | None
    holdings_delta: float          # change in holdings_mv (price effect + trades)
    cash_delta: float              # change in cash (mostly trade flows)
    net_invested_change: float     # buys − sells this turn (gross)
    top_gainers: list[HoldingMover]
    top_losers: list[HoldingMover]


class RiskMetricsResponse(BaseModel):
    """Live portfolio risk snapshot computed from TurnSnapshot history and
    current holdings. Any field may be null when there isn't enough history
    or data to compute it reliably."""

    volatility_ann: float | None       # annualized stdev of last 30 turn returns
    beta: float | None                 # portfolio beta vs NIFTY50 over played turns
    drawdown: float | None             # current drawdown from peak NAV (0..-1)
    hhi: float | None                  # Herfindahl index of holdings incl. cash (0..1)
    sharpe: float | None               # (annualized return - 0.07) / annualized vol
    turns_observed: int                # number of return observations backing the stats


class NextTurnResponse(BaseModel):
    game_id: int
    turn_index: int
    ended: bool
    cash: float
    holdings_mv: float
    nav: float


class GameResultResponse(BaseModel):
    game_id: int
    revealed_start_date: str
    revealed_end_date: str
    months_played: int
    final_nav: float
    cagr: float
    max_drawdown: float
    total_charges: float
    total_taxes: float
    benchmarks: dict[str, float | None]
    portfolio_curve: list[dict]  # [{date, nav}]
    benchmark_curves: dict[str, list[dict]]
    trade_log: list[dict]


class GameHistoryItem(BaseModel):
    game_id: int
    created_at: str
    revealed_start_date: str
    revealed_end_date: str
    final_nav: float
    cagr: float
    benchmark_nifty50_cagr: float | None


class AlgoHoldingOut(BaseModel):
    symbol: str
    name: str
    qty: float
    avg_cost: float
    last_price: float
    market_value: float
    weight: float


class AlgoRebalanceEntry(BaseModel):
    date: str
    trades: int
    charges: float
    symbols: list[str]


class AlgoStrategyResult(BaseModel):
    key: str
    display_name: str
    description: str
    final_nav: float
    cagr: float
    max_drawdown: float
    total_charges: float
    nav_curve: list[list]  # [[iso-date, nav], ...]
    final_holdings: list[AlgoHoldingOut]
    rebalance_log: list[AlgoRebalanceEntry]


class AlgoResultsResponse(BaseModel):
    game_id: int
    starting_nav: float
    strategies: list[AlgoStrategyResult]
