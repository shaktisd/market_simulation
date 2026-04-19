import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { api, type GameResult } from "@/lib/api";
import { AlgoStrategiesTab } from "@/components/AlgoStrategiesTab";
import { classPnl, formatDate, inr, num, pct, pctFromRatio } from "@/lib/format";

type TabKey = "overview" | "algos";

export function Results() {
  const { gameId } = useParams<{ gameId: string }>();
  const id = Number(gameId);
  const [result, setResult] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  useEffect(() => {
    (async () => {
      try {
        setResult(await api.result(id));
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [id]);

  if (error)
    return (
      <div className="max-w-xl mx-auto p-8">
        <div className="card card-pad text-danger">{error}</div>
      </div>
    );
  if (!result) return <div className="p-8 text-muted">Loading results…</div>;

  const chartData = mergeCurves(result);
  const startNav = 1_00_00_000;
  const pnl = result.final_nav - startNav;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="card card-pad mb-6 bg-gradient-to-br from-panel to-panel2">
        <div className="text-xs text-muted uppercase tracking-wider mb-2">The Reveal</div>
        <div className="text-2xl sm:text-3xl font-semibold mb-1">
          You played from{" "}
          <span className="text-accent">{formatDate(result.revealed_start_date)}</span> to{" "}
          <span className="text-accent">{formatDate(result.revealed_end_date)}</span>
        </div>
        <div className="text-muted text-sm">
          {result.months_played} months of Indian market history
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-border">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "algos"} onClick={() => setTab("algos")}>
          Algo Strategies
        </TabButton>
      </div>

      {tab === "algos" ? (
        <AlgoStrategiesTab gameId={id} userResult={result} />
      ) : (
        <OverviewTab result={result} chartData={chartData} pnl={pnl} startNav={startNav} />
      )}

      <div className="flex flex-wrap gap-2 mt-6">
        <Link to="/" className="btn-primary">Play again</Link>
        <Link to="/history" className="btn-ghost">See past runs</Link>
      </div>

      <p className="text-xs text-muted mt-6 max-w-3xl">
        Note: the Nifty 500 universe used for trading is the <em>current</em> constituent list
        applied across all historical periods. This introduces mild survivorship bias vs.
        true reality. Fundamentals shown during play are best-effort snapshots and may not
        reflect point-in-time values. Algo strategies rebalance every 90 days, pay the same
        charges you do, and are shown gross of capital-gains tax.
      </p>
    </div>
  );
}

function OverviewTab({
  result,
  chartData,
  pnl,
  startNav,
}: {
  result: GameResult;
  chartData: any[];
  pnl: number;
  startNav: number;
}) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Metric label="Final NAV" value={inr(result.final_nav)} strong />
        <Metric
          label="Total P&L"
          value={`${inr(pnl)} (${pct((pnl / startNav) * 100)})`}
          className={classPnl(pnl)}
        />
        <Metric label="CAGR" value={pctFromRatio(result.cagr)} className={classPnl(result.cagr)} />
        <Metric
          label="Max Drawdown"
          value={pctFromRatio(result.max_drawdown)}
          className="text-danger"
        />
        <Metric label="Charges paid" value={inr(result.total_charges)} />
        <Metric label="Taxes paid" value={inr(result.total_taxes)} />
        <Metric label="Trades" value={String(result.trade_log.length)} />
        <Metric
          label="vs Nifty 50"
          value={
            result.benchmarks.nifty50_cagr != null
              ? `${pctFromRatio(result.cagr - result.benchmarks.nifty50_cagr)} CAGR`
              : "—"
          }
          className={classPnl((result.cagr - (result.benchmarks.nifty50_cagr || 0)))}
        />
      </div>

      <div className="card card-pad mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Portfolio vs benchmarks</div>
          <div className="flex gap-4 text-xs tabular">
            <Bench label="You" value={pctFromRatio(result.cagr)} color="#4f8cff" />
            <Bench label="Nifty 50" value={pctFromRatio(result.benchmarks.nifty50_cagr)} color="#22c55e" />
            <Bench label="Nifty 500" value={pctFromRatio(result.benchmarks.nifty500_cagr)} color="#f59e0b" />
            <Bench label="FD 7%" value={pctFromRatio(result.benchmarks.fd_cagr)} color="#c084fc" />
          </div>
        </div>
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#222a38" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#8892a6", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                tickFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { year: "2-digit", month: "short" })}
              />
              <YAxis
                domain={["dataMin", "dataMax"]}
                tick={{ fill: "#8892a6", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
                tickFormatter={(v) => inr(Number(v), { compact: true })}
              />
              <Tooltip
                contentStyle={{ background: "#11161f", border: "1px solid #222a38", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => formatDate(String(v))}
                formatter={(v: any) => inr(Number(v), { compact: true })}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="NIFTY50" stroke="#22c55e" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="NIFTY500" stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="FD_7PCT" stroke="#c084fc" dot={false} strokeDasharray="5 3" strokeWidth={2} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="You" stroke="#4f8cff" dot={false} strokeWidth={3} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-hidden mb-6">
        <div className="card-pad border-b border-border font-semibold">Trade log</div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm tabular">
            <thead className="bg-panel2 border-b border-border text-xs text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Instrument</th>
                <th className="text-left px-3 py-2">Side</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">Gross</th>
                <th className="text-right px-3 py-2">Charges</th>
                <th className="text-right px-3 py-2">Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {result.trade_log.map((t, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-3 py-1.5 text-muted">{formatDate(t.date)}</td>
                  <td className="px-3 py-1.5">
                    <div className="truncate max-w-[220px]">{t.name}</div>
                    <div className="text-xs text-muted">{t.symbol}</div>
                  </td>
                  <td className={`px-3 py-1.5 font-medium ${t.side === "BUY" ? "text-success" : "text-danger"}`}>
                    {t.side}
                  </td>
                  <td className="text-right px-3 py-1.5">
                    {num(t.quantity, t.instrument_type === "stock" ? 0 : 4)}
                  </td>
                  <td className="text-right px-3 py-1.5">{inr(t.price)}</td>
                  <td className="text-right px-3 py-1.5">{inr(t.gross)}</td>
                  <td className="text-right px-3 py-1.5 text-muted">{inr(t.charges)}</td>
                  <td className={`text-right px-3 py-1.5 ${classPnl(t.realized_pnl)}`}>
                    {t.side === "SELL" ? inr(t.realized_pnl) : "—"}
                  </td>
                </tr>
              ))}
              {result.trade_log.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
                    No trades placed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-accent text-accent"
          : "border-transparent text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function mergeCurves(r: GameResult): any[] {
  const map = new Map<string, any>();
  const push = (key: string, arr: { date: string; nav: number }[]) => {
    for (const p of arr) {
      const row = map.get(p.date) ?? { date: p.date };
      row[key] = p.nav;
      map.set(p.date, row);
    }
  };
  push("You", r.portfolio_curve);
  for (const [name, arr] of Object.entries(r.benchmark_curves)) push(name, arr);
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function Metric({
  label,
  value,
  className = "",
  strong = false,
}: {
  label: string;
  value: string;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div className="card card-pad">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`${strong ? "text-xl font-bold" : "font-semibold"} tabular ${className}`}>
        {value}
      </div>
    </div>
  );
}

function Bench({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
