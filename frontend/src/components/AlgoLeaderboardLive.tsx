import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { api, type AlgoResults, type AlgoStrategyResult } from "@/lib/api";
import { classPnl, inr, pct } from "@/lib/format";

interface Props {
  gameId: number;
  refreshKey: number;
  userNav?: number;
  startingNav?: number;
}

interface Row {
  key: string;
  name: string;
  nav: number;
  curve: number[];
  isUser: boolean;
}

export function AlgoLeaderboardLive({ gameId, refreshKey, userNav, startingNav }: Props) {
  const [data, setData] = useState<AlgoResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    api
      .algoResultsLive(gameId)
      .then((d) => mounted && setData(d))
      .catch((e) => mounted && setError(e.message));
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  const start = startingNav ?? data?.starting_nav ?? 0;

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const algoRows: Row[] = data.strategies.map((s: AlgoStrategyResult) => ({
      key: s.key,
      name: s.display_name,
      nav: s.final_nav,
      curve: s.nav_curve.map(([, n]) => Number(n)),
      isUser: false,
    }));
    const userRow: Row | null =
      userNav != null
        ? {
            key: "__user__",
            name: "You",
            nav: userNav,
            curve: [],
            isUser: true,
          }
        : null;
    const all = userRow ? [userRow, ...algoRows] : algoRows;
    return all.sort((a, b) => b.nav - a.nav);
  }, [data, userNav]);

  const turnsObserved = useMemo(() => {
    if (!data || data.strategies.length === 0) return 0;
    return Math.max(...data.strategies.map((s) => s.nav_curve.length));
  }, [data]);

  if (error)
    return (
      <div className="card card-pad text-xs text-danger">Live leaderboard: {error}</div>
    );

  if (!data)
    return (
      <div className="card card-pad text-xs text-muted">Loading algo leaderboard…</div>
    );

  const warming = turnsObserved < 2;

  return (
    <div className="card overflow-hidden">
      <div className="card-pad border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted uppercase tracking-wider">
            <Trophy size={14} />
            Algo leaderboard
          </div>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${
              warming
                ? "border-warn/40 text-warn"
                : "border-success/40 text-success"
            }`}
          >
            {warming ? "warming up…" : "live"}
          </span>
        </div>
        <div className="text-[11px] text-muted mt-0.5">
          Full breakdown at game end.
        </div>
      </div>
      {warming ? (
        <div className="card-pad text-xs text-muted">
          Advance a couple of turns to rank bots against your portfolio.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((r, idx) => {
            const delta = r.nav - start;
            const deltaPct = start > 0 ? (delta / start) * 100 : 0;
            return (
              <div
                key={r.key}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                  r.isUser ? "bg-panel2" : ""
                }`}
              >
                <div className="w-5 text-muted tabular">{idx + 1}</div>
                <div className="flex-1 min-w-0 truncate font-medium">{r.name}</div>
                <div className="w-14 h-6 shrink-0">
                  {r.curve.length >= 2 ? (
                    <ResponsiveContainer>
                      <LineChart data={r.curve.map((v, i) => ({ i, v }))}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={delta >= 0 ? "#22c55e" : "#ef4444"}
                          strokeWidth={1.2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>
                <div className="w-20 text-right tabular">
                  {inr(r.nav, { compact: true })}
                </div>
                <div className={`w-14 text-right tabular ${classPnl(delta)}`}>
                  {pct(deltaPct)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
