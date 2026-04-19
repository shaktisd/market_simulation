import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  api,
  type Composition,
  type HoldingOut,
  type InstrumentType,
  type OrderMode,
  type OrderResponse,
  type Side,
} from "@/lib/api";
import { inr, num } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  gameId: number;
  instrumentType: InstrumentType;
  symbol: string;
  name: string;
  lastPrice: number;
  cashAvailable: number;
  navTotal: number;
  quantityHeld?: number;
  holdings?: HoldingOut[];
  instrumentSector?: string | null;
  onExecuted: (res: OrderResponse) => void;
}

export function OrderDialog({
  open,
  onClose,
  gameId,
  instrumentType,
  symbol,
  name,
  lastPrice,
  cashAvailable,
  navTotal,
  quantityHeld = 0,
  holdings = [],
  instrumentSector = null,
  onExecuted,
}: Props) {
  const isStock = instrumentType === "stock";
  const [side, setSide] = useState<Side>("BUY");
  const [mode, setMode] = useState<OrderMode>("weight");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composition, setComposition] = useState<Composition | null>(null);

  useEffect(() => {
    if (open) {
      setSide("BUY");
      setMode("weight");
      setInput("");
      setError(null);
      api.composition(gameId).then(setComposition).catch(() => setComposition(null));
    }
  }, [open, symbol, gameId]);

  const valueNum = useMemo(() => {
    const n = parseFloat(input);
    return isFinite(n) && n > 0 ? n : 0;
  }, [input]);

  // Resolve qty client-side for preview; server is authoritative
  const previewQty = useMemo(() => {
    if (valueNum <= 0 || lastPrice <= 0) return 0;
    let raw: number;
    if (mode === "qty") raw = valueNum;
    else if (mode === "weight") raw = ((valueNum / 100) * navTotal) / lastPrice;
    else raw = valueNum / lastPrice;

    if (side === "BUY") {
      const maxAffordable = cashAvailable / (lastPrice * 1.005);
      raw = Math.min(raw, maxAffordable);
    } else {
      raw = Math.min(raw, quantityHeld);
    }
    if (isStock) raw = Math.floor(raw);
    return raw > 0 ? raw : 0;
  }, [valueNum, mode, navTotal, lastPrice, cashAvailable, quantityHeld, side, isStock]);

  const previewGross = previewQty * lastPrice;
  const estCharges = isStock
    ? previewGross *
        (0.0003 + 0.0000297 + 0.000001 + (side === "BUY" ? 0.00015 : 0.001)) +
      (side === "SELL" ? 15.93 : 0) +
      Math.min(20, previewGross * 0.0003)
    : 0;
  const previewNet = side === "BUY" ? previewGross + estCharges : previewGross - estCharges;
  const previewWeight = navTotal > 0 ? (previewGross / navTotal) * 100 : 0;

  const whatIf = useMemo(() => {
    if (previewQty <= 0) return null;

    const currentQty =
      holdings.find(
        (h) => h.instrument_type === instrumentType && h.symbol === symbol,
      )?.quantity ?? 0;
    const currentMv = currentQty * lastPrice;

    const qtyDelta = side === "BUY" ? previewQty : -previewQty;
    const newMv = Math.max(0, (currentQty + qtyDelta) * lastPrice);

    const cashDelta = side === "BUY" ? -previewNet : previewNet;
    const newCash = cashAvailable + cashDelta;
    const newNav = Math.max(1, navTotal - estCharges);

    const newStockWeight = (newMv / newNav) * 100;

    // Sector exposure: current sector value + price-neutral delta from the traded stock
    let newSectorWeight: number | null = null;
    if (composition && instrumentSector) {
      const slice = composition.by_sector.find((s) => s.label === instrumentSector);
      const currentSectorValue = slice ? slice.value : 0;
      const sectorDelta = side === "BUY" ? previewGross : -previewGross;
      const newSectorValue = Math.max(0, currentSectorValue + sectorDelta);
      newSectorWeight = (newSectorValue / newNav) * 100;
    }

    // HHI across (holdings after trade) + cash
    const newValues: number[] = [];
    let matched = false;
    for (const h of holdings) {
      const mv = h.quantity * h.last_price;
      if (h.instrument_type === instrumentType && h.symbol === symbol) {
        matched = true;
        if (newMv > 0) newValues.push(newMv);
      } else if (mv > 0) {
        newValues.push(mv);
      }
    }
    if (!matched && side === "BUY" && newMv > 0) newValues.push(newMv);
    if (newCash > 0) newValues.push(newCash);
    const total = newValues.reduce((a, b) => a + b, 0);
    const newHhi =
      total > 0 ? newValues.reduce((s, v) => s + (v / total) ** 2, 0) : null;

    const currentStockWeight = navTotal > 0 ? (currentMv / navTotal) * 100 : 0;
    const currentSectorWeight =
      composition && instrumentSector
        ? (composition.by_sector.find((s) => s.label === instrumentSector)?.weight ?? 0) *
          100
        : null;
    const currentHhi = (() => {
      const vals: number[] = [];
      for (const h of holdings) {
        const mv = h.quantity * h.last_price;
        if (mv > 0) vals.push(mv);
      }
      if (cashAvailable > 0) vals.push(cashAvailable);
      const t = vals.reduce((a, b) => a + b, 0);
      return t > 0 ? vals.reduce((s, v) => s + (v / t) ** 2, 0) : null;
    })();

    return {
      newCash,
      newNav,
      newStockWeight,
      currentStockWeight,
      newSectorWeight,
      currentSectorWeight,
      newHhi,
      currentHhi,
    };
  }, [
    previewQty,
    previewNet,
    previewGross,
    estCharges,
    holdings,
    instrumentType,
    symbol,
    lastPrice,
    side,
    cashAvailable,
    navTotal,
    composition,
    instrumentSector,
  ]);

  if (!open) return null;

  const canSubmit = valueNum > 0 && previewQty > 0 && !busy;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.placeOrder(gameId, {
        instrument_type: instrumentType,
        symbol,
        side,
        value: valueNum,
        mode,
      });
      onExecuted(res);
      onClose();
    } catch (e: any) {
      setError(e.message || "Order failed");
    } finally {
      setBusy(false);
    }
  };

  const placeholder =
    mode === "qty"
      ? isStock ? "e.g., 10" : "e.g., 125.5"
      : mode === "weight"
        ? "e.g., 5  (=5% of Portfolio)"
        : "e.g., 50000  (=₹50,000)";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md card-pad max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider">
              {isStock ? "Stock" : "Mutual Fund"}
            </div>
            <div className="font-semibold text-lg leading-tight">{name}</div>
            <div className="text-xs text-muted mt-0.5">{symbol}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            className={`flex-1 btn ${side === "BUY" ? "bg-success text-white" : "bg-panel2 text-text border border-border"}`}
            onClick={() => setSide("BUY")}
          >
            Buy
          </button>
          <button
            className={`flex-1 btn ${side === "SELL" ? "bg-danger text-white" : "bg-panel2 text-text border border-border"}`}
            onClick={() => setSide("SELL")}
            disabled={quantityHeld <= 0}
          >
            Sell
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
          <Stat label="Last price" value={inr(lastPrice)} />
          <Stat
            label={side === "BUY" ? "Cash" : "Holding"}
            value={side === "BUY" ? inr(cashAvailable) : `${num(quantityHeld, isStock ? 0 : 4)}`}
          />
          <Stat label="NAV" value={inr(navTotal, { compact: true })} />
        </div>

        <div className="text-xs text-muted mb-1">Order by</div>
        <div className="grid grid-cols-3 gap-1 mb-3 p-1 bg-panel2 border border-border rounded-lg">
          {(["weight", "qty", "value"] as const).map((m) => (
            <button
              key={m}
              className={`text-xs py-1.5 rounded-md transition-colors ${
                mode === m ? "bg-accent text-white" : "text-muted hover:text-text"
              }`}
              onClick={() => {
                setMode(m);
                setInput("");
              }}
            >
              {m === "qty" ? "Quantity" : m === "weight" ? "% of Portfolio" : "₹ Value"}
            </button>
          ))}
        </div>

        <input
          type="number"
          inputMode="decimal"
          step={mode === "qty" && isStock ? "1" : "0.01"}
          min="0"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="input mb-2"
          placeholder={placeholder}
        />

        <div className="flex flex-wrap gap-1 mb-3 text-xs">
          {mode === "weight" && (
            <>
              {[1, 2.5, 5, 10, 25].map((w) => (
                <Quick key={w} onClick={() => setInput(String(w))}>
                  {w}%
                </Quick>
              ))}
            </>
          )}
          {mode === "value" && side === "BUY" && (
            <>
              {[10000, 50000, 100000, 500000].map((v) => (
                <Quick key={v} onClick={() => setInput(String(v))}>
                  {inr(v, { compact: true })}
                </Quick>
              ))}
            </>
          )}
          {mode === "qty" && side === "BUY" && (
            <Quick
              onClick={() => {
                const maxQ = isStock
                  ? Math.floor(cashAvailable / (lastPrice * 1.005))
                  : cashAvailable / lastPrice;
                setInput(String(isStock ? maxQ : maxQ.toFixed(4)));
              }}
            >
              Max
            </Quick>
          )}
          {side === "SELL" && quantityHeld > 0 && mode === "qty" && (
            <Quick onClick={() => setInput(String(isStock ? Math.floor(quantityHeld) : quantityHeld))}>
              All
            </Quick>
          )}
          {side === "SELL" && mode === "weight" && (
            <Quick
              onClick={() => {
                const w = (quantityHeld * lastPrice / Math.max(1, navTotal)) * 100;
                setInput(w.toFixed(2));
              }}
            >
              Sell all (= current weight)
            </Quick>
          )}
        </div>

        {previewQty > 0 && (
          <div className="rounded-lg bg-panel2 border border-border p-3 text-xs space-y-1 tabular mb-3">
            <Row label="Quantity" value={`${num(previewQty, isStock ? 0 : 4)} ${isStock ? "shares" : "units"}`} strong />
            <Row label="Order value" value={inr(previewGross)} />
            <Row label="≈ portfolio weight" value={`${previewWeight.toFixed(2)}%`} sub />
            <Row label="Est. charges" value={inr(estCharges)} sub />
            <div className="border-t border-border my-1" />
            <Row
              label={side === "BUY" ? "You pay (approx.)" : "You receive (approx.)"}
              value={inr(previewNet)}
              strong
            />
          </div>
        )}

        {whatIf && (
          <div className="rounded-lg bg-panel2 border border-border p-3 text-xs tabular mb-3">
            <div className="text-[10px] text-muted uppercase tracking-wider mb-2">
              After this trade
            </div>
            <div className="space-y-1.5">
              <Delta
                label="Cash"
                before={inr(cashAvailable, { compact: true })}
                after={inr(whatIf.newCash, { compact: true })}
                warn={whatIf.newCash < 0}
              />
              <Delta
                label={isStock ? "Weight in this stock" : "Weight in this fund"}
                before={`${whatIf.currentStockWeight.toFixed(1)}%`}
                after={`${whatIf.newStockWeight.toFixed(1)}%`}
                warn={whatIf.newStockWeight > 25}
                warnHint="over 25% — concentration risk"
              />
              {whatIf.newSectorWeight !== null && instrumentSector && (
                <Delta
                  label={`${instrumentSector} sector`}
                  before={`${(whatIf.currentSectorWeight ?? 0).toFixed(1)}%`}
                  after={`${whatIf.newSectorWeight.toFixed(1)}%`}
                  warn={whatIf.newSectorWeight > 40}
                  warnHint="over 40% — sector concentration"
                />
              )}
              {whatIf.newHhi !== null && (
                <Delta
                  label="Concentration (HHI)"
                  before={whatIf.currentHhi != null ? whatIf.currentHhi.toFixed(3) : "—"}
                  after={whatIf.newHhi.toFixed(3)}
                  warn={whatIf.newHhi > 0.4}
                  warnHint="HHI > 0.4 is highly concentrated"
                />
              )}
            </div>
          </div>
        )}

        {valueNum > 0 && previewQty === 0 && (
          <div className="mb-3 text-xs text-warn bg-warn/10 border border-warn/40 rounded p-2">
            Resolved quantity is zero — not enough{" "}
            {side === "BUY" ? "cash for one share" : "holding to sell"}.
          </div>
        )}

        {error && (
          <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/40 rounded p-2">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={side === "BUY" ? "btn-success flex-1" : "btn-danger flex-1"}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? "Placing…" : `Confirm ${side}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="font-medium tabular truncate">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  sub = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  sub?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={sub ? "text-muted" : ""}>{label}</span>
      <span className={strong ? "font-semibold text-text" : ""}>{value}</span>
    </div>
  );
}

function Delta({
  label,
  before,
  after,
  warn = false,
  warnHint,
}: {
  label: string;
  before: string;
  after: string;
  warn?: boolean;
  warnHint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted truncate" title={warn ? warnHint : undefined}>
        {label}
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-muted">{before}</span>
        <span className="text-muted">→</span>
        <span
          className={`font-semibold ${warn ? "text-warn" : "text-text"}`}
          title={warn ? warnHint : undefined}
        >
          {after}
        </span>
      </span>
    </div>
  );
}

function Quick({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded border border-border bg-panel2 hover:bg-border transition-colors text-muted hover:text-text"
    >
      {children}
    </button>
  );
}
