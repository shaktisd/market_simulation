# New Features Proposal — Market Simulation Game

A roadmap of professional polish + engagement features to turn the current simulator into something players return to, share, and recommend. Organized by theme, with rough implementation notes tied to the existing stack (FastAPI + React + SQLite + Recharts).

---

## 0. Direct answer: Should we add an animated character?

**Yes — but as a *market mood* mascot, not a portfolio avatar.** A small Tamagotchi-style character in the corner of the Game screen reacts to market conditions and your portfolio health. Keep it tasteful (SVG + CSS, no heavy Lottie), toggleable, and *informative* — every animation should map to a real signal so it adds value instead of noise.

**Suggested mappings (derive from existing state — no new data needed):**

| State signal | Character reaction |
|---|---|
| Portfolio up > 2% this turn | Celebrating / confetti burst |
| Portfolio down > 2% this turn | Worried / umbrella raised |
| Max drawdown breached new low | Sweating, red tint |
| Cash > 70% of NAV for 3+ turns | Sleeping / bored ("capital idle") |
| Single stock > 25% of NAV | Wobbling tightrope ("concentration risk") |
| Charges in last turn > 1% of trade value | Holding a receipt ("high churn") |
| Hit a new all-time-high NAV | Trophy pose |
| Sector exposure > 40% to one sector | Balancing on one leg |

**Why this works:** it converts numbers the user might not read (concentration, churn, drawdown) into something their peripheral vision picks up instantly. The state already exists in `turn-analytics`, `composition`, and `portfolio` endpoints — no schema changes required.

**Implementation sketch:**
- New component `frontend/src/components/MarketMascot.tsx` — pure SVG with `framer-motion` transitions between ~10 states.
- State selector hook `useMascotState()` consumes existing react-query data for portfolio, composition, and turn analytics.
- Persist on/off toggle in `localStorage`; default ON for new users, show a "dismiss forever" option after 3 sessions.
- A quiet one-liner caption under the mascot ("Heavy in Financials — 42%") makes the insight legible for users who prefer words.

**What to avoid:** talking/voiced characters, pop-up tips that steal focus, anything that blocks trading. The mascot should be glanceable, never modal.

---

## 1. Engagement & Retention

### 1.1 Daily challenges ("Market Moment of the Day")
A pre-seeded game of a *specific* famous slice (COVID crash Mar 2020, election week 2014, demonetisation Nov 2016, Adani-Hindenburg Jan 2023) with fixed seed + universe, so every player faces the same 20 turns. Global leaderboard for that challenge resets daily.
- New endpoint: `GET /challenges/today`, `POST /challenges/{id}/start`.
- New table: `Challenge(id, seed_date, end_date, universe_hash, active_on)`.

### 1.2 Streaks & XP
- Daily play streak counter (localStorage + optional account).
- XP for: completing a game, beating NIFTY50, beating 3+ algos, finishing with <20% drawdown, rebalancing at least 5 times.
- Level badges displayed on Home. Low commitment, high dopamine.

### 1.3 Achievements / trophies
Grant at `_finalize` based on `GameResult` + derived stats. Examples:
- **Diamond Hands** — held a single stock for > 80% of game
- **Hedge Fund Manager** — beat 5+ algos in one game
- **Risk Manager** — max drawdown < 10% with CAGR > NIFTY50
- **Tax Optimizer** — realized gains kept under ₹1L in a year (LTCG-free)
- **Concentration King** — > 50% in one stock and still won
- **Sector Rotator** — held every sector at least once
- **Patient Investor** — only 3 trades entire game, still beat benchmark
- **Day Trader** — > 100 trades in one game
- Simple: `backend/app/services/achievements.py` runs post-finalize, writes to `AchievementUnlock(game_id, code, unlocked_at)`.

### 1.4 Social sharing card
A generated OG-style PNG summarising a completed game: "I beat 5 of 7 algos and NIFTY50 by 4.3% over a hidden 2017–2019 period." Shareable to LinkedIn/X/WhatsApp — drives organic acquisition.
- Backend renders PNG via `Pillow` from `GameResult`. Route: `GET /game/{id}/share-card.png`.

### 1.5 Asynchronous multiplayer ("ghost replays")
Let a user replay the *same* hidden period another user played, seeing their NAV curve as a ghost line alongside. No real-time — just a shared seed.
- Reuses `TurnSnapshot`. Add `GET /game/{id}/replay-token` (returns shareable seed) and `POST /game/start-from-replay`.

---

## 2. Professional polish (makes the product feel adult)

### 2.1 Risk dashboard during play
Today, risk metrics only appear at game end. Add a live panel:
- Rolling 30-turn volatility
- Portfolio beta vs NIFTY50
- Current drawdown from peak NAV
- Herfindahl concentration index
- Sharpe (using 7% risk-free as in FD benchmark)

Show as small stat tiles above the portfolio panel. Fetched from a new `GET /game/{id}/risk-metrics` endpoint that reads `TurnSnapshot`.

### 2.2 "What-if" order preview
Before confirming a trade, show a small impact preview: new cash, new weight in that stock, new sector exposure, new concentration (HHI). Currently `OrderDialog` shows charges only — adding forward-looking portfolio impact teaches discipline.

### 2.3 Tax-aware sell suggestions
When selling, flag whether the lot has crossed the 1-year LTCG threshold. A small chip: *"Sell now: ₹12,400 STCG (30% slab). Wait 14 days: LTCG (10% above ₹1L)."* Uses `Order.executed_date` and current simulation date — already available.

### 2.4 Charges transparency page
A "Costs so far" drawer: total brokerage + STT + stamp + GST + DP + realized-tax, with a sparkline of costs per turn. Reinforces why overtrading hurts. Read from `Order` aggregation.

### 2.5 Watchlist & notes persistence
- Save watchlist across games (`UserWatchlist` keyed on a local ID or future user account).
- Per-stock sticky notes: "Waiting for sector rotation" / "Sell above ₹2,100".
- Persists for the session; optional export as CSV.

### 2.6 Keyboard shortcuts
`B` to buy focused stock, `S` to sell, `N` to advance turn, `/` to focus search, `?` for help modal. Every serious trading UI has these.

### 2.7 Dark / light theme + high-contrast mode
Tailwind already supports `dark:`. Expose a toggle in header. Improves perceived professionalism and accessibility.

### 2.8 Loading & empty states
The `_finalize` step takes 10–30s — currently the UI just waits. Add a progress modal: *"Running momentum strategy (3/7)... Crunching 8 years of daily prices."* This turns dead time into anticipation.

---

## 3. Depth of simulation

### 3.1 Order types beyond market
- **Limit orders** that sit across turns until filled or expire.
- **Stop-loss** and **trailing stop-loss** — huge teaching moment for risk discipline.
- **SIP (systematic investment plan)** — auto-buy ₹X of fund/stock every N turns. Indians will recognise this immediately.
- Implementation: new `PendingOrder` table checked at the top of `_advance()`.

### 3.2 Margin & leverage (toggle, off by default)
A "pro mode" that allows buying on margin with a realistic interest cost per turn. Optional — but lets the game double as derivatives-lite training.

### 3.3 Dividends & corporate actions
yfinance provides dividend and split history. Apply them at the right dates:
- Credit dividend cash on ex-date
- Adjust `Holding.qty` and `avg_cost` on splits/bonuses
- Show a small "Corporate actions this turn" toast

This is the single biggest realism upgrade — without it, long-horizon total returns are under-counted.

### 3.4 Index & sector ETFs as instruments
NiftyBeES, BankBees, Junior Bees — let players take an "I'll just buy the index" position. Compares nicely against their active picks.

### 3.5 Economic calendar / news headlines
At each turn, surface 1–3 headlines from that date (Budget day, RBI rate hike, earnings season). Starter: static JSON of ~200 pre-written macro events mapped to dates. Later: ingest real historical news. Even static events dramatically increase immersion.
- **Important:** mask specific years in the headline ("RBI raises repo 50 bps" — yes; "October 2022 RBI meeting" — no) to preserve the hidden-period mystery.

### 3.6 Earnings surprise flags
When a stock reports quarterly results in a turn, show a 🟢/🔴 badge in the watchlist with the surprise %. yfinance has this data. Teaches fundamentals-aware trading.

---

## 4. Onboarding & learning

### 4.1 Interactive tutorial (first game)
A 5-minute guided first game: forced universe (10 blue-chips), scripted period (2015–2017 bull run so first experience is positive), tooltips explaining each panel. One-time, skippable.

### 4.2 Strategy explainer mode
On the Results page, each algo's rebalance log is opaque. Add a "Why did Momentum pick SBI in turn 8?" hover — show the 12-1 return ranking snapshot for that turn. Players learn *why* a strategy works, not just that it won.

### 4.3 Glossary sidebar
Hover on any domain term (CAGR, drawdown, beta, STT, LTCG) to get a two-sentence explainer with a link to a deeper article. `frontend/src/lib/glossary.ts` + a single tooltip component.

### 4.4 Post-game coaching report
After results, a paragraph-style summary: *"You were 34% in Financials for most of the game — that sector returned 12% CAGR, helping your result. Your worst decision was selling TCS on turn 14; it rose 22% afterwards. Consider using stop-losses instead of panic sells."*
- Generate rule-based from trade log; later upgrade to an LLM summariser with the Claude API.

---

## 5. Data & content

### 5.1 Multiple starting capitals / difficulty tiers
₹10L (hard, less diversification possible), ₹1 Cr (default), ₹10 Cr (easy, pro mode). Tiers unlock with XP.

### 5.2 Curated scenarios
Alongside random periods, offer hand-picked storylines:
- "The COVID year" (Jan 2020 – Dec 2020)
- "The Modi re-election" (Apr 2019 – Dec 2019)
- "Post-taper-tantrum" (2013–2014)
- "Demonetisation & GST" (Nov 2016 – Jul 2017)
Each with a short briefing (no date reveal — just themes).

### 5.3 Mutual fund category filters
Funds list is flat today. Add category pills: Large Cap / Mid Cap / Small Cap / ELSS / Debt / Hybrid. Pulled from `MutualFund` metadata.

### 5.4 Historical data freshness indicator
Small timestamp in the header: *"Prices as of: 2024-12-15 (last ingested 4 days ago)"*. Builds trust; alerts user if data is stale.

---

## 6. Observability & health (for you, the developer)

### 6.1 Session analytics
Count: games started, games completed, abandonment turn, most-traded stocks, average trade count. Single `Event(kind, game_id, payload, ts)` table. Powers future iteration decisions.

### 6.2 Error boundary in Results page
Algo backtests can fail silently. Wrap each algo run in try/except and surface *partial* results rather than blocking the whole reveal.

### 6.3 Deterministic seed in URL
`/game/abc123?seed=xyz` — lets users share exact games for bug reports and friendly competition.

---

## Suggested priority order (6-week roadmap)

| Week | Ship |
|---|---|
| 1 | Market Mascot, risk dashboard, charges drawer, what-if order preview |
| 2 | Achievements + share-card PNG + streaks |
| 3 | Dividends & splits, limit/stop-loss orders |
| 4 | Daily challenges + ghost replays |
| 5 | Tutorial + glossary + coaching report |
| 6 | SIPs, curated scenarios, keyboard shortcuts, polish pass |

The first two weeks alone would visibly change the product's feel from "simulator" to "game you want to beat today."
