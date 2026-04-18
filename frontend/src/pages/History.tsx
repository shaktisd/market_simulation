import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { classPnl, formatDate, inr, pctFromRatio } from "@/lib/format";

interface HistoryRow {
  game_id: number;
  created_at: string;
  revealed_start_date: string;
  revealed_end_date: string;
  final_nav: number;
  cagr: number;
  benchmark_nifty50_cagr: number | null;
}

export function History() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.history());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-1">Past runs</h1>
      <p className="text-muted text-sm mb-5">Every completed game, with its revealed period.</p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm tabular">
          <thead className="bg-panel2 border-b border-border text-xs text-muted uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Played on</th>
              <th className="text-left px-3 py-2">Period</th>
              <th className="text-right px-3 py-2">Final NAV</th>
              <th className="text-right px-3 py-2">CAGR</th>
              <th className="text-right px-3 py-2">vs Nifty 50</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted">Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted">
                  No games yet. <Link to="/" className="text-accent">Start one</Link>.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const delta = r.benchmark_nifty50_cagr != null ? r.cagr - r.benchmark_nifty50_cagr : null;
              return (
                <tr key={r.game_id} className="border-b border-border">
                  <td className="px-3 py-2 text-muted">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-2">
                    {formatDate(r.revealed_start_date)} → {formatDate(r.revealed_end_date)}
                  </td>
                  <td className="text-right px-3 py-2 font-medium">{inr(r.final_nav)}</td>
                  <td className={`text-right px-3 py-2 ${classPnl(r.cagr)}`}>
                    {pctFromRatio(r.cagr)}
                  </td>
                  <td className={`text-right px-3 py-2 ${classPnl(delta)}`}>
                    {delta != null ? pctFromRatio(delta) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/game/${r.game_id}/results`} className="text-accent text-xs">View →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
