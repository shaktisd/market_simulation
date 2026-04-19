import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Step definitions per page                                          */
/* ------------------------------------------------------------------ */

export interface TutorialStep {
  target: string;          // data-tutorial="..." selector value
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

const HOME_STEPS: TutorialStep[] = [
  {
    target: "home-hero",
    title: "Welcome to Market Sim",
    body: "This is a turn-based Indian market investing game. You start with ₹1 Cr and trade through a hidden slice of real market history (2010–today).",
    placement: "bottom",
  },
  {
    target: "home-tiles",
    title: "How It Works",
    body: "The game uses a random hidden time window, applies real market frictions (brokerage, STT, stamp duty, GST, DP charges, taxes), and benchmarks you against NIFTY50, NIFTY500 & a 7% FD.",
    placement: "bottom",
  },
  {
    target: "home-step-selector",
    title: "Choose Your Pace",
    body: "Pick how much time passes each turn. 'Day' gives granular control, 'Month' finishes games faster. Each click of 'Next' during the game advances by this amount.",
    placement: "top",
  },
  {
    target: "home-begin-btn",
    title: "Start Playing",
    body: "Click here to begin a new game. You'll be taken to the main trading screen where you can browse stocks, place orders, and manage your portfolio.",
    placement: "top",
  },
];

const GAME_STEPS: TutorialStep[] = [
  {
    target: "game-topbar",
    title: "Status Bar",
    body: "This bar shows your current turn number, time step, cash balance, holdings market value, total NAV (Net Asset Value), and your profit/loss since the start.",
    placement: "bottom",
  },
  {
    target: "game-controls",
    title: "Turn Controls",
    body: "'Next' advances to the next trading period — prices update, your portfolio is revalued. 'End' finishes the game early and reveals the hidden time period. The final turn runs algo benchmarks (takes 10–30s).",
    placement: "bottom",
  },
  {
    target: "game-risk",
    title: "Risk Dashboard",
    body: "Real-time risk metrics for your portfolio: annualized volatility, beta vs NIFTY50, current drawdown from peak, concentration (HHI), and Sharpe ratio. Color-coded: green = healthy, yellow = caution, red = danger.",
    placement: "bottom",
  },
  {
    target: "game-tabs",
    title: "Browse Instruments",
    body: "Switch between Stocks (Nifty 500 universe), Mutual Funds, and your current Holdings. Use the search bar and filters to find specific instruments.",
    placement: "bottom",
  },
  {
    target: "game-watchlist",
    title: "Watchlist Table",
    body: "Browse instruments with their current prices and trailing returns (1M, 6M, 12M). Click any row to see its price chart and details. Green = positive returns, red = negative.",
    placement: "right",
  },
  {
    target: "game-center",
    title: "Detail & Portfolio View",
    body: "When no stock is selected, you'll see your portfolio NAV history chart, turn analytics (P&L, top movers), and asset/sector composition. Select a stock to see its price chart and fundamentals.",
    placement: "left",
  },
  {
    target: "game-right",
    title: "Market Context",
    body: "The right panel shows the live Algo Leaderboard (how algorithmic strategies are performing vs you), Nifty 50 benchmark chart, and a sector heatmap showing recent sector performance.",
    placement: "left",
  },
  {
    target: "game-algo-live",
    title: "Algo Leaderboard",
    body: "Track how 7 algorithmic strategies (Momentum, Value, Low Vol, Quality, Risk Parity, Mean Reversion, Equal Weight) perform in real-time alongside your portfolio. After a few turns, rankings go 'live'.",
    placement: "left",
  },
];

const RESULTS_STEPS: TutorialStep[] = [
  {
    target: "results-reveal",
    title: "The Reveal",
    body: "The hidden time period is finally revealed! You can now see exactly which dates you were trading through and how many months the game spanned.",
    placement: "bottom",
  },
  {
    target: "results-metrics",
    title: "Performance Summary",
    body: "Key metrics at a glance: your final NAV, total P&L, CAGR (annualized return), max drawdown, total charges & taxes paid, number of trades, and how you compare to Nifty 50.",
    placement: "bottom",
  },
  {
    target: "results-chart",
    title: "Benchmark Comparison",
    body: "This chart plots your portfolio value over time against Nifty 50 (green), Nifty 500 (orange), and a 7% Fixed Deposit (purple dashed). See exactly when you outperformed or underperformed.",
    placement: "top",
  },
  {
    target: "results-trades",
    title: "Trade Log",
    body: "Every trade you made — date, instrument, buy/sell, quantity, price, charges, and realized P&L on sells. Scroll through to review your decisions.",
    placement: "top",
  },
  {
    target: "results-tabs",
    title: "Algo Strategies Tab",
    body: "Switch to 'Algo Strategies' to see how 7 different algorithmic approaches performed over the same period. You can compare their NAV curves, CAGR, drawdowns, and even see their final holdings.",
    placement: "bottom",
  },
  {
    target: "results-actions",
    title: "What's Next?",
    body: "Play again with a new random time period, or check your History to see how you've improved across games. Each game is a completely different market environment!",
    placement: "top",
  },
];

function getStepsForPath(pathname: string): TutorialStep[] {
  if (pathname === "/") return HOME_STEPS;
  if (/^\/game\/\d+\/results/.test(pathname)) return RESULTS_STEPS;
  if (/^\/game\/\d+/.test(pathname)) return GAME_STEPS;
  return [];
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface TutorialCtx {
  active: boolean;
  start: () => void;
}

const Ctx = createContext<TutorialCtx>({ active: false, start: () => {} });
export const useTutorial = () => useContext(Ctx);

/* ------------------------------------------------------------------ */
/*  Provider (wrap around <App /> routes)                              */
/* ------------------------------------------------------------------ */

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const start = useCallback(() => setActive(true), []);

  return (
    <Ctx.Provider value={{ active, start }}>
      {children}
      {active && <TutorialOverlay onClose={() => setActive(false)} />}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Overlay                                                            */
/* ------------------------------------------------------------------ */

function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const steps = getStepsForPath(location.pathname);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[idx] as TutorialStep | undefined;

  // Find the target element and measure it
  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tutorial="${step.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Use a rAF so getBoundingClientRect reads post-scroll layout
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // If the element is taller than the viewport, clamp the rect to
        // only highlight the visible portion so the tooltip stays on screen.
        if (r.height > vh * 0.6) {
          const clamped = new DOMRect(r.x, Math.max(r.y, 0), r.width, Math.min(r.height, vh * 0.5));
          setRect(clamped);
        } else {
          setRect(r);
        }
      });
    } else {
      setRect(null);
    }
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Re-measure after a short delay to catch elements that render late
  useEffect(() => {
    const t = setTimeout(measure, 200);
    return () => clearTimeout(t);
  }, [measure]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (idx < steps.length - 1) setIdx(idx + 1);
        else onClose();
      }
      if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [idx, steps.length, onClose]);

  if (!steps.length || !step) {
    onClose();
    return null;
  }

  const pad = 8;
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const tooltipStyle = computeTooltipPosition(rect, step.placement ?? "bottom", pad);

  return (
    <div className="tutorial-overlay" onClick={onClose}>
      {/* SVG mask with spotlight cutout */}
      <svg className="tutorial-mask" onClick={onClose}>
        <defs>
          <mask id="tutorial-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Spotlight ring */}
      {spotlight && (
        <div
          className="tutorial-ring"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tutorial-tooltip"
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="font-semibold text-base text-amber-100">{step.title}</div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-amber-900/50 text-amber-400 hover:text-amber-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="text-sm text-amber-200/70 leading-relaxed mb-4">{step.body}</div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-amber-400/60 tabular">
            {idx + 1} of {steps.length}
          </div>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button
                className="tutorial-btn tutorial-btn-ghost"
                onClick={() => setIdx(idx - 1)}
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {idx < steps.length - 1 ? (
              <button
                className="tutorial-btn tutorial-btn-primary"
                onClick={() => setIdx(idx + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            ) : (
              <button className="tutorial-btn tutorial-btn-primary" onClick={onClose}>
                Finish
              </button>
            )}
          </div>
        </div>
        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mt-3">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === idx ? "bg-amber-400" : i < idx ? "bg-amber-600" : "bg-amber-900"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tooltip positioning helper                                         */
/* ------------------------------------------------------------------ */

function computeTooltipPosition(
  rect: DOMRect | null,
  placement: "top" | "bottom" | "left" | "right",
  pad: number,
): React.CSSProperties {
  const ttWidth = 360;
  const gap = 16;

  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: ttWidth,
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style: React.CSSProperties = { maxWidth: ttWidth, position: "fixed" };

  switch (placement) {
    case "bottom": {
      style.top = rect.bottom + pad + gap;
      style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - ttWidth / 2, vw - ttWidth - 16));
      if ((style.top as number) + 200 > vh) {
        style.top = Math.max(16, rect.top - pad - gap - 200);
      }
      break;
    }
    case "top": {
      style.top = Math.max(16, rect.top - pad - gap - 200);
      style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - ttWidth / 2, vw - ttWidth - 16));
      if ((style.top as number) < 16) {
        style.top = rect.bottom + pad + gap;
      }
      break;
    }
    case "right": {
      style.top = Math.max(16, rect.top + rect.height / 2 - 100);
      style.left = Math.min(rect.right + pad + gap, vw - ttWidth - 16);
      if ((style.left as number) + ttWidth > vw - 16) {
        style.left = Math.max(16, rect.left - pad - gap - ttWidth);
      }
      break;
    }
    case "left": {
      style.top = Math.max(16, rect.top + rect.height / 2 - 100);
      style.left = Math.max(16, rect.left - pad - gap - ttWidth);
      if ((style.left as number) < 16) {
        style.left = Math.min(rect.right + pad + gap, vw - ttWidth - 16);
      }
      break;
    }
  }

  return style;
}

/* ------------------------------------------------------------------ */
/*  Header trigger button                                              */
/* ------------------------------------------------------------------ */

export function TutorialButton() {
  const { start } = useTutorial();
  const location = useLocation();
  const steps = getStepsForPath(location.pathname);
  if (!steps.length) return null;

  return (
    <button onClick={start} className="btn-ghost gap-1.5" title="Start guided tutorial">
      <HelpCircle size={16} />
      <span className="hidden sm:inline">Tutorial</span>
    </button>
  );
}
