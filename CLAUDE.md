# CLAUDE.md

## Project overview
Turn-based Indian-market investing game: play through a hidden random slice of market history (2010–today) with ₹1 Cr starting capital, trade Nifty 500 stocks + mutual funds with realistic charges/taxes, then benchmark your returns against NIFTY50/NIFTY500/FD and seven algorithmic strategies.

## Tech stack
**Backend** — Python ≥3.11, managed by `uv`. FastAPI ≥0.115, SQLAlchemy ≥2.0, Pydantic ≥2.7, SQLite (WAL mode), yfinance, pandas, httpx.
**Frontend** — Node ≥20. React 18.3, React Router 6.26, Vite 5.4, TypeScript 5.5 (strict), Tailwind 3.4, Recharts 2.12, lucide-react. Path alias `@/*` → `src/*`.
**Tooling** — `ruff` (line-length 100, target py311) for Python; ESLint for TS.

## Commands
Run from the repo root unless noted.

```bash
# Backend — first-time data seeding (run once; fetch_stocks takes 15–25 min)
cd backend && uv sync
uv run python -m app.ingest.fetch_stocks
uv run python -m app.ingest.fetch_mf_master

# Backend dev server (port 8000)
cd backend && uv run uvicorn app.main:app --reload --port 8000

# Frontend dev server (port 5173, proxies /api → :8000)
cd frontend && npm install && npm run dev

# Frontend build & lint
cd frontend && npm run build   # runs `tsc -b && vite build`
cd frontend && npm run lint    # eslint . --ext ts,tsx

# Backend lint
cd backend && uv run ruff check .
```

No test suite exists yet (pytest is in optional deps but no `tests/` folder).

## Directory structure
```
backend/app/
  api/              FastAPI routers — game, orders, portfolio, market, analytics, history
  core/             config.py, db.py (session_scope), time_masking.py
  ingest/           fetch_stocks.py, fetch_mf_master.py, load_universe.py
  services/
    engine.py       Game state machine — next_turn, _finalize, value_portfolio
    pricing.py, charges.py, taxes.py, benchmarks.py, mf_api.py
    algos/          Plugin strategies: base.py, registry.py, simulator.py, strategies/*.py
  models.py         SQLAlchemy ORM
  schemas.py        Pydantic request/response models
  main.py           App factory, startup seeds algo catalog
backend/data/market.sqlite   Main DB (WAL/SHM alongside)

frontend/src/
  pages/            Home, Game, Results, History
  components/       WatchlistTable, OrderDialog, PriceChart, PortfolioPanel, NavCurve, …
  lib/              api.ts (single fetch wrapper), format.ts (inr/pct/classPnl), cn.ts

docs/ind_nifty500list.csv    Stock universe source
```

## Coding conventions
**Backend**
- `from __future__ import annotations` at the top; type hints everywhere.
- SQLAlchemy 2.0 style (`Mapped[...]`, `mapped_column(...)`).
- Sync FastAPI routes with DI: `db: Session = Depends(get_db)`, `game: Game = Depends(get_active_game)`.
- DB writes go through `session_scope()` (commits/rolls back for you). Routes can also commit directly after `_snapshot` / `_finalize`.
- Never leak raw dates during play — funnel through `core.time_masking` so the hidden period stays hidden until game end.

**Frontend**
- Functional components only, PascalCase filenames (`OrderDialog.tsx`).
- All HTTP calls go through `src/lib/api.ts` — do not add `fetch` elsewhere.
- Styling is Tailwind utility classes inline; no CSS modules. Shared formatters live in `src/lib/format.ts`.
- TS strict is on; don't silence with `any` without cause.

**Algo strategies (plugin pattern)**
- Add a class in `backend/app/services/algos/strategies/<name>.py` exposing `key`, `display_name`, `description`, and `select(ctx) -> list[RebalanceTarget]`.
- Register it in `strategies/__init__.py` and append to `ALL_STRATEGIES`. Startup seeds the catalog via `seed_algo_catalog()`.

## Domain concepts
- **Game** — one session: starting cash, hidden start/end dates, step unit (day/week/month), status.
- **Turn** — one step forward; writes a `TurnSnapshot`. The final turn runs `_finalize`, which computes benchmarks + all algo backtests (slow: 10–30 s).
- **Holding** — quantity of a stock/MF with average cost, updated by `Order` rows.
- **Algo strategy** — a rebalancing rule benchmarked against the user's portfolio at game end.

## Behavior rules
- **Don't regenerate the SQLite DB** (`backend/data/market.sqlite`) or the WAL/SHM sidecars — re-ingesting stocks takes 15–25 min.
- **Don't hardcode calendar dates** into user-facing strings during an active game; they must come from game-end reveal or masking helpers.
- **New API call?** Add it to `frontend/src/lib/api.ts` and a FastAPI router under `backend/app/api/` — don't inline `fetch` in components or put routes in `main.py`.
- **Shell is bash on Windows.** Use forward slashes and Unix syntax (`/dev/null`, not `NUL`). Quote paths with spaces.
- **Keep responses lean.** No trailing "summary of what I did" paragraphs; the diff is visible.
- **Don't add comments that restate the code** or reference the current task ("fix for issue X"). Only write a comment when the *why* is non-obvious.
- **Don't invent features** beyond the request. A UI tweak doesn't need a refactor; a bug fix doesn't need surrounding cleanup.
