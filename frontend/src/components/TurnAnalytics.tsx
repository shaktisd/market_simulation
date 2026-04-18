import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { api, type TurnAnalytics } from "@/lib/api";
import { classPnl, inr, num, pct } from "@/lib/format";

interface Props {
  gameId: number;
  refreshKey: number;
}

export function TurnAnalyticsPanel({ gameId, refreshKey }: Props) {
  const [data, setData] = useState<TurnAnalytics | null>(null);

  useEffect(() => {
    let mounted = true;
    api.turnAnalytics(gameId).then((d) => mounted && setData(d)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  if (!data || !data.has_previous)
    return (
      <div className="card card-pad text-xs text-muted">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp size={14} />
          <span className="uppercase tracking-wider">Turn analytics</span>
        </div>
        Make a move to see how the market shifts.
      </div>
    );

  const up = data.nav_delta >= 0;

  return (
    <div className="card overflow-hidden">
      <div className="card-pad border-b border-border">
        <div className="text-xs text-muted uppercase tracking-wider mb-1">
          This turn (#{data.turn_index})
        </div>
        <div className={`text-xl font-bold tabular ${classPnl(data.nav_delta)}`}>
          {up ? "+" : ""}{inr(data.nav_delta)}
          <span className="text-sm font-medium ml-2">{pct(data.nav_delta_pct)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-xs tabular">
          <Mini label="Holdings Δ" value={inr(data.holdings_delta, { compact: true })} cls={classPnl(data.holdings_delta)} />
          <Mini label="Cash Δ" value={inr(data.cash_delta, { compact: true })} cls={classPnl(data.cash_delta)} />
          <Mini label="Net invested" value={inr(data.net_invested_change, { compact: true })} />
        </div>
      </div>

      {(data.top_gainers.length > 0 || data.top_losers.length > 0) && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Movers title="Top contributors" arrow="up" items={data.top_gainers} />
          <Movers title="Top detractors" arrow="down" items={data.top_losers} />
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className={`font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function Movers({
  title,
  arrow,
  items,
}: {
  title: string;
  arrow: "up" | "down";
  items: TurnAnalytics["top_gainers"];
}) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
        {arrow === "up" ? <ArrowUp size={12} className="text-success" /> : <ArrowDown size={12} className="text-danger" />}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted">—</div>
      ) : (
        <div className="space-y-1">
          {items.map((m) => (
            <div key={`${m.instrument_type}:${m.symbol}`} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{m.name}</span>
                <span className={`tabular ${classPnl(m.contribution)}`}>
                  {inr(m.contribution, { compact: true })}
                </span>
              </div>
              <div className="text-muted tabular">
                {num(m.quantity, m.instrument_type === "stock" ? 0 : 4)} ·{" "}
                {pct(m.pct_change)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
