const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch (e: any) {
    // Network-level failure: server unreachable, CORS, DNS, offline, aborted, etc.
    const cause = e?.message || String(e);
    console.error(`[api] ${method} ${url} — network error:`, e);
    throw new Error(
      `Network error calling ${method} ${url}: ${cause}. ` +
        `Check that the backend is running and reachable.`,
    );
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch (e) {
      console.error(`[api] ${method} ${url} — failed to read error body:`, e);
    }
    let detail: unknown = text;
    try {
      detail = JSON.parse(text)?.detail ?? text;
    } catch {
      /* body wasn't JSON */
    }
    const message =
      typeof detail === "string" && detail.length > 0
        ? detail
        : `${res.status} ${res.statusText}`;
    console.error(
      `[api] ${method} ${url} — HTTP ${res.status} ${res.statusText}:`,
      detail,
    );
    throw new Error(`${method} ${path} failed (${res.status}): ${message}`);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (e: any) {
    console.error(`[api] ${method} ${url} — invalid JSON response:`, e);
    throw new Error(`Invalid JSON response from ${method} ${path}: ${e?.message || e}`);
  }
}

export type StepUnit = "day" | "week" | "month";
export type InstrumentType = "stock" | "mf";
export type Side = "BUY" | "SELL";

export interface GameState {
  game_id: number;
  turn_index: number;
  step_unit: StepUnit;
  cash: number;
  holdings_mv: number;
  nav: number;
  status: string;
  ended: boolean;
}

export interface PricePoint { t: number; price: number; }

export interface PriceWindow {
  symbol: string;
  name: string;
  instrument_type: InstrumentType;
  sector: string | null;
  points: PricePoint[];
  last_price: number;
  fundamentals: Record<string, number | null> | null;
}

export interface InstrumentInfo {
  symbol: string;
  name: string;
  sector: string | null;
  last_price: number | null;
  change_pct_1m: number | null;
  change_pct_6m: number | null;
  change_pct_12m: number | null;
}

export interface NavHistoryPoint {
  turn: number;
  nav: number;
  cash: number;
  holdings_mv: number;
}

export interface NavHistory {
  starting_nav: number;
  points: NavHistoryPoint[];
}

export interface HoldingOut {
  instrument_type: InstrumentType;
  symbol: string;
  name: string;
  quantity: number;
  avg_cost: number;
  last_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
}

export interface Portfolio {
  cash: number;
  holdings_mv: number;
  nav: number;
  holdings: HoldingOut[];
}

export interface SectorRow { sector: string; change_pct: number; count: number; }

export interface ChargeBreakdown {
  brokerage: number; stt: number; exchange: number; sebi: number;
  stamp_duty: number; gst: number; dp_charges: number; total: number;
}

export interface OrderResponse {
  order_id: number;
  price: number;
  quantity: number;
  gross: number;
  charges: ChargeBreakdown;
  net_cashflow: number;
  cash_after: number;
}

export type OrderMode = "qty" | "weight" | "value";

export interface CompositionSlice { label: string; value: number; weight: number; }
export interface Composition {
  nav: number;
  by_asset_class: CompositionSlice[];
  by_sector: CompositionSlice[];
}

export interface HoldingMover {
  instrument_type: InstrumentType;
  symbol: string;
  name: string;
  quantity: number;
  prev_price: number | null;
  curr_price: number;
  contribution: number;
  pct_change: number | null;
}

export interface TurnAnalytics {
  turn_index: number;
  has_previous: boolean;
  nav_now: number;
  nav_prev: number | null;
  nav_delta: number;
  nav_delta_pct: number | null;
  holdings_delta: number;
  cash_delta: number;
  net_invested_change: number;
  top_gainers: HoldingMover[];
  top_losers: HoldingMover[];
}

export interface RiskMetrics {
  volatility_ann: number | null;
  beta: number | null;
  drawdown: number | null;
  hhi: number | null;
  sharpe: number | null;
  turns_observed: number;
}

export interface GameResult {
  game_id: number;
  revealed_start_date: string;
  revealed_end_date: string;
  months_played: number;
  final_nav: number;
  cagr: number;
  max_drawdown: number;
  total_charges: number;
  total_taxes: number;
  benchmarks: { nifty50_cagr: number | null; nifty500_cagr: number | null; fd_cagr: number | null };
  portfolio_curve: { date: string; nav: number }[];
  benchmark_curves: Record<string, { date: string; nav: number }[]>;
  trade_log: any[];
}

export interface BenchmarkSeries { name: string; points: PricePoint[]; }

export interface AlgoHolding {
  symbol: string;
  name: string;
  qty: number;
  avg_cost: number;
  last_price: number;
  market_value: number;
  weight: number;
}

export interface AlgoRebalanceEntry {
  date: string;
  trades: number;
  charges: number;
  symbols: string[];
}

export interface AlgoStrategyResult {
  key: string;
  display_name: string;
  description: string;
  final_nav: number;
  cagr: number;
  max_drawdown: number;
  total_charges: number;
  nav_curve: [string, number][];
  final_holdings: AlgoHolding[];
  rebalance_log: AlgoRebalanceEntry[];
}

export interface AlgoResults {
  game_id: number;
  starting_nav: number;
  strategies: AlgoStrategyResult[];
}

export const api = {
  startGame: (step_unit: StepUnit) =>
    req<GameState>(`/game/start`, { method: "POST", body: JSON.stringify({ step_unit }) }),
  state: (id: number) => req<GameState>(`/game/${id}/state`),
  next: (id: number) => req<GameState>(`/game/${id}/next`, { method: "POST" }),
  endNow: (id: number) => req<GameState>(`/game/${id}/end`, { method: "POST" }),
  portfolio: (id: number) => req<Portfolio>(`/game/${id}/portfolio`),
  listStocks: (id: number, opts: { sector?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.sector) p.set("sector", opts.sector);
    if (opts.q) p.set("q", opts.q);
    if (opts.limit) p.set("limit", String(opts.limit));
    return req<InstrumentInfo[]>(`/game/${id}/market/stocks?${p}`);
  },
  stockDetail: (id: number, symbol: string, lookback = 365) =>
    req<PriceWindow>(`/game/${id}/market/stocks/${encodeURIComponent(symbol)}?lookback_days=${lookback}`),
  listFunds: (id: number, opts: { category?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.category) p.set("category", opts.category);
    if (opts.q) p.set("q", opts.q);
    if (opts.limit) p.set("limit", String(opts.limit));
    return req<InstrumentInfo[]>(`/game/${id}/market/funds?${p}`);
  },
  fundDetail: (id: number, code: string, lookback = 365) =>
    req<PriceWindow>(`/game/${id}/market/funds/${code}?lookback_days=${lookback}`),
  sectors: (id: number, lookback = 30) =>
    req<SectorRow[]>(`/game/${id}/market/sectors?lookback_days=${lookback}`),
  benchmarks: (id: number, lookback = 365) =>
    req<BenchmarkSeries[]>(`/game/${id}/market/benchmarks?lookback_days=${lookback}`),
  stockSectors: (id: number) => req<string[]>(`/game/${id}/market/stock-sectors`),
  mfCategories: (id: number) => req<string[]>(`/game/${id}/market/mf-categories`),
  placeOrder: (
    id: number,
    payload: {
      instrument_type: InstrumentType;
      symbol: string;
      side: Side;
      value: number;
      mode: OrderMode;
    },
  ) => req<OrderResponse>(`/game/${id}/orders`, { method: "POST", body: JSON.stringify(payload) }),
  composition: (id: number) => req<Composition>(`/game/${id}/composition`),
  turnAnalytics: (id: number) => req<TurnAnalytics>(`/game/${id}/turn-analytics`),
  navHistory: (id: number) => req<NavHistory>(`/game/${id}/nav-history`),
  riskMetrics: (id: number) => req<RiskMetrics>(`/game/${id}/risk-metrics`),
  result: (id: number) => req<GameResult>(`/game/${id}/result`),
  algoResults: (id: number) => req<AlgoResults>(`/game/${id}/algo-results`),
  algoResultsLive: (id: number) => req<AlgoResults>(`/game/${id}/algo-results-live`),
  history: () => req<any[]>(`/history`),
};
