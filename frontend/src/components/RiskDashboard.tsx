import { useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { api, type RiskMetrics } from "@/lib/api";

interface Props {
  gameId: number;
  refreshKey: number;
}

export function RiskDashboard({ gameId, refreshKey }: Props) {
  const [data, setData] = useState<RiskMetrics | null>(null);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    let mounted = true;
    api
      .riskMetrics(gameId)
      .then((d) => mounted && setData(d))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  const t = data?.turns_observed ?? 0;

  return (
    <div className="card overflow-hidden mb-4">
      <button
        className="w-full flex items-center gap-2 px-4 py-2 border-b border-border text-xs text-muted uppercase tracking-wider hover:bg-panel2/50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <Activity size={13} />
        <span>Risk dashboard</span>
        {collapsed && data && (
          <span className="normal-case tracking-normal text-[10px] flex gap-3 ml-2">
            <span>DD {fmtPct(data.drawdown)}</span>
            <span>HHI {fmtNum(data.hhi, 3)}</span>
            <span>Sharpe {fmtNum(data.sharpe, 2)}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-[10px]">
          {t < 2 ? "warming up…" : `${t} turn${t === 1 ? "" : "s"}`}
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-border">
        <Tile
          label="Volatility (ann.)"
          value={fmtPct(data?.volatility_ann)}
          tone={toneVol(data?.volatility_ann)}
          hint="Annualized stdev of last 30 turn returns."
        />
        <Tile
          label="Beta vs NIFTY50"
          value={fmtNum(data?.beta, 2)}
          tone={toneBeta(data?.beta)}
          hint="Sensitivity of NAV to NIFTY50 moves. 1 = market-like, >1 = amplified, <1 = defensive."
        />
        <Tile
          label="Drawdown"
          value={fmtPct(data?.drawdown)}
          tone={toneDD(data?.drawdown)}
          hint="Current decline from the highest NAV reached so far."
        />
        <Tile
          label="Concentration"
          value={fmtNum(data?.hhi, 3)}
          tone={toneHHI(data?.hhi)}
          hint="Herfindahl index of holdings + cash. 1 = all-in one asset; 0 = perfectly diversified."
        />
        <Tile
          label="Sharpe"
          value={fmtNum(data?.sharpe, 2)}
          tone={toneSharpe(data?.sharpe)}
          hint="(annualized return − 7% FD) / annualized vol. >1 is solid, >2 is excellent."
        />
      </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint: string;
}) {
  return (
    <div className="px-4 py-3" title={hint}>
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toFixed(digits);
}

function toneVol(v: number | null | undefined): string {
  if (v == null) return "text-text";
  if (v > 0.3) return "text-danger";
  if (v > 0.18) return "text-warn";
  return "text-text";
}
function toneBeta(v: number | null | undefined): string {
  if (v == null) return "text-text";
  if (v > 1.3) return "text-warn";
  if (v < 0.5) return "text-muted";
  return "text-text";
}
function toneDD(v: number | null | undefined): string {
  if (v == null) return "text-text";
  if (v < -0.15) return "text-danger";
  if (v < -0.05) return "text-warn";
  return "text-text";
}
function toneHHI(v: number | null | undefined): string {
  if (v == null) return "text-text";
  if (v > 0.4) return "text-danger";
  if (v > 0.25) return "text-warn";
  return "text-text";
}
function toneSharpe(v: number | null | undefined): string {
  if (v == null) return "text-text";
  if (v >= 1.5) return "text-success";
  if (v < 0) return "text-danger";
  return "text-text";
}
