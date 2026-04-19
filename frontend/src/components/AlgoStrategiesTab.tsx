import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, type AlgoResults, type AlgoStrategyResult, type GameResult } from "@/lib/api";
import { classPnl, formatDate, inr, num, pct, pctFromRatio } from "@/lib/format";

const STRATEGY_COLORS: Record<string, string> = {
  momentum: "#ef4444",
  value: "#22c55e",
  low_vol: "#3b82f6",
  quality: "#a855f7",
  risk_parity: "#eab308",
  mean_reversion: "#f97316",
  equal_weight_n50: "#14b8a6",
};

const YOU_COLOR = "#4f8cff";

export function AlgoStrategiesTab({
  gameId,
  userResult,
}: {
  gameId: number;
  userResult: GameResult;
}) {
  const [data, setData] = useState<AlgoResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.algoResults(gameId);
        setData(d);
        setEnabled(Object.fromEntries(d.strategies.map((s) => [s.key, true])));
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [gameId]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, any>();
    for (const p of userResult.portfolio_curve) {
      map.set(p.date, { date: p.date, You: p.nav });
    }
    for (const s of data.strategies) {
      if (!enabled[s.key]) continue;
      for (const [d, nav] of s.nav_curve) {
        const row = map.get(d) ?? { date: d };
        row[s.key] = nav;
        map.set(d, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data, userResult, enabled]);

  if (error)
    return (
      <div className="card card-pad text-danger">
        Failed to load algo results: {error}
      </div>
    );
  if (!data) return <div className="p-4 text-muted">Loading algo strategies…</div>;
  if (data.strategies.length === 0)
    return (
      <div className="card card-pad text-muted">
        No algo-strategy results have been computed for this game.
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="card card-pad">
        <div className="text-xs text-muted uppercase tracking-wider mb-1">
          Hedge-fund style strategies
        </div>
        <div className="text-sm text-muted max-w-3xl">
          Each algo below started with the same ₹1 crore you did, invested only in
          Nifty 500 stocks, paid the same brokerage &amp; statutory charges on every
          trade, and rebalanced every 90 days using data available at the time.
          Taxes are not applied on algo NAVs.
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="font-semibold mr-2">You vs the algos</div>
          <Toggle
            label="You"
            color={YOU_COLOR}
            checked
            onChange={() => {}}
            disabled
          />
          {data.strategies.map((s) => (
            <Toggle
              key={s.key}
              label={s.display_name}
              color={STRATEGY_COLORS[s.key] || "#94a3b8"}
              checked={!!enabled[s.key]}
              onChange={() =>
                setEnabled((e) => ({ ...e, [s.key]: !e[s.key] }))
              }
            />
          ))}
        </div>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#222a38" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#8892a6", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-IN", {
                    year: "2-digit",
                    month: "short",
                  })
                }
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
                contentStyle={{
                  background: "#11161f",
                  border: "1px solid #222a38",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => formatDate(String(v))}
                formatter={(v: any) => inr(Number(v), { compact: true })}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="You"
                stroke={YOU_COLOR}
                strokeWidth={3}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {data.strategies.map((s) =>
                enabled[s.key] ? (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.display_name}
                    stroke={STRATEGY_COLORS[s.key] || "#94a3b8"}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-pad border-b border-border font-semibold">
          Strategy leaderboard
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead className="bg-panel2 border-b border-border text-xs text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 w-6"></th>
                <th className="text-left px-3 py-2">Strategy</th>
                <th className="text-right px-3 py-2">Final NAV</th>
                <th className="text-right px-3 py-2">CAGR</th>
                <th className="text-right px-3 py-2">vs You</th>
                <th className="text-right px-3 py-2">Max DD</th>
                <th className="text-right px-3 py-2">Charges</th>
                <th className="text-right px-3 py-2">Holdings</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-panel/50">
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 font-semibold" style={{ color: YOU_COLOR }}>
                  You
                </td>
                <td className="text-right px-3 py-2">{inr(userResult.final_nav)}</td>
                <td className={`text-right px-3 py-2 ${classPnl(userResult.cagr)}`}>
                  {pctFromRatio(userResult.cagr)}
                </td>
                <td className="text-right px-3 py-2 text-muted">—</td>
                <td className="text-right px-3 py-2 text-danger">
                  {pctFromRatio(userResult.max_drawdown)}
                </td>
                <td className="text-right px-3 py-2 text-muted">
                  {inr(userResult.total_charges)}
                </td>
                <td className="text-right px-3 py-2 text-muted">—</td>
              </tr>
              {data.strategies.map((s) => {
                const delta = s.cagr - userResult.cagr;
                const isOpen = expanded === s.key;
                return (
                  <Fragment key={s.key}>
                    <tr
                      className="border-b border-border hover:bg-panel2 cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : s.key)}
                    >
                      <td className="px-3 py-2">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: STRATEGY_COLORS[s.key] || "#94a3b8" }}
                          />
                          <span className="font-medium">{s.display_name}</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-2">{inr(s.final_nav)}</td>
                      <td className={`text-right px-3 py-2 ${classPnl(s.cagr)}`}>
                        {pctFromRatio(s.cagr)}
                      </td>
                      <td className={`text-right px-3 py-2 ${classPnl(-delta)}`}>
                        {delta > 0 ? "+" : ""}
                        {pctFromRatio(delta)}
                      </td>
                      <td className="text-right px-3 py-2 text-danger">
                        {pctFromRatio(s.max_drawdown)}
                      </td>
                      <td className="text-right px-3 py-2 text-muted">
                        {inr(s.total_charges)}
                      </td>
                      <td className="text-right px-3 py-2 text-muted">
                        {s.final_holdings.length}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border bg-panel/30">
                        <td colSpan={8} className="px-4 py-4">
                          <StrategyDetail strategy={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StrategyDetail({ strategy }: { strategy: AlgoStrategyResult }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted max-w-3xl">{strategy.description}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-muted uppercase tracking-wider mb-2">
            Final holdings ({strategy.final_holdings.length})
          </div>
          <div className="max-h-72 overflow-y-auto border border-border rounded">
            <table className="w-full text-xs tabular">
              <thead className="bg-panel2 sticky top-0 text-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-2 py-1.5">Symbol</th>
                  <th className="text-right px-2 py-1.5">Qty</th>
                  <th className="text-right px-2 py-1.5">Price</th>
                  <th className="text-right px-2 py-1.5">Value</th>
                  <th className="text-right px-2 py-1.5">Wt%</th>
                </tr>
              </thead>
              <tbody>
                {strategy.final_holdings.map((h) => (
                  <tr key={h.symbol} className="border-t border-border">
                    <td className="px-2 py-1">
                      <div className="font-medium">{h.symbol}</div>
                      <div className="text-muted truncate max-w-[180px]">{h.name}</div>
                    </td>
                    <td className="text-right px-2 py-1">{num(h.qty, 0)}</td>
                    <td className="text-right px-2 py-1">{inr(h.last_price)}</td>
                    <td className="text-right px-2 py-1">{inr(h.market_value, { compact: true })}</td>
                    <td className="text-right px-2 py-1">{pct(h.weight * 100, 1)}</td>
                  </tr>
                ))}
                {strategy.final_holdings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-muted">
                      No open positions at game end.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase tracking-wider mb-2">
            Rebalance log ({strategy.rebalance_log.length})
          </div>
          <div className="max-h-72 overflow-y-auto border border-border rounded">
            <table className="w-full text-xs tabular">
              <thead className="bg-panel2 sticky top-0 text-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-right px-2 py-1.5">Trades</th>
                  <th className="text-right px-2 py-1.5">Charges</th>
                  <th className="text-right px-2 py-1.5">Basket</th>
                </tr>
              </thead>
              <tbody>
                {strategy.rebalance_log.map((r) => (
                  <tr key={r.date} className="border-t border-border">
                    <td className="px-2 py-1">{formatDate(r.date)}</td>
                    <td className="text-right px-2 py-1">{r.trades}</td>
                    <td className="text-right px-2 py-1 text-muted">{inr(r.charges)}</td>
                    <td className="text-right px-2 py-1 text-muted">{r.symbols.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  color,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  color: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-1.5 text-xs select-none ${disabled ? "opacity-80" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="accent-accent"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className={checked ? "" : "text-muted"}>{label}</span>
    </label>
  );
}
