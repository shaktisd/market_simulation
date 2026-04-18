import { type Portfolio } from "@/lib/api";
import { classPnl, inr, num, pct } from "@/lib/format";

interface Props {
  portfolio: Portfolio | null;
  onSelect?: (instrument_type: "stock" | "mf", symbol: string) => void;
}

export function PortfolioPanel({ portfolio, onSelect }: Props) {
  if (!portfolio)
    return (
      <div className="card card-pad text-sm text-muted">Loading portfolio…</div>
    );

  const invested = portfolio.holdings.reduce((acc, h) => acc + h.quantity * h.avg_cost, 0);
  const totalPnl = portfolio.holdings_mv - invested;
  const totalPnlPct = invested > 0 ? (totalPnl / invested) * 100 : 0;

  return (
    <div className="card overflow-hidden flex flex-col h-full">
      <div className="card-pad border-b border-border">
        <div className="text-xs text-muted uppercase tracking-wider mb-2">Portfolio</div>
        <div className="grid grid-cols-2 gap-3 text-sm tabular">
          <Cell label="Cash" value={inr(portfolio.cash)} />
          <Cell label="Invested" value={inr(invested)} />
          <Cell label="Holdings MV" value={inr(portfolio.holdings_mv)} />
          <Cell label="NAV" value={inr(portfolio.nav)} strong />
          <Cell
            label="Unrealized"
            value={`${inr(totalPnl)} (${pct(totalPnlPct)})`}
            className={classPnl(totalPnl)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {portfolio.holdings.length === 0 ? (
          <div className="text-sm text-muted text-center py-10 px-3">
            No holdings yet. Buy your first stock or mutual fund to get started.
          </div>
        ) : (
          <table className="w-full text-xs tabular">
            <thead className="sticky top-0 bg-panel border-b border-border text-[10px] text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-2 py-2 font-medium">Name</th>
                <th className="text-right px-2 py-2 font-medium">Qty</th>
                <th className="text-right px-2 py-2 font-medium">LTP</th>
                <th className="text-right px-2 py-2 font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.holdings.map((h) => (
                <tr
                  key={`${h.instrument_type}:${h.symbol}`}
                  className="border-b border-border hover:bg-panel2/60 cursor-pointer"
                  onClick={() => onSelect?.(h.instrument_type, h.symbol)}
                >
                  <td className="px-2 py-2 max-w-0 w-1/3">
                    <div className="font-medium truncate">{h.name}</div>
                    <div className="text-[10px] text-muted truncate">
                      {h.instrument_type === "stock" ? h.symbol : "MF"} · Avg {inr(h.avg_cost, { compact: true })}
                    </div>
                  </td>
                  <td className="text-right px-2 py-2 whitespace-nowrap">
                    {num(h.quantity, h.instrument_type === "stock" ? 0 : 2)}
                  </td>
                  <td className="text-right px-2 py-2 whitespace-nowrap">{inr(h.last_price, { compact: true })}</td>
                  <td className={`text-right px-2 py-2 whitespace-nowrap ${classPnl(h.unrealized_pnl)}`}>
                    <div>{inr(h.unrealized_pnl, { compact: true })}</div>
                    <div className="text-[10px]">{pct(h.unrealized_pct)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  className = "",
  strong = false,
}: {
  label: string;
  value: string;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted mb-0.5">{label}</div>
      <div className={`${strong ? "font-semibold text-base" : ""} ${className}`}>{value}</div>
    </div>
  );
}
