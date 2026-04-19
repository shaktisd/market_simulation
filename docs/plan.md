# Market Simulation Game — Implementation Plan

A turn-based Indian stock-market simulation that teaches investing by hiding the
calendar period from the player and asking them to make decisions purely on
market signals.

---

## 1. Finalized Requirements (from clarifications)

| Area | Decision |
|---|---|
| Starting capital | ₹1,00,00,000 (1 Cr) cash |
| Universe | Nifty 500 (from [docs/ind_nifty500list.csv](docs/ind_nifty500list.csv)) + top ~200 Direct-Growth mutual funds |
| Short selling | Not allowed (long-only, cash-settled) |
| Game length | Random, hidden, 1–10 years, revealed only at end |
| Game start year | Random year ≥ 2010 |
| Turn step | Configurable at game start: **day / week / month** |
| Order types | Market-at-turn-close only |
| Quantities | Whole shares for stocks; fractional units for MFs |
| Corporate actions | Use yfinance adjusted-close (dividends/splits/bonus baked in) |
| Frictions | Full realism — brokerage, STT, exchange fees, GST, stamp duty, SEBI charges, DP charges, STCG/LTCG at exit |
| Data source | Pre-downloaded yfinance history cached in SQLite (one-time setup script) |
| MF data | `https://api.mfapi.in/mf` (list, cached daily) + `/mf/{scheme}` (NAV history, fetched on demand and cached) |
| Info shown per turn | Trailing price chart (no dates), fundamentals (P/E, P/B, EPS), sector/index context |
| Reveal | Fully hidden until end — "Month 1, Month 2…" labels only |
| End trigger | Hidden random stop between 1–10 years |
| Multiplayer | Local-only: compare vs own past runs + passive benchmarks |
| Benchmarks | Nifty 50, Nifty 500, FD @ 7% p.a. |
| Auth | No login, single local profile |
| Layout | Monorepo: `backend/` (FastAPI + uv) + `frontend/` (Vite + React + TS + Tailwind + shadcn/ui) |
| Universe rule | Current Nifty 500 list for all periods (accepts mild survivorship bias) |

---

## 2. Architecture

```
market_simulation/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry
│   │   ├── api/                     # Route handlers
│   │   │   ├── game.py              # start / next-turn / end
│   │   │   ├── portfolio.py         # holdings, cash, pnl
│   │   │   ├── orders.py            # buy / sell
│   │   │   ├── market.py            # price series, fundamentals, sector
│   │   │   └── history.py           # past runs, leaderboard-vs-self
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── db.py                # SQLAlchemy + SQLite
│   │   │   └── time_masking.py      # t-N labels instead of dates
│   │   ├── models/                  # ORM models
│   │   ├── services/
│   │   │   ├── engine.py            # turn loop, end-of-game detection
│   │   │   ├── pricing.py           # price lookup at masked time t
│   │   │   ├── charges.py           # STT/GST/stamp/brokerage/SEBI/DP
│   │   │   ├── taxes.py             # STCG/LTCG on exit
│   │   │   ├── benchmarks.py        # Nifty50, Nifty500, FD
│   │   │   └── mf_api.py            # mfapi.in client + cache
│   │   └── ingest/
│   │       ├── fetch_stocks.py      # yfinance bulk download
│   │       └── fetch_mf_master.py   # Daily mfapi.in master refresh
│   ├── data/
│   │   └── market.sqlite            # generated
│   ├── pyproject.toml               # uv-managed
│   └── README.md
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Game.tsx             # Main play screen
│   │   │   └── Results.tsx          # End-of-game reveal
│   │   ├── components/
│   │   │   ├── PortfolioPanel.tsx
│   │   │   ├── WatchlistTable.tsx
│   │   │   ├── PriceChart.tsx       # Recharts, x-axis shows t-N only
│   │   │   ├── OrderDialog.tsx
│   │   │   ├── SectorHeatmap.tsx
│   │   │   └── BenchmarkCompare.tsx
│   │   ├── lib/api.ts
│   │   └── App.tsx
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── package.json
│
├── docs/
│   ├── ind_nifty500list.csv         # already present
│   └── specs.md
├── plan.md
└── README.md                        # combined run instructions
```

### Data flow

1. **One-time ingest** (`uv run python -m app.ingest.fetch_stocks`) downloads daily adjusted OHLC for every Nifty 500 symbol + Nifty 50 + Nifty 500 indices from 2008-01-01 to today, stored in SQLite.
2. **MF master refresh** runs on server startup if cache > 24 h old; curated top ~200 Direct-Growth schemes tagged by category.
3. **Game start**: engine picks random start date (year ≥ 2010), random game length in {365…3650} days, stores in `games` table as `hidden_start_date` / `hidden_end_date`. User sees only `turn_index`.
4. **Each turn**: engine advances `current_date` by the chosen step (day/week/month). API returns prices/fundamentals filtered to `hidden_start_date … current_date` with all dates stripped — only relative indices returned.
5. **Orders**: submitted orders execute at close price of `current_date`. Charges applied. Holdings updated.
6. **End detection**: on each "Next" click, if `current_date >= hidden_end_date` → trigger reveal screen.

---

## 3. Database Schema (SQLite)

```sql
-- master
stocks(symbol PK, company_name, industry, isin)
stock_prices(symbol, date, open, high, low, close, adj_close, volume,
             PRIMARY KEY(symbol, date))
stock_fundamentals(symbol, date, pe, pb, eps, market_cap,
                   PRIMARY KEY(symbol, date))
index_prices(index_name, date, close, PRIMARY KEY(index_name, date))

mf_master(scheme_code PK, scheme_name, fund_house, category, plan, option,
          last_refreshed)
mf_nav(scheme_code, date, nav, PRIMARY KEY(scheme_code, date))

-- game state
games(id PK, created_at, step_unit, hidden_start_date, hidden_end_date,
      current_date, status, starting_cash)
holdings(game_id, instrument_type, symbol_or_scheme, quantity, avg_cost,
         PRIMARY KEY(game_id, instrument_type, symbol_or_scheme))
orders(id PK, game_id, turn_index, instrument_type, symbol_or_scheme,
       side, quantity, price, charges_breakdown_json, net_cashflow,
       executed_at_hidden_date)
cash_ledger(id PK, game_id, turn_index, delta, reason, balance_after)
turn_snapshots(game_id, turn_index, nav, cash, holdings_mv,
               PRIMARY KEY(game_id, turn_index))

-- history
game_results(game_id PK, final_nav, cagr, max_drawdown, sharpe,
             benchmark_nifty50_cagr, benchmark_nifty500_cagr, benchmark_fd_cagr,
             revealed_start_date, revealed_end_date)
```

---

## 4. Backend API

All endpoints strip real dates before responding.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/game/start` | body: `{step_unit}` → creates game, returns `game_id`, `turn_index=0`, `cash` |
| POST | `/api/game/{id}/next` | advance one step; returns new prices snapshot OR end-of-game payload |
| GET  | `/api/game/{id}/state` | current masked state (turn, cash, holdings, NAV) |
| GET  | `/api/game/{id}/market/stocks?symbol=` | trailing price window (no dates), fundamentals, sector |
| GET  | `/api/game/{id}/market/funds?scheme=` | trailing NAV window |
| GET  | `/api/game/{id}/market/sectors` | sector-wise % change over trailing window |
| GET  | `/api/game/{id}/market/benchmarks` | Nifty50/Nifty500/FD curves (masked) |
| POST | `/api/game/{id}/orders` | place buy/sell |
| GET  | `/api/game/{id}/portfolio` | holdings with MV, unrealized P&L |
| POST | `/api/game/{id}/end` | force end + reveal |
| GET  | `/api/game/{id}/result` | full reveal: dates, charts with real x-axis, benchmark comparison |
| GET  | `/api/history` | list of past games with CAGR + benchmark deltas |

---

## 5. Charges & Taxes Module (`services/charges.py`)

Applied on every order. Realistic FY-2025 equity delivery rates:

| Charge | Buy | Sell |
|---|---|---|
| Brokerage | ₹20 or 0.03% (min) | ₹20 or 0.03% (min) |
| STT | — | 0.1% of sell value |
| Exchange txn | 0.00297% (NSE) | 0.00297% |
| SEBI | 0.0001% | 0.0001% |
| Stamp duty | 0.015% | — |
| GST | 18% on (brokerage + exchange + SEBI) | same |
| DP charges | — | ₹15.93 flat per sell day per scrip |

**Taxes** (computed at game end only — affect final NAV but not interim P&L display):
- STCG (≤1 yr): 15% on realized gains
- LTCG (>1 yr): 10% on realized gains above ₹1 lakh/year exemption
- MF taxation handled per-scheme category (equity vs debt)

Orders are rejected if `cash_balance < buy_value + charges`.

---

## 6. Time-Masking Strategy

The backend never returns real dates to the frontend during play. Rules:

1. All price payloads use `t_index` (integer, turn-relative), not ISO dates.
2. Charts show labels like `t-12, t-6, t-0`.
3. Fundamentals use same trailing window.
4. Sector context: show relative % change over window, not absolute date range.
5. The only component that may display real dates is `Results.tsx` after game end.

A single `TimeMasker` helper converts `(hidden_start_date, current_date, series)` → masked series that the API layer uses before serialization.

---

## 7. Frontend UX

### Game screen (turn loop)
- **Top bar**: Turn number · Cash · Holdings MV · Total NAV · "Next ▶" button (step size shown)
- **Left**: Watchlist tabs (Stocks / Mutual Funds / Holdings). Search + filter by sector/category.
- **Center**: Selected instrument — trailing price chart (Recharts), buy/sell buttons, fundamentals card (stocks only).
- **Right**: Sector heatmap, top gainers/losers of the window, cash & holdings summary.
- **Bottom sheet** (mobile): collapsible portfolio panel.

### Order dialog
- Qty input (whole for stocks, decimal for MF)
- Shows: order value, full charge breakdown, net cash impact, post-trade cash balance
- Confirm/Cancel

### End-of-game Results screen
- Reveal banner: "You played from **Mar 2011 → Aug 2017** (6.5 years hidden)"
- Portfolio value curve vs Nifty 50, Nifty 500, FD — real dates on x-axis
- Metrics: CAGR, max drawdown, Sharpe, total charges paid, taxes paid
- Trade log with real dates
- "Play again" + "View past runs" buttons

### Past runs page
- Table of all games with period, CAGR, Δ vs Nifty 50, max DD
- Click → same reveal screen

### Responsiveness
- Tailwind breakpoints: `sm/md/lg/xl`. Mobile = stacked single-column; desktop = 3-pane.

---

## 8. Setup & Run

### README will include:
```bash
# 1. Backend
cd backend
uv sync
uv run python -m app.ingest.fetch_stocks        # one-time, ~20 min
uv run uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                                       # http://localhost:5173
```

CORS: backend allows `http://localhost:5173` in dev.

---

## 9. Implementation Phases

### Phase 1 — Foundation (backend skeleton)
- uv project init, FastAPI app, SQLite + SQLAlchemy
- Load `ind_nifty500list.csv` → `stocks` table
- `fetch_stocks.py` script using yfinance → `stock_prices`, `index_prices`
- `fetch_mf_master.py` + curated-category filter

### Phase 2 — Core engine
- `games` table, random period generator (start ≥ 2010, length 365–3650d)
- Turn advance logic with configurable step
- Time-masking layer
- Price & fundamentals lookup services

### Phase 3 — Trading
- Orders endpoint, charges module, cash ledger, holdings update
- Portfolio valuation + NAV snapshotting per turn

### Phase 4 — Frontend
- Vite + React + TS scaffold, Tailwind + shadcn/ui
- API client, game-start flow, turn loop UI
- Price chart (Recharts) with masked axis
- Order dialog with charge breakdown

### Phase 5 — End & Reveal
- End-game detection, tax calculation, reveal payload
- Results screen with real-date charts + benchmark overlay
- Past-runs history page

### Phase 6 — Polish
- Mobile responsive pass
- Sector heatmap, fundamentals card
- Loading/empty/error states, README, seed data check

---

## 10. Open Risks / Notes

- **yfinance reliability**: Some Nifty 500 tickers may be missing or sparse; ingest script should log and store `data_coverage_start` per symbol so engine can exclude under-covered stocks from games whose period predates IPO.
- **Survivorship bias**: using current Nifty 500 across history inflates returns vs reality. Acceptable for teaching; noted in end-of-game footnote.
- **Fundamentals history**: yfinance only exposes current fundamentals. Historical P/E etc. will be approximated from `adj_close / ttm_eps` where EPS history is available; otherwise field hidden. This is a known limitation to revisit.
- **mfapi.in rate limits**: Cache aggressively; only fetch NAV history for schemes the user actually clicks on.
- **One-time ingest time**: ~20 min for 500 symbols. Provide progress bar in script.
