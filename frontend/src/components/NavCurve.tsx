import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { api, type NavHistory } from "@/lib/api";
import { classPnl, inr, pct } from "@/lib/format";

interface Props {
  gameId: number;
  refreshKey: number;
  variant?: "compact" | "hero";
}

export function NavCurve({ gameId, refreshKey, variant = "compact" }: Props) {
  const chartHeight = variant === "hero" ? 320 : 180;
  const [data, setData] = useState<NavHistory | null>(null);

  useEffect(() => {
    let mounted = true;
    api.navHistory(gameId).then((d) => mounted && setData(d)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  const summary = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const last = data.points[data.points.length - 1];
    const start = data.starting_nav;
    const peak = Math.max(...data.points.map((p) => p.nav));
    const trough = Math.min(...data.points.map((p) => p.nav));
    return {
      last: last.nav,
      delta: last.nav - start,
      pct: ((last.nav - start) / start) * 100,
      peak,
      trough,
      drawdownFromPeak: ((last.nav - peak) / peak) * 100,
    };
  }, [data]);

  if (!data)
    return (
      <div className="card card-pad text-xs text-muted">Loading NAV history…</div>
    );

  if (data.points.length === 0)
    return (
      <div className="card card-pad text-xs text-muted">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp size={14} />
          <span className="uppercase tracking-wider">Portfolio history</span>
        </div>
        Start playing to build a history.
      </div>
    );

  const chartData = data.points.map((p) => ({
    turn: p.turn,
    nav: p.nav,
    cash: p.cash,
    invested: p.holdings_mv,
  }));
  const up = (summary?.delta ?? 0) >= 0;
  const lineColor = up ? "#22c55e" : "#ef4444";

  return (
    <div className="card overflow-hidden">
      <div className="card-pad border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 text-xs text-muted uppercase tracking-wider">
            <TrendingUp size={14} />
            Portfolio history
          </div>
          <span className="text-[10px] text-muted">{data.points.length} turns</span>
        </div>
        {summary && (
          <>
            <div className="text-xl font-bold tabular">
              {inr(summary.last, { compact: true })}
            </div>
            <div className={`text-xs tabular ${classPnl(summary.delta)}`}>
              {summary.delta >= 0 ? "+" : ""}
              {inr(summary.delta, { compact: true })} ({pct(summary.pct)})
              <span className="text-muted ml-1">since start</span>
            </div>
          </>
        )}
      </div>

      <div className="px-1 py-2" style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#222a38" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="turn"
              tick={{ fill: "#8892a6", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "#8892a6", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={50}
              tickFormatter={(v) => inr(Number(v), { compact: true })}
            />
            <Tooltip
              contentStyle={{
                background: "#11161f",
                border: "1px solid #222a38",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(v) => `Turn #${v}`}
              formatter={(v: any, key: string) => [inr(Number(v), { compact: true }), key]}
            />
            <ReferenceLine
              y={data.starting_nav}
              stroke="#8892a6"
              strokeDasharray="3 3"
              label={{ value: "Start", position: "insideTopLeft", fill: "#8892a6", fontSize: 9 }}
            />
            <Area
              type="monotone"
              dataKey="nav"
              stroke="none"
              fill="url(#navFill)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="nav"
              name="NAV"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {summary && (
        <div className="px-4 pb-3 grid grid-cols-3 gap-2 text-[11px] tabular">
          <Stat label="Peak" value={inr(summary.peak, { compact: true })} />
          <Stat label="Trough" value={inr(summary.trough, { compact: true })} />
          <Stat
            label="From peak"
            value={pct(summary.drawdownFromPeak)}
            cls={summary.drawdownFromPeak < 0 ? "text-danger" : "text-text"}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className={`font-medium ${cls}`}>{value}</div>
    </div>
  );
}
