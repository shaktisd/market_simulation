import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface ChartPoint {
  t: number;
  price: number;
}

interface Props {
  points: ChartPoint[];
  color?: string;
  height?: number;
  /** When true, x-axis labels show raw numbers; when false, shown as tN */
  rawX?: boolean;
}

export function PriceChart({ points, color = "#4f8cff", height = 260, rawX = false }: Props) {
  const data = useMemo(() => points.map((p) => ({ t: p.t, price: p.price })), [points]);

  if (!data.length)
    return (
      <div
        className="flex items-center justify-center text-muted text-sm"
        style={{ height }}
      >
        No data
      </div>
    );

  const last = data[data.length - 1].price;
  const first = data[0].price;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = pct >= 0;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#222a38" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: "#8892a6", fontSize: 11 }}
            tickFormatter={(v) => (rawX ? String(v) : `t${v}`)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "#8892a6", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickFormatter={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          />
          <Tooltip
            contentStyle={{
              background: "#11161f",
              border: "1px solid #222a38",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => (rawX ? `t=${v}` : `t${v}`)}
            formatter={(v: number) => [v.toLocaleString("en-IN"), "Price"]}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={up ? "#22c55e" : color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
