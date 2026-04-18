import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, type InstrumentInfo, type InstrumentType } from "@/lib/api";
import { classPnl, inr, pct } from "@/lib/format";

interface Props {
  gameId: number;
  instrumentType: InstrumentType;
  onSelect: (symbol: string) => void;
  selectedSymbol?: string | null;
}

export function WatchlistTable({ gameId, instrumentType, onSelect, selectedSymbol }: Props) {
  const [rows, setRows] = useState<InstrumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [filters, setFilters] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const f =
          instrumentType === "stock"
            ? await api.stockSectors(gameId)
            : await api.mfCategories(gameId);
        setFilters(f);
      } catch {
        /* ignore */
      }
    })();
  }, [gameId, instrumentType]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const data =
          instrumentType === "stock"
            ? await api.listStocks(gameId, { q: q || undefined, sector: filter || undefined, limit: 600 })
            : await api.listFunds(gameId, { q: q || undefined, category: filter || undefined, limit: 200 });
        setRows(data);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [gameId, instrumentType, q, filter]);

  const sorted = useMemo(() => rows, [rows]);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
          <input
            placeholder={instrumentType === "stock" ? "Search by symbol or name…" : "Search fund name…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input pl-8"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input sm:w-48"
        >
          <option value="">{instrumentType === "stock" ? "All sectors" : "All categories"}</option>
          {filters.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden flex-1 min-h-0">
        <div className="overflow-y-auto h-full">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 bg-panel border-b border-border text-xs text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-right px-3 py-2 font-medium">Price</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">1M</th>
                <th className="text-right px-3 py-2 font-medium hidden md:table-cell">6M</th>
                <th className="text-right px-3 py-2 font-medium">12M</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-muted text-xs">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-muted text-xs">
                    No matching instruments.
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
                const sel = r.symbol === selectedSymbol;
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelect(r.symbol)}
                    className={`border-b border-border cursor-pointer transition-colors ${
                      sel ? "bg-panel2" : "hover:bg-panel2/60"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[220px]">{r.name}</div>
                      <div className="text-xs text-muted">
                        {instrumentType === "stock" ? r.symbol : r.sector || "—"}
                      </div>
                    </td>
                    <td className="text-right px-3 py-2">
                      {r.last_price != null ? inr(r.last_price) : "—"}
                    </td>
                    <td className={`text-right px-3 py-2 hidden sm:table-cell ${classPnl(r.change_pct_1m)}`}>
                      {pct(r.change_pct_1m)}
                    </td>
                    <td className={`text-right px-3 py-2 hidden md:table-cell ${classPnl(r.change_pct_6m)}`}>
                      {pct(r.change_pct_6m)}
                    </td>
                    <td className={`text-right px-3 py-2 ${classPnl(r.change_pct_12m)}`}>
                      {pct(r.change_pct_12m)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
