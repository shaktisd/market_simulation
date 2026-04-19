import { useEffect, useState } from "react";
import { EyeOff, X } from "lucide-react";
import type { GameState, Portfolio } from "@/lib/api";
import { useMascotState, type MascotMood } from "@/hooks/useMascotState";

const ENABLED_KEY = "mascot.enabled";
const MINIMIZED_KEY = "mascot.minimized";

interface Props {
  gameId: number;
  refreshKey: number;
  state: GameState | null;
  portfolio: Portfolio | null;
}

export function MarketMascot({ gameId, refreshKey, state, portfolio }: Props) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const v = localStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === "true";
  });
  const [minimized, setMinimized] = useState<boolean>(() => {
    return localStorage.getItem(MINIMIZED_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  }, [enabled]);
  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(minimized));
  }, [minimized]);

  const mascot = useMascotState({ gameId, refreshKey, state, portfolio });

  if (!enabled) {
    return (
      <button
        className="fixed bottom-4 right-4 z-40 w-10 h-10 rounded-full bg-panel border border-border text-muted hover:text-text hover:bg-panel2 flex items-center justify-center shadow-lg"
        onClick={() => setEnabled(true)}
        title="Show market mascot"
      >
        <MascotFace mood="neutral" size={24} animate={false} />
      </button>
    );
  }

  if (minimized) {
    return (
      <button
        className="fixed bottom-4 right-4 z-40 w-14 h-14 rounded-full bg-panel border border-border hover:bg-panel2 flex items-center justify-center shadow-lg transition-colors"
        onClick={() => setMinimized(false)}
        title={mascot.caption}
      >
        <MascotFace mood={mascot.mood} size={40} />
      </button>
    );
  }

  const toneRing =
    mascot.tone === "good"
      ? "border-success/50"
      : mascot.tone === "bad"
        ? "border-danger/50"
        : mascot.tone === "warn"
          ? "border-warn/50"
          : "border-border";

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 w-56 card border-2 ${toneRing} shadow-xl overflow-hidden select-none`}
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 text-[10px] text-muted uppercase tracking-wider">
        <span>Market mood</span>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 hover:text-text rounded"
            onClick={() => setMinimized(true)}
            title="Minimize"
          >
            <EyeOff size={12} />
          </button>
          <button
            className="p-1 hover:text-text rounded"
            onClick={() => setEnabled(false)}
            title="Hide mascot (re-open via the coin icon)"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex justify-center pt-1 pb-1">
        <MascotFace mood={mascot.mood} size={96} />
      </div>
      <div className="px-3 pb-2.5 text-center">
        <div className="text-[11px] leading-tight text-text">{mascot.caption}</div>
      </div>
    </div>
  );
}

function MascotFace({
  mood,
  size,
  animate = true,
}: {
  mood: MascotMood;
  size: number;
  animate?: boolean;
}) {
  const isRed = mood === "drawdown_deep";
  const body = isRed ? "#ef4444" : "#f59e0b";
  const rim = isRed ? "#b91c1c" : "#d97706";
  const animClass = animate ? moodAnim(mood) : "";

  return (
    <div className={`relative ${animClass}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {mood === "all_time_high" && (
          <circle cx="50" cy="55" r="45" fill="#fde68a" opacity="0.35" />
        )}

        <circle cx="50" cy="55" r="34" fill={body} stroke={rim} strokeWidth="2" />
        <circle
          cx="50"
          cy="55"
          r="28"
          fill="none"
          stroke={rim}
          strokeWidth="1"
          opacity="0.45"
        />

        {mood === "idle" ? (
          <>
            <path
              d="M 38 51 Q 42 55 46 51"
              stroke="#1f2937"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 54 51 Q 58 55 62 51"
              stroke="#1f2937"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <circle cx="42" cy="50" r="2.5" fill="#1f2937" />
            <circle cx="58" cy="50" r="2.5" fill="#1f2937" />
          </>
        )}

        {mouthFor(mood)}

        {mood === "drawdown_deep" && (
          <>
            <path d="M 80 40 Q 77 48 80 49 Q 83 48 80 40 Z" fill="#60a5fa" />
            <path
              d="M 22 44 Q 19 51 22 52 Q 25 51 22 44 Z"
              fill="#60a5fa"
              opacity="0.75"
            />
          </>
        )}

        {mood === "celebrating" && <Confetti />}

        {mood === "worried" && (
          <g>
            <path
              d="M 22 30 Q 50 5 78 30 Z"
              fill="#4f8cff"
              stroke="#1e3a8a"
              strokeWidth="1.5"
            />
            <line x1="50" y1="30" x2="50" y2="22" stroke="#1e3a8a" strokeWidth="2" />
            <path
              d="M 12 38 Q 15 42 20 40"
              stroke="#60a5fa"
              strokeWidth="1.5"
              fill="none"
            />
            <path
              d="M 78 40 Q 82 44 88 42"
              stroke="#60a5fa"
              strokeWidth="1.5"
              fill="none"
            />
          </g>
        )}

        {mood === "idle" && (
          <g fill="#8892a6" fontWeight="bold" fontFamily="sans-serif">
            <text x="68" y="30" fontSize="11">
              z
            </text>
            <text x="75" y="22" fontSize="8">
              z
            </text>
            <text x="80" y="15" fontSize="6">
              z
            </text>
          </g>
        )}

        {mood === "all_time_high" && (
          <g transform="translate(35 2)">
            <path
              d="M 4 2 L 26 2 L 24 14 Q 15 18 6 14 Z"
              fill="#fbbf24"
              stroke="#b45309"
              strokeWidth="1"
            />
            <rect x="13" y="14" width="4" height="6" fill="#b45309" />
            <rect x="9" y="19" width="12" height="2.5" fill="#b45309" />
            <text
              x="11"
              y="11"
              fontSize="7"
              fill="#b45309"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              ★
            </text>
          </g>
        )}

        {mood === "churn" && (
          <g transform="translate(68 8)">
            <rect
              x="0"
              y="0"
              width="20"
              height="24"
              fill="#f3f4f6"
              stroke="#6b7280"
              strokeWidth="0.8"
            />
            <path
              d="M 0 24 L 3 27 L 6 24 L 10 27 L 14 24 L 17 27 L 20 24 Z"
              fill="#f3f4f6"
              stroke="#6b7280"
              strokeWidth="0.8"
            />
            <line x1="3" y1="6" x2="17" y2="6" stroke="#6b7280" strokeWidth="0.6" />
            <line x1="3" y1="10" x2="17" y2="10" stroke="#6b7280" strokeWidth="0.6" />
            <line x1="3" y1="14" x2="13" y2="14" stroke="#6b7280" strokeWidth="0.6" />
            <text
              x="4"
              y="21"
              fontSize="6"
              fill="#ef4444"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              ₹
            </text>
          </g>
        )}

        {mood === "concentration_stock" && (
          <g transform="translate(72 16)">
            <circle cx="7" cy="7" r="7" fill="#f59e0b" stroke="#b45309" strokeWidth="1" />
            <text
              x="5.2"
              y="10.5"
              fontSize="9"
              fill="#fff"
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              !
            </text>
          </g>
        )}

        {mood === "concentration_sector" && (
          <>
            <line
              x1="18"
              y1="90"
              x2="82"
              y2="90"
              stroke="#8892a6"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          </>
        )}
      </svg>
    </div>
  );
}

function Confetti() {
  return (
    <g>
      <rect x="14" y="18" width="4" height="4" fill="#22c55e" transform="rotate(20 16 20)">
        <animate attributeName="y" values="18;78" dur="1.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0" dur="1.2s" repeatCount="indefinite" />
      </rect>
      <rect x="82" y="24" width="4" height="4" fill="#4f8cff" transform="rotate(-15 84 26)">
        <animate attributeName="y" values="24;82" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite" />
      </rect>
      <rect x="48" y="10" width="4" height="4" fill="#f59e0b">
        <animate attributeName="y" values="10;82" dur="1s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0" dur="1s" repeatCount="indefinite" />
      </rect>
      <rect x="30" y="12" width="3" height="3" fill="#a855f7">
        <animate attributeName="y" values="12;80" dur="1.3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0" dur="1.3s" repeatCount="indefinite" />
      </rect>
    </g>
  );
}

function mouthFor(mood: MascotMood) {
  const stroke = "#1f2937";
  switch (mood) {
    case "celebrating":
    case "all_time_high":
      return (
        <path
          d="M 40 62 Q 50 72 60 62"
          stroke={stroke}
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      );
    case "worried":
    case "drawdown_deep":
      return (
        <path
          d="M 40 68 Q 50 60 60 68"
          stroke={stroke}
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      );
    case "idle":
      return (
        <path
          d="M 44 64 Q 50 66 56 64"
          stroke={stroke}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      );
    case "concentration_stock":
    case "concentration_sector":
    case "churn":
      return (
        <path
          d="M 42 64 Q 46 62 50 64 Q 54 66 58 64"
          stroke={stroke}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      );
    default:
      return (
        <path
          d="M 42 64 Q 50 68 58 64"
          stroke={stroke}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      );
  }
}

function moodAnim(mood: MascotMood): string {
  switch (mood) {
    case "celebrating":
    case "all_time_high":
      return "animate-mascot-bounce";
    case "concentration_stock":
      return "animate-mascot-wobble";
    case "concentration_sector":
      return "animate-mascot-tilt";
    case "worried":
      return "animate-mascot-bob";
    case "drawdown_deep":
      return "animate-mascot-shiver";
    case "idle":
      return "animate-mascot-breathe";
    case "churn":
      return "animate-mascot-shake";
    default:
      return "animate-mascot-bob";
  }
}
