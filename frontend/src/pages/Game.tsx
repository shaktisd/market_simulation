import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Flag, Loader2 } from "lucide-react";
import { api, type GameState, type InstrumentType, type Portfolio, type PriceWindow } from "@/lib/api";
import { classPnl, inr, pct } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { WatchlistTable } from "@/components/WatchlistTable";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { SectorPanel } from "@/components/SectorPanel";
import { OrderDialog } from "@/components/OrderDialog";
import { CompositionPanel } from "@/components/CompositionPanel";
import { TurnAnalyticsPanel } from "@/components/TurnAnalytics";
import { NavCurve } from "@/components/NavCurve";
import { MarketMascot } from "@/components/MarketMascot";
import { RiskDashboard } from "@/components/RiskDashboard";

export function Game() {
  const { gameId } = useParams<{ gameId: string }>();
  const id = Number(gameId);
  const navigate = useNavigate();
  const [state, setState] = useState<GameState | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [tab, setTab] = useState<InstrumentType | "holdings">("stock");
  const [selected, setSelected] = useState<{ type: InstrumentType; symbol: string } | null>(null);
  const [detail, setDetail] = useState<PriceWindow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [progressPhase, setProgressPhase] = useState<"advancing" | "finalizing" | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const [bump, setBump] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    const [s, p] = await Promise.all([api.state(id), api.portfolio(id)]);
    setState(s);
    setPortfolio(p);
    if (s.ended) navigate(`/game/${id}/results`, { replace: true });
  }, [id, navigate]);

  useEffect(() => {
    refreshState().catch((e) => setError(e.message));
  }, [refreshState]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    setDetail(null);
    (async () => {
      try {
        const d =
          selected.type === "stock"
            ? await api.stockDetail(id, selected.symbol)
            : await api.fundDetail(id, selected.symbol);
        if (!cancelled) setDetail(d);
      } catch (e: any) {
        if (!cancelled) setDetailError(extractDetailMessage(e));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, selected, bump]);

  const startProgress = () => {
    setProgressPhase("advancing");
    if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      setProgressPhase("finalizing");
    }, 1500);
  };

  const stopProgress = () => {
    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressPhase(null);
  };

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    };
  }, []);

  const advance = async () => {
    setAdvancing(true);
    startProgress();
    try {
      const s = await api.next(id);
      setState(s);
      setBump((b) => b + 1);
      setSelected(null);
      if (s.ended) {
        navigate(`/game/${id}/results`);
        return;
      }
      const p = await api.portfolio(id);
      setPortfolio(p);
    } catch (e: any) {
      setError(e.message);
    } finally {
      stopProgress();
      setAdvancing(false);
    }
  };

  const endNow = async () => {
    if (!confirm("End the game now and reveal the period? You cannot resume."))
      return;
    setAdvancing(true);
    setProgressPhase("finalizing");
    try {
      await api.endNow(id);
      navigate(`/game/${id}/results`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      stopProgress();
      setAdvancing(false);
    }
  };

  const selectedHoldingQty = useMemo(() => {
    if (!portfolio || !selected) return 0;
    const h = portfolio.holdings.find(
      (h) => h.instrument_type === selected.type && h.symbol === selected.symbol,
    );
    return h?.quantity || 0;
  }, [portfolio, selected]);

  if (error)
    return (
      <div className="max-w-xl mx-auto p-8 text-sm">
        <div className="card card-pad text-danger">{error}</div>
      </div>
    );
  if (!state) return <div className="p-8 text-muted">Loading game…</div>;

  const pnl = state.nav - 1_00_00_000;
  const pnlPct = (pnl / 1_00_00_000) * 100;

  return (
    <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 py-4">
      {/* Top bar */}
      <div className="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="shrink-0">
            <div className="text-xs text-muted">Turn</div>
            <div className="font-semibold tabular">#{state.turn_index}</div>
          </div>
          <div className="shrink-0">
            <div className="text-xs text-muted">Step</div>
            <div className="font-medium capitalize">{state.step_unit}</div>
          </div>
          <div className="shrink-0">
            <div className="text-xs text-muted">Cash</div>
            <div className="font-semibold tabular">{inr(state.cash, { compact: true })}</div>
          </div>
          <div className="shrink-0">
            <div className="text-xs text-muted">Holdings</div>
            <div className="font-semibold tabular">{inr(state.holdings_mv, { compact: true })}</div>
          </div>
          <div className="shrink-0">
            <div className="text-xs text-muted">NAV</div>
            <div className="font-bold text-lg tabular">{inr(state.nav, { compact: true })}</div>
          </div>
          <div className="shrink-0">
            <div className="text-xs text-muted">P&L</div>
            <div className={`font-semibold tabular ${classPnl(pnl)}`}>
              {inr(pnl, { compact: true })} ({pct(pnlPct)})
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={endNow} disabled={advancing}>
            <Flag size={14} /> End
          </button>
          <button className="btn-primary" onClick={advance} disabled={advancing}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <RiskDashboard gameId={id} refreshKey={bump} />

      {/* Main 3-pane layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: watchlist */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-[400px] lg:h-[calc(100vh-200px)]">
          <div className="flex gap-1 text-sm">
            {(["stock", "mf", "holdings"] as const).map((t) => (
              <button
                key={t}
                className={`btn flex-1 ${tab === t ? "bg-panel2 border border-border" : "text-muted hover:text-text"}`}
                onClick={() => setTab(t)}
              >
                {t === "stock" ? "Stocks" : t === "mf" ? "Mutual Funds" : "Holdings"}
              </button>
            ))}
          </div>
          {tab === "stock" && (
            <WatchlistTable
              gameId={id}
              instrumentType="stock"
              onSelect={(s) => setSelected({ type: "stock", symbol: s })}
              selectedSymbol={selected?.type === "stock" ? selected.symbol : undefined}
            />
          )}
          {tab === "mf" && (
            <WatchlistTable
              gameId={id}
              instrumentType="mf"
              onSelect={(s) => setSelected({ type: "mf", symbol: s })}
              selectedSymbol={selected?.type === "mf" ? selected.symbol : undefined}
            />
          )}
          {tab === "holdings" && (
            <PortfolioPanel
              portfolio={portfolio}
              onSelect={(t, s) => setSelected({ type: t, symbol: s })}
            />
          )}
        </div>

        {/* Center: detail */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {!selected && (
            <div className="flex flex-col gap-4">
              <NavCurve gameId={id} refreshKey={bump} variant="hero" />
              <TurnAnalyticsPanel gameId={id} refreshKey={bump} />
              <CompositionPanel gameId={id} refreshKey={bump} />
              <div className="text-xs text-muted text-center">
                Select a stock or mutual fund from the list to see its trailing price chart and
                place orders.
              </div>
            </div>
          )}
          {selected && (
            <div className="card overflow-hidden">
              <div className="card-pad border-b border-border flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted uppercase tracking-wider">
                    {selected.type === "stock" ? detail?.sector || "Stock" : detail?.sector || "Mutual Fund"}
                  </div>
                  <div className="font-semibold text-lg truncate">{detail?.name ?? selected.symbol}</div>
                  <div className="text-xs text-muted">
                    {selected.type === "stock" ? selected.symbol : `Scheme ${selected.symbol}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">Last</div>
                  <div className="font-semibold tabular text-lg">
                    {detail ? inr(detail.last_price) : "…"}
                  </div>
                </div>
              </div>
              <div className="p-3">
                {loadingDetail ? (
                  <div className="h-[260px] flex items-center justify-center text-muted text-sm">
                    Loading price history…
                  </div>
                ) : detailError ? (
                  <div className="h-[260px] flex flex-col items-center justify-center text-center px-6 gap-3">
                    <div className="text-warn text-sm font-medium">
                      No data available for this {selected.type === "stock" ? "stock" : "fund"}
                    </div>
                    <div className="text-xs text-muted max-w-md">{detailError}</div>
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => setSelected(null)}
                    >
                      Back to portfolio
                    </button>
                  </div>
                ) : (
                  <PriceChart points={detail?.points ?? []} />
                )}
              </div>
              {detail?.fundamentals && (
                <div className="grid grid-cols-4 gap-2 px-4 pb-4 text-xs tabular">
                  <Fact label="P/E" value={detail.fundamentals.pe} digits={2} />
                  <Fact label="P/B" value={detail.fundamentals.pb} digits={2} />
                  <Fact label="EPS" value={detail.fundamentals.eps} digits={2} />
                  <Fact
                    label="Mkt cap"
                    value={detail.fundamentals.market_cap}
                    compact
                  />
                </div>
              )}
              <div className="p-3 border-t border-border flex gap-2">
                <button
                  className="btn-success flex-1"
                  onClick={() => setOrderOpen(true)}
                  disabled={!detail || !!detailError}
                >
                  Buy / Sell
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: market context + portfolio analytics */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {selected && (
            <>
              <NavCurve gameId={id} refreshKey={bump} />
              <TurnAnalyticsPanel gameId={id} refreshKey={bump} />
              <CompositionPanel gameId={id} refreshKey={bump} />
            </>
          )}
          <SectorPanel gameId={id} refreshKey={bump} />
        </div>
      </div>

      {progressPhase && <ProgressOverlay phase={progressPhase} />}

      <MarketMascot gameId={id} refreshKey={bump} state={state} portfolio={portfolio} />

      {selected && detail && (
        <OrderDialog
          open={orderOpen}
          onClose={() => setOrderOpen(false)}
          gameId={id}
          instrumentType={selected.type}
          symbol={selected.symbol}
          name={detail.name}
          lastPrice={detail.last_price}
          cashAvailable={state.cash}
          navTotal={state.nav}
          quantityHeld={selectedHoldingQty}
          holdings={portfolio?.holdings ?? []}
          instrumentSector={detail.sector}
          onExecuted={async () => {
            await refreshState();
            setBump((b) => b + 1);
          }}
        />
      )}
    </div>
  );
}

function ProgressOverlay({ phase }: { phase: "advancing" | "finalizing" }) {
  const isFinalizing = phase === "finalizing";
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card card-pad max-w-md w-full text-center flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-accent" size={36} />
        <div className="font-semibold text-lg">
          {isFinalizing ? "Finalizing game…" : "Advancing turn…"}
        </div>
        <div className="text-sm text-muted leading-relaxed">
          {isFinalizing ? (
            <>
              Running algo benchmarks (momentum, value, quality, low-vol, mean-reversion, risk-parity, equal-weight)
              and computing NIFTY50 / NIFTY500 / FD comparisons over the full game window.
              <div className="mt-2 text-xs">This can take 10–30 seconds — please don't close the tab.</div>
            </>
          ) : (
            "Stepping to the next trading window and revaluing your portfolio."
          )}
        </div>
      </div>
    </div>
  );
}

function extractDetailMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Strip the "METHOD /path failed (status): " prefix added by the api wrapper
  const m = raw.match(/failed \(\d+\):\s*(.*)$/s);
  return (m ? m[1] : raw).trim();
}

function Fact({
  label,
  value,
  digits = 2,
  compact = false,
}: {
  label: string;
  value: number | null | undefined;
  digits?: number;
  compact?: boolean;
}) {
  const display =
    value == null
      ? "—"
      : compact
        ? inr(value, { compact: true })
        : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
  return (
    <div className="bg-panel2 border border-border rounded p-2">
      <div className="text-muted">{label}</div>
      <div className="font-medium">{display}</div>
    </div>
  );
}
