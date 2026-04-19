# Refactor Plan — Incremental Algo Strategy Execution

## Goal

Today, the 7 algorithmic benchmark strategies (Momentum 12-1, Low-P/E Value, Low Vol, High-ROE Quality, Risk Parity, Reversal, Equal-Weight Nifty 50) run **only at game end** inside `_finalize()`. The user waits 10–30 seconds on the game-end overlay before seeing how their portfolio compares to the bots.

**Target:** algos advance in lockstep with the user's turns. After every `Next` click, the Game screen shows a live leaderboard — user's NAV alongside each algo's NAV at the same hidden date. The existing Results-page leaderboard keeps working unchanged (it just reads the already-computed state).

This changes nothing about the algos themselves. It changes **when** and **how** their state is persisted.

---

## Current state (baseline to preserve)

- `backend/app/services/engine.py:_finalize()` loops over `STRATEGIES.values()` and calls `run_strategy(db, strat, hidden_start_date, hidden_end_date, starting_cash)` for each.
- [`simulator.py:run_strategy()`](backend/app/services/algos/simulator.py) walks every rebalance date (every 90 days) start→end in one pass, then samples the NAV curve every 7 days, and returns an `AlgoRunResult` (final_nav, cagr, max_drawdown, total_charges, curve, holdings, rebalances).
- Results are persisted once into the `AlgoRun` table (`nav_curve_json`, `final_holdings_json`, `rebalance_log_json`) and read back by `GET /game/{id}/algo-results` for the Results page.
- The per-algo cost is ~0.2–0.5 s; 7 algos ≈ 2–4 s. Most of that is price lookups during liquidation/allocation, not the `strategy.select()` call itself.

The simulator is **stateless between rebalance dates**: `holdings`, `avg_costs`, `cash`, `total_charges` are local dicts; nothing lives outside the function.

---

## Target architecture

**Principle:** the simulator's core loop stays identical; we split its *scheduling* from its *execution* and persist the in-flight state between invocations.

### New shape of per-turn execution

After `_snapshot()` writes the user's NAV at turn N (hidden date = D), the engine calls a new `advance_algos_to(db, game, D)` helper that, **for each registered strategy**:

1. Loads the algo's persisted state (`AlgoRunState` row — see below).
2. Runs any rebalance dates `r` with `state.last_rebalance_date < r <= D` — applies liquidate + select + allocate, same as today's inner loop.
3. Values the basket at D, appends `(D, nav)` to the curve.
4. Writes the updated state back.

The rebalance cadence (90 days) stays. This means most turns don't trigger a rebalance; they only do a cheap price-lookup for the current basket and append one curve point.

### Typical cost per turn

| Phase | Work |
|---|---|
| Turn with no rebalance | ~N price lookups (N = current basket size, usually 30–50) per algo ≈ ~200–300 lookups total for 7 algos |
| Turn with a rebalance for one algo | 1 liquidate + 1 select + 1 allocate = today's per-rebalance cost — but **amortized across turns** |
| Game end | Nothing new — state already complete, just read the final row |

For a monthly-step game, rebalances fire roughly every 3rd turn per algo. Amortization means the user pays ~0.5–1 s extra per `Next` click instead of 10–30 s at the end.

### Fallback / kill-switch

Add a setting `settings.incremental_algos: bool` (default True). If False, preserve the current behavior: skip per-turn work, run `_run_algo_strategies()` at `_finalize` as before. Lets us disable quickly if live execution causes issues in prod.

---

## Data model changes

### New table: `AlgoRunState`

Persists in-flight state per (game_id, strategy_key). Exists *during play*; survives as long as the game is active. At game end we can keep or drop it (see "Results compatibility").

```python
class AlgoRunState(Base):
    __tablename__ = "algo_run_state"
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), primary_key=True)
    strategy_key: Mapped[str] = mapped_column(
        String(32), ForeignKey("algo_strategies.key"), primary_key=True
    )
    cash: Mapped[float] = mapped_column(Float)
    total_charges: Mapped[float] = mapped_column(Float, default=0.0)
    last_processed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_rebalance_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # JSON blobs — small, bounded by basket size (~50) and game length (~100 turns)
    holdings_json: Mapped[str] = mapped_column(Text, default="{}")       # {symbol: qty}
    avg_costs_json: Mapped[str] = mapped_column(Text, default="{}")      # {symbol: avg_cost}
    curve_json: Mapped[str] = mapped_column(Text, default="[]")          # [[iso_date, nav], ...]
    rebalance_log_json: Mapped[str] = mapped_column(Text, default="[]")  # same shape as today's RebalanceEntry[]
```

### Keep: `AlgoRun`

Still the canonical finalized record. At game end, the engine copies `AlgoRunState` → `AlgoRun` (computing `cagr`, `max_drawdown`, holding snapshots) so `Results.tsx` and `/algo-results` keep working without changes.

### DB migration

The project uses plain SQLAlchemy `Base.metadata.create_all()` via `init_db()` — no Alembic. On next startup `AlgoRunState` gets auto-created. Existing games that pre-date the refactor simply have no state rows; the engine treats that as "no algos running" for those games.

---

## Backend changes

### 1. `backend/app/services/algos/simulator.py` — split the monolith

Break `run_strategy()` into three composable pieces. The existing function stays as a thin wrapper that calls all three in sequence, preserving its signature for anything that still wants the batch path (tests, the fallback mode).

```python
def init_run_state(starting_cash: float) -> AlgoRunInFlight:
    """Fresh zero-state: cash = starting_cash, empty holdings/avg_costs, empty curve."""

def advance_run_state(
    db: Session,
    strategy: Strategy,
    state: AlgoRunInFlight,
    as_of: date,
    rebalance_days: int = 90,
) -> None:
    """Bring state up to `as_of`. Runs any scheduled rebalances whose date falls in
    (state.last_processed_date, as_of], then values holdings at `as_of` and appends
    a curve point. Mutates `state` in place. Idempotent if called repeatedly with
    the same as_of."""

def finalize_run_state(
    state: AlgoRunInFlight,
    starting_cash: float,
    end_date: date,
) -> AlgoRunResult:
    """Compute cagr, max_drawdown, holding snapshots from the state. Pure function."""
```

Reuse the existing `_liquidate`, `_allocate`, `_value_holdings`, `_rebalance_dates` helpers verbatim inside `advance_run_state`.

**Rebalance scheduling:** compute rebalance dates lazily — `_next_rebalance_date(last_rebalance_date, rebalance_days, game.hidden_start_date)` — so we don't need to know `end` upfront. Persist `last_rebalance_date` in state; first rebalance is at `hidden_start_date`.

**Idempotency:** calling `advance_run_state(..., as_of=D)` twice in a row on the same state should be a no-op for the second call. Guard with `if state.last_processed_date and state.last_processed_date >= as_of: return`.

### 2. New: `backend/app/services/algos/live.py`

Thin adapter layer between engine turns and the simulator. Owns serialization:

```python
def ensure_state_rows(db: Session, game: Game) -> None:
    """Create AlgoRunState for every registered strategy if missing. Called once
    when the game starts (or lazily on the first turn of an upgraded game)."""

def advance_all_algos(db: Session, game: Game, as_of: date) -> None:
    """For each strategy, load state → advance_run_state(as_of) → save. Small
    try/except around each so one broken strategy can't break the user's turn."""

def load_live_results(db: Session, game: Game) -> AlgoResultsResponse:
    """Build the same AlgoResultsResponse shape the /algo-results endpoint returns
    today, but from AlgoRunState (in-flight) rather than AlgoRun (finalized).
    Computes cagr/drawdown on the fly from the partial curve."""

def finalize_all_algos(db: Session, game: Game) -> None:
    """At game end: for each state row, compute final AlgoRunResult and upsert into
    AlgoRun. Replaces today's _run_algo_strategies() call. Also deletes the
    AlgoRunState rows (optional — we might keep them for debugging)."""
```

Serialization rules:
- `holdings_json` — JSON dict `{symbol: qty}`.
- `avg_costs_json` — JSON dict `{symbol: avg_cost}`.
- `curve_json` — JSON array of `[iso_date, round(nav, 2)]`.
- `rebalance_log_json` — same shape as today's `RebalanceEntry`.

Use `json.dumps`/`json.loads` at the boundary; keep the in-flight object as a dataclass (`AlgoRunInFlight`) so the simulator code reads naturally.

### 3. `backend/app/services/engine.py` — hook into the turn cycle

- `start_new_game()`: after creating the `Game` row, call `live.ensure_state_rows(db, game)` so all 7 strategies exist with zero state.
- `_snapshot()` (or right after it in `next_turn`): call `live.advance_all_algos(db, game, game.current_date)`. Guard with `if settings.incremental_algos`.
- `_finalize()`:
  - If incremental mode: call `live.finalize_all_algos(db, game)` instead of the current `_run_algo_strategies()` (which did the full batch).
  - Else: fallback to existing `_run_algo_strategies()`.

This is the only behavioral change to the engine. Everything else — user trading, charges, portfolio valuation, snapshots — is untouched.

### 4. `backend/app/api/game.py` (or analytics.py) — new live endpoint

```python
@router.get("/{game_id}/algo-results-live", response_model=AlgoResultsResponse)
def algo_results_live(
    game: Game = Depends(get_active_game),
    db: Session = Depends(get_db),
) -> AlgoResultsResponse:
    """Live algo leaderboard during active play. Reads AlgoRunState and computes
    partial CAGR / drawdown. Returns same shape as /algo-results so the frontend
    can reuse rendering code."""
    return live.load_live_results(db, game)
```

The existing `GET /game/{id}/algo-results` stays as-is for finalized games.

**Optional optimization:** fold live results into the existing `turn-analytics` or a combined "turn summary" response so the frontend refreshes in one round trip. For v1, keep it a separate endpoint — easier to reason about, easier to cache, no risk to existing callers.

### 5. `backend/app/core/config.py` — kill switch

```python
incremental_algos: bool = True  # run algos per-turn instead of at game end
```

---

## Frontend changes

### 1. `frontend/src/lib/api.ts`

Add `api.algoResultsLive(id)` mirroring `api.algoResults(id)` (same return type). Point it at `/algo-results-live`.

### 2. New: `frontend/src/components/AlgoLeaderboardLive.tsx`

A compact in-game panel. Fetches on mount + `refreshKey` bumps (same pattern as `NavCurve`, `TurnAnalyticsPanel`). Shows:

- **Ranked mini-table**: User + each algo, sorted by current NAV. Columns: rank, name, NAV, delta vs starting cash, delta vs user. Highlight the user's row.
- **Sparkline per row** (small inline Recharts line using the curve points that already flow through the endpoint).
- **Status chip**: `warming up…` for the first 1–2 turns (before there's enough curve to rank meaningfully), `live` after.

Placement in `Game.tsx`: right column, under `SectorPanel` on full view and under `CompositionPanel` on the selected-instrument view. Keeps the center detail-and-chart pane uncluttered.

Guard for early turns: if `turns_observed < 2`, render the placeholder chip instead of the table — same UX pattern as `RiskDashboard`.

### 3. `frontend/src/pages/Game.tsx`

- Import `AlgoLeaderboardLive`.
- Mount with `<AlgoLeaderboardLive gameId={id} refreshKey={bump} />` in both the `selected` and non-`selected` branches of the right column.

### 4. `frontend/src/pages/Results.tsx` and `AlgoStrategiesTab.tsx`

**No changes required.** They already read `/algo-results` which is populated by `finalize_all_algos()`. The data shape is identical.

Optional polish: add a note on the live leaderboard ("Full breakdown + rebalance log available at game end") so users understand why the in-game view is lighter than the Results view.

### 5. Refresh hook

The mascot, risk dashboard, and nav curve all refresh on `bump` (incremented after `api.next(id)` in `Game.tsx:advance`). The live algo leaderboard plugs into the same signal — no new plumbing needed.

---

## Algorithmic decisions

### Rebalance cadence vs. game step unit

Today's 90-day rebalance cadence is fine for month/week step games — rebalances fire roughly every 3 user turns (month step) or ~13 turns (week step). For a day-step game, 90 days = 90 turns between rebalances, which is fine algorithmically but means a lot of curve points with no rebalance activity. Keep 90 days unchanged for v1; revisit if we add shorter-cadence strategies.

### What happens if the user ends the game early (`POST /game/{id}/end`)

`advance_all_algos` may not have been called up to `hidden_end_date`. Two options:

1. **Finalize from where we are** — compute cagr from whatever curve exists. Simpler. Slight inconsistency: if the user ends at turn 8 of a 12-turn game, the algo results only span 8 turns. Acceptable — they ended early.
2. **Catch up on finalize** — run `advance_run_state(..., as_of=hidden_end_date)` inside `finalize_all_algos` before computing scalars. Preserves today's behavior (results always span the full hidden window) at the cost of a one-time burst of work.

**Pick (2).** It keeps Results consistent with the current product and is still cheaper than today's end-of-game lump — any remaining rebalances haven't been done yet, so it's strictly less work.

### Price-lookup contention

7 algos × one price lookup each on every turn isn't free but is dwarfed by the user's own portfolio valuation. SQLite with WAL mode handles this fine. No caching layer needed for v1; revisit if turns feel sluggish.

### Failure isolation

Wrap each strategy's `advance_run_state` call in try/except. A broken strategy logs a warning and skips the turn — the user's trade still goes through. The state row retains its previous `last_processed_date`, so the next successful turn catches up.

---

## Edge cases & tests

1. **Empty universe on a rebalance date** (very early dates with sparse data) — today's simulator already handles this: `targets = []`, `_allocate` is a no-op, cash sits idle. Preserve.
2. **First turn, turn 0** — rebalance date is `hidden_start_date`; run it, curve has one point. No user vs algo delta yet (both at starting cash). `AlgoLeaderboardLive` shows the "warming up" chip.
3. **Game resumed across server restarts** — `AlgoRunState` is durable, state picks up where it left off. Already correct by construction.
4. **Duplicate turn calls / retries** — `advance_run_state` guards on `last_processed_date`. Idempotent.
5. **Strategy added after some games are in flight** — `ensure_state_rows()` on first turn creates missing rows; the new strategy starts at its "first rebalance" whenever it sees a date. Curve will be shorter than others — display as-is.
6. **Strategy removed** — old `AlgoRunState` rows dangle. Finalize skips strategies not in the registry. Low priority; add a cleanup job later if needed.

**Test coverage to add** (currently no test suite exists — optional but recommended):
- `test_advance_run_state_idempotent` — call twice with same `as_of`, assert curve length doesn't double.
- `test_finalize_matches_batch` — run `advance_run_state` turn-by-turn over a fixed date range, compare final NAV / CAGR / holdings against today's `run_strategy()` on the same range. They should match within floating-point noise.
- `test_partial_game_finalize` — end a game at turn 5 of 12; assert `finalize_all_algos` catches up and produces a result spanning the full hidden window.

---

## Phased rollout

| Phase | Scope | Shippable |
|---|---|---|
| 1 | `AlgoRunInFlight` dataclass + split `simulator.py` into init/advance/finalize. Batch path still uses them internally. Zero behavior change. | Yes — ships as a pure refactor. |
| 2 | `AlgoRunState` table, `live.py` adapter, `ensure_state_rows` on game start, `advance_all_algos` on every turn. Add settings flag. `_finalize` still uses the batch path (no-op on state rows). | Yes — algos run per-turn but nothing reads them. Low risk. |
| 3 | `/algo-results-live` endpoint, `api.algoResultsLive`, `AlgoLeaderboardLive` component, mount in `Game.tsx`. | Yes — the visible feature. |
| 4 | Switch `_finalize` to use `finalize_all_algos` from live state (path (2) in "ends early"). Delete the now-dead batch codepath after a week of soak. | Yes — cleanup. |
| 5 (optional) | Tests, config knobs for rebalance cadence per-strategy, drop `AlgoRunState` rows after finalize to reclaim space. | Polish. |

Phases 1–3 are the minimum for the feature. 4 and 5 are hygiene.

---

## Files touched

**New**
- `backend/app/services/algos/live.py` — state persistence + live results adapter
- `frontend/src/components/AlgoLeaderboardLive.tsx` — in-game leaderboard

**Modified**
- `backend/app/models.py` — add `AlgoRunState`
- `backend/app/services/algos/simulator.py` — split run_strategy into init/advance/finalize
- `backend/app/services/algos/base.py` — add `AlgoRunInFlight` dataclass
- `backend/app/services/engine.py` — hook into start/snapshot/finalize
- `backend/app/api/game.py` (or analytics.py) — new `/algo-results-live` endpoint
- `backend/app/schemas.py` — no change (reuse `AlgoResultsResponse`)
- `backend/app/core/config.py` — `incremental_algos` flag
- `frontend/src/lib/api.ts` — add `algoResultsLive`
- `frontend/src/pages/Game.tsx` — mount the live leaderboard

**Unchanged (verified)**
- `frontend/src/pages/Results.tsx`
- `frontend/src/components/AlgoStrategiesTab.tsx`
- `GET /game/{id}/algo-results` endpoint
- All 7 strategy implementations in `backend/app/services/algos/strategies/`
- Charges / pricing / benchmarks services

---

## Open questions

1. **Should the live leaderboard show rebalance log entries as they happen** (like a mini activity feed — "Momentum rebalanced at turn 4: 45 trades, ₹12K charges")? Extra value, minimal extra code. Ship with v1 or defer?
2. **Cache the live endpoint** inside a turn? If the user clicks around, we'd refetch. Cheap given state rows are small (~10 KB each), probably not worth caching in v1.
3. **Drop `AlgoRunState` after finalize?** Trading a few hundred KB per completed game for not needing to re-join across tables. Leaning keep-for-now, prune in phase 5.
