# Hedge-Fund Algo Strategies — Implementation & Execution Plan

Compete the user's portfolio against seven pre-defined, factor-based trading strategies.
Results are revealed only when the game ends, alongside the existing passive benchmarks
(Nifty 50, Nifty 500, FD). Each algo starts with the same ₹1 crore, trades only
Nifty 500 stocks, pays the same charges the user pays, and rebalances quarterly.

---

## 1. Confirmed Requirements

| # | Decision | Source |
|---|----------|--------|
| 1 | Seven strategies: Momentum (12-1), Value (low P/E), Low Volatility (6m stdev), Quality (high ROE), Risk Parity (inverse-vol), Mean Reversion (worst 1m), Equal-weight Nifty 50 | User |
| 2 | Quarterly rebalance (every 63 trading days from game-start) | User |
| 3 | ₹1,00,00,000 starting capital per algo; universe = Nifty 500 only | User |
| 4 | Results page, **new "Algo Strategies" tab** with per-strategy holdings + metrics | User |
| 5 | Apply real charges (STT/GST/brokerage via `services/charges.py`). Use yfinance fundamentals for Value/Quality where available | User |
| 6 | Compute on demand at `_finalize`, cache results in `GameResult` JSON fields | User |

---

## 2. Strategy Specifications

All strategies:
- Draw from the Nifty 500 constituent list (`docs/ind_nifty500list.csv`).
- Start with `settings.starting_cash` (₹1 crore) in cash.
- Rebalance on day 0 of the game, then every **90 calendar days** until `hidden_end_date`.
- On each rebalance: sell everything → select new basket → buy equal-weight unless stated.
- Pay full `charges_for("stock", gross, side)` on each buy and sell.
- Floor share quantities to whole numbers; any residual stays in cash.
- Skip any symbol that has no price on the rebalance date (fewer than **N** signals degrade gracefully — fall back to equal-weight on survivors).

| ID | Name | Selection Logic | Weighting |
|----|------|-----------------|-----------|
| `momentum` | Momentum 12-1 | Rank by trailing 252-day return **excluding** last 21 days; pick top 30 | Equal |
| `value` | Low P/E Value | Rank by inverse P/E (discard non-positive P/E); pick top 30 | Equal |
| `low_vol` | Low Volatility | Rank by 126-day daily-return stdev (ascending); pick bottom 30 | Equal |
| `quality` | High ROE Quality | Rank by ROE (requires fundamentals); pick top 30 | Equal |
| `risk_parity` | Risk Parity | Top 50 by market cap → inverse-vol weight (1/σ, normalized) | Inverse-vol |
| `mean_reversion` | Short-term Reversal | Rank by trailing 21-day return (ascending); pick worst 30 | Equal |
| `equal_weight_n50` | Equal-weight Nifty 50 | All 50 Nifty 50 constituents | Equal |

**Data caveats (document in code + UI):**
- `StockFundamental` table currently stores P/E, P/B, EPS, market cap — **no ROE column**.
  → Add ROE ingestion (yfinance `info["returnOnEquity"]`) OR approximate via `EPS × shares / book_value`. **Action:** extend `StockFundamental` with `roe` column.
- Fundamentals are point-in-time-today, not historical. Document as a known limitation in the UI ("fundamentals snapshot; does not reflect values on the rebalance date").
- Market cap for Risk Parity: use today's snapshot from `StockFundamental.market_cap`.

---

## 3. Data & Schema Changes

### 3.1 Schema (SQLAlchemy / Alembic-style migration)

**New table `algo_strategy`** (static catalog):
```python
class AlgoStrategy(Base):
    __tablename__ = "algo_strategies"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)  # "momentum", ...
    display_name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text)
```
Seeded in a new ingest step (or at app startup if empty).

**New table `algo_run`** (per-game, per-strategy cached result):
```python
class AlgoRun(Base):
    __tablename__ = "algo_runs"
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), primary_key=True)
    strategy_key: Mapped[str] = mapped_column(ForeignKey("algo_strategies.key"), primary_key=True)
    final_nav: Mapped[float] = mapped_column(Float)
    cagr: Mapped[float] = mapped_column(Float)
    max_drawdown: Mapped[float] = mapped_column(Float)
    total_charges: Mapped[float] = mapped_column(Float)
    nav_curve_json: Mapped[str] = mapped_column(Text)        # [[iso-date, nav], ...]
    final_holdings_json: Mapped[str] = mapped_column(Text)   # [{symbol, qty, avg_cost, weight}, ...]
    rebalance_log_json: Mapped[str] = mapped_column(Text)    # [{date, trades:[...], charges}, ...]
```

Rationale: keeping curves/holdings as JSON blobs matches the "compute-on-demand, cache-forever" flow and avoids exploding the row count.

**Extend `StockFundamental`**:
```python
roe: Mapped[float | None] = mapped_column(Float, nullable=True)
```
Add to the ingest script that populates fundamentals.

### 3.2 Ingest additions

- Extend `app/ingest/fetch_stocks.py` (or wherever fundamentals are loaded) to pull `returnOnEquity` from yfinance `Ticker.info` and store in `StockFundamental.roe`.
- Add `app/ingest/seed_algo_strategies.py` to upsert the 7 rows of `algo_strategy` catalog.

---

## 4. Backend Architecture

### 4.1 New module layout

```
backend/app/services/algos/
├── __init__.py
├── base.py           # AlgoStrategy protocol, shared helpers
├── universe.py       # load Nifty 500 / Nifty 50, filter survivorship
├── simulator.py      # run a strategy across game window, returning curve+holdings
├── charges_wrapper.py# thin wrapper over services.charges for non-DB buy/sell sim
└── strategies/
    ├── __init__.py
    ├── momentum.py
    ├── value.py
    ├── low_vol.py
    ├── quality.py
    ├── risk_parity.py
    ├── mean_reversion.py
    └── equal_weight_n50.py
```

### 4.2 `base.py` — interface

```python
class StrategyContext(TypedDict):
    db: Session
    as_of: date
    universe: list[str]         # allowed symbols on this date

class RebalanceTarget(TypedDict):
    symbol: str
    weight: float               # sums to 1.0 across the basket

class AlgoStrategy(Protocol):
    key: str
    display_name: str
    def select(self, ctx: StrategyContext) -> list[RebalanceTarget]: ...
```

Each strategy is a small class/callable that returns target weights on a given date.
Strategies are registered in a dict `STRATEGIES: dict[str, AlgoStrategy]`.

### 4.3 `simulator.py` — the core simulation loop

```python
def run_strategy(
    db: Session,
    strategy: AlgoStrategy,
    start: date,
    end: date,
    starting_cash: float,
    rebalance_days: int = 90,
    sample_cadence_days: int = 7,
) -> AlgoRunResult:
    """
    Returns: nav_curve, final_holdings, rebalance_log, total_charges, cagr, mdd.
    """
```

Algorithm:
1. Initialize `cash = starting_cash`, `holdings: dict[symbol, qty] = {}`.
2. Build a list of rebalance dates: `[start, start+90d, start+180d, ...]` ≤ `end`.
3. For each rebalance date:
   - Price every current holding using `pricing.price_on_or_before`.
   - **Liquidate**: compute gross, pay charges via `charges_for("stock", gross, "SELL")`, add net proceeds to `cash`. Log each trade.
   - **Build new basket**: call `strategy.select(ctx)` with universe = Nifty 500 constituents having prices on that date. If the basket is empty, stay in cash until next rebalance.
   - **Allocate**: per target, `budget = cash * weight * (1 / CHARGE_BUFFER)`. Qty = floor(budget / price). Pay `charges_for("stock", qty*price, "BUY")`. Subtract from cash. Log trade.
4. **Sample the NAV curve** every 7 days (match existing `benchmark_curve_fd` cadence) using `pricing.price_on_or_before` for each holding.
5. At `end`, emit final NAV (with holdings valued at `end` prices, no final liquidation tax — mirror how user's `final_nav` is computed minus taxes; for simplicity **skip tax on algos** and document it, since LTCG rules depend on per-lot holding period which is expensive to simulate accurately).
6. Return curve, holdings snapshot, rebalance log, aggregates.

### 4.4 `engine._finalize` integration

After the existing benchmark block, run:

```python
algo_runs: list[AlgoRun] = []
for strat in STRATEGIES.values():
    res = run_strategy(
        db, strat,
        game.hidden_start_date, game.hidden_end_date,
        game.starting_cash,
    )
    algo_runs.append(AlgoRun(
        game_id=game.id,
        strategy_key=strat.key,
        final_nav=res.final_nav,
        cagr=res.cagr,
        max_drawdown=res.mdd,
        total_charges=res.total_charges,
        nav_curve_json=json.dumps([[d.isoformat(), n] for d, n in res.curve]),
        final_holdings_json=json.dumps(res.holdings),
        rebalance_log_json=json.dumps(res.rebalance_log),
    ))
for r in algo_runs:
    db.merge(r)
```

Performance budget: 7 strategies × ~12 quarterly rebalances × ~30 symbols × a point-in-time price lookup is ~2,500 price reads per game-end, all cached DB queries. Should complete in < 3s. If it exceeds 5s, add a background-task path (FastAPI `BackgroundTasks`).

### 4.5 New API endpoint

`GET /api/game/{id}/algo-results` → returns:
```json
{
  "strategies": [
    {
      "key": "momentum",
      "display_name": "Momentum 12-1",
      "description": "...",
      "final_nav": 12345678.9,
      "cagr": 0.1423,
      "max_drawdown": -0.187,
      "total_charges": 45678.0,
      "nav_curve": [["2019-03-15", 10000000.0], ...],
      "final_holdings": [
        {"symbol": "TCS", "qty": 120, "avg_cost": 3421.5, "weight": 0.034},
        ...
      ],
      "rebalance_log": [
        {"date": "2019-03-15", "trades": 30, "charges": 4123.7},
        ...
      ]
    },
    ...
  ]
}
```

The existing `/result` endpoint stays unchanged (backwards compatible). Frontend calls both.

---

## 5. Frontend

### 5.1 New tab on Results page

Refactor `frontend/src/pages/Results.tsx` into a tabbed layout (use Tailwind-styled tabs; no new dep needed):

```
┌──────────────────────────────────────────┐
│ [Overview] [Algo Strategies]             │
├──────────────────────────────────────────┤
│ ...                                      │
└──────────────────────────────────────────┘
```

- **Overview tab** (existing): user curve + Nifty 50 + Nifty 500 + FD. Unchanged.
- **Algo Strategies tab** (new):
  - Top: combined chart — user NAV + 7 algo curves (toggleable via checkboxes in a legend). Reuse `NavCurve` with a `series` prop extension.
  - Middle: sortable metrics table — columns: Strategy, Final NAV, CAGR, Max DD, Total Charges, ▲/▼ vs user.
  - Bottom: expandable row per strategy → final holdings table (symbol, qty, weight %, price-at-end) + rebalance log (date, # trades, charges).

### 5.2 API client

`frontend/src/lib/api.ts` — add `getAlgoResults(gameId: number)` → typed response.

### 5.3 Types

Add to `frontend/src/lib/types.ts`:
```ts
export type AlgoCurvePoint = [string, number];
export interface AlgoHolding { symbol: string; qty: number; avg_cost: number; weight: number; }
export interface AlgoStrategyResult { key: string; display_name: string; description: string;
  final_nav: number; cagr: number; max_drawdown: number; total_charges: number;
  nav_curve: AlgoCurvePoint[]; final_holdings: AlgoHolding[]; rebalance_log: ...; }
```

---

## 6. Execution Plan

Work breakdown, ordered:

1. **Schema & ingest** (≈ half day)
   - Add `AlgoStrategy`, `AlgoRun` models; migration.
   - Add `roe` column to `StockFundamental`; update ingest to populate it.
   - Seed algo catalog at app startup.
2. **Strategy selectors** (≈ 1 day)
   - Implement each of the 7 `select()` functions with its own unit test (seed a fixture DB, assert top-k picks).
3. **Simulator** (≈ 1 day)
   - Implement `run_strategy` end-to-end.
   - Unit test on a 2-year window with a stubbed 3-symbol universe; assert NAV monotonicity, charges > 0, final holdings match last target.
4. **Engine integration** (≈ 2 hours)
   - Call simulator from `_finalize`; persist to `algo_runs`.
   - Feature flag: `settings.enable_algo_strategies` (default True, but allow disabling in dev).
5. **API endpoint** (≈ 2 hours)
   - `GET /api/game/{id}/algo-results`; hide behind a check for `game.status == "ended"`.
6. **Frontend tabs + chart + tables** (≈ 1 day)
   - Refactor `Results.tsx`, add `AlgoStrategiesTab.tsx`, extend `NavCurve` for N-series.
7. **Manual QA** (≈ 2 hours)
   - Play a full game; confirm algo tab renders; verify NAV curves look sensible vs Nifty 50 for a known-good period (e.g., 2014–2019 should show momentum > value).
   - Verify performance: `_finalize` completes in < 5s.

Total estimate: ~4 working days.

---

## 7. Testing Plan

**Backend unit tests** (pytest):
- `test_strategies_momentum.py`: with synthetic 5-stock price series where one stock rises 100% and others flat, momentum picks that stock.
- `test_strategies_low_vol.py`: with synthetic series, low_vol picks the flat one.
- `test_simulator_charges_applied.py`: run 1-year simulation; assert `total_charges > 0` and that `final_nav + total_charges ≈ gross_return`.
- `test_simulator_no_universe.py`: universe empty on rebalance → strategy stays in cash; nav_curve is flat.
- `test_simulator_whole_shares.py`: fractional budgets round down; leftover cash reflected in NAV.

**Integration test:**
- Start a game with a fixed seed, advance to end, assert `algo_runs` has 7 rows and each row's `final_nav` is within plausible bounds (±80% of starting_cash).

**Frontend smoke:**
- Component test for `AlgoStrategiesTab` renders 7 legend checkboxes given mocked data.

---

## 8. Rollout & Risks

**Risks & mitigations:**

| Risk | Impact | Mitigation |
|------|--------|------------|
| Fundamentals snapshot is not point-in-time | Value/Quality rankings are look-ahead biased | Document clearly in UI tooltip; long-term: ingest historical fundamentals |
| `_finalize` latency grows with game length | User waits on click-Next | Hard cap simulation at 5s; if exceeded, move to `BackgroundTasks` + polling |
| Nifty 500 constituents change over time | Survivorship bias (only current constituents simulated) | Document; future: ingest historical constituent list from NSE archives |
| Charges model for bulk quarterly rebalance may over/understate reality | Algo returns slightly off | Use same `charges_for` the user pays — parity is the goal, not absolute accuracy |
| LTCG/STCG not applied to algo final NAV | User's NAV is taxed, algos are not → unfair | Option A (chosen): document "gross of tax" label for algos. Option B (future): approximate taxes via average-cost lots |

**Feature flag:** `ENABLE_ALGO_STRATEGIES` env var (default on). Lets us ship incrementally and kill if a bug hits prod.

**Rollback plan:** flip the flag off; algo results disappear from the tab (endpoint 404s, frontend hides tab).

---

## 9. Open Questions / Follow-ups

- [ ] Should we expose per-rebalance NAV points instead of a 7-day sample for smoother curves? (default: 7-day, matches FD curve)
- [ ] Do we want a "best algo vs user" summary stat on the Overview tab too? Currently only on the Algo tab.
- [ ] Future: add user-configurable strategy parameters (look-back period, top-N)?
- [ ] Future: historical Nifty 500 constituent ingest to fix survivorship bias.
