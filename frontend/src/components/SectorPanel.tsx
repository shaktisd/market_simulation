import { useEffect, useState } from "react";
import { api, type BenchmarkSeries, type SectorRow } from "@/lib/api";
import { classPnl, pct } from "@/lib/format";
import { PriceChart } from "./PriceChart";

interface Props {
  gameId: number;
  refreshKey: number;
}

export function SectorPanel({ gameId, refreshKey }: Props) {
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkSeries[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [s, b] = await Promise.all([api.sectors(gameId, 90), api.benchmarks(gameId, 365)]);
        if (!mounted) return;
        setSectors(s.sort((a, b) => b.change_pct - a.change_pct));
        setBenchmarks(b);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  const n50 = benchmarks.find((b) => b.name === "NIFTY50");

  return (
    <div className="flex flex-col gap-4">
      <div className="card card-pad">
        <div className="text-xs text-muted uppercase tracking-wider mb-2">
          Nifty 50 · trailing window <span className="text-[10px] normal-case tracking-normal">(rebased to 100)</span>
        </div>
        <PriceChart points={n50?.points || []} height={140} normalize />
      </div>

      <div className="card overflow-hidden">
        <div className="card-pad border-b border-border">
          <div className="text-xs text-muted uppercase tracking-wider">Sector heatmap · 90d</div>
        </div>
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs tabular">
            <tbody>
              {sectors.map((s) => (
                <tr key={s.sector} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 truncate max-w-[180px]">{s.sector}</td>
                  <td className={`text-right px-3 py-1.5 ${classPnl(s.change_pct)}`}>
                    {pct(s.change_pct)}
                  </td>
                </tr>
              ))}
              {sectors.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted">No data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
