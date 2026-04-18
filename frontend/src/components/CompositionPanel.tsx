import { useEffect, useState } from "react";
import { api, type Composition, type CompositionSlice } from "@/lib/api";
import { inr } from "@/lib/format";

interface Props {
  gameId: number;
  refreshKey: number;
}

const ASSET_COLORS: Record<string, string> = {
  Stocks: "#4f8cff",
  "Mutual Funds": "#22c55e",
  Cash: "#8892a6",
};

// Stable color cycle for sectors
const SECTOR_PALETTE = [
  "#4f8cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#0ea5e9",
  "#14b8a6", "#eab308", "#f43f5e", "#8b5cf6", "#10b981",
];

function colorFor(label: string, idx: number): string {
  if (label in ASSET_COLORS) return ASSET_COLORS[label];
  if (label === "Cash") return "#8892a6";
  return SECTOR_PALETTE[idx % SECTOR_PALETTE.length];
}

export function CompositionPanel({ gameId, refreshKey }: Props) {
  const [data, setData] = useState<Composition | null>(null);
  const [tab, setTab] = useState<"asset" | "sector">("asset");

  useEffect(() => {
    let mounted = true;
    api.composition(gameId).then((c) => mounted && setData(c)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  if (!data)
    return (
      <div className="card card-pad text-sm text-muted">Loading composition…</div>
    );

  const slices = tab === "asset" ? data.by_asset_class : data.by_sector;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between card-pad border-b border-border">
        <div className="text-xs text-muted uppercase tracking-wider">Composition</div>
        <div className="flex gap-1 text-xs p-0.5 bg-panel2 border border-border rounded-md">
          <TabBtn active={tab === "asset"} onClick={() => setTab("asset")}>Asset</TabBtn>
          <TabBtn active={tab === "sector"} onClick={() => setTab("sector")}>Sector</TabBtn>
        </div>
      </div>

      <div className="px-4 pt-3">
        <DonutBar slices={slices} />
      </div>

      <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
        {slices.map((s, i) => (
          <Row key={s.label} slice={s} color={colorFor(s.label, i)} />
        ))}
      </div>
    </div>
  );
}

function TabBtn({
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
      className={`px-2.5 py-1 rounded transition-colors ${
        active ? "bg-accent text-white" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function DonutBar({ slices }: { slices: CompositionSlice[] }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full">
      {slices.map((s, i) => {
        const w = (s.value / total) * 100;
        if (w <= 0) return null;
        return (
          <div
            key={s.label}
            style={{ width: `${w}%`, background: colorFor(s.label, i) }}
            title={`${s.label} · ${(s.weight * 100).toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

function Row({ slice, color }: { slice: CompositionSlice; color: string }) {
  const pct = (slice.weight * 100).toFixed(1);
  return (
    <div className="flex items-center gap-2 text-xs tabular">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 truncate text-text">{slice.label}</span>
      <span className="text-muted">{inr(slice.value, { compact: true })}</span>
      <span className="font-medium w-12 text-right">{pct}%</span>
    </div>
  );
}
