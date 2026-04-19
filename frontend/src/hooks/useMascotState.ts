import { useEffect, useState } from "react";
import {
  api,
  type Composition,
  type GameState,
  type NavHistory,
  type Portfolio,
  type TurnAnalytics,
} from "@/lib/api";

export type MascotMood =
  | "neutral"
  | "celebrating"
  | "worried"
  | "drawdown_deep"
  | "idle"
  | "concentration_stock"
  | "concentration_sector"
  | "churn"
  | "all_time_high";

export type MascotTone = "good" | "bad" | "warn" | "neutral";

export interface MascotState {
  mood: MascotMood;
  caption: string;
  tone: MascotTone;
}

interface Inputs {
  gameId: number;
  refreshKey: number;
  state: GameState | null;
  portfolio: Portfolio | null;
}

export function useMascotState({ gameId, refreshKey, state, portfolio }: Inputs): MascotState {
  const [composition, setComposition] = useState<Composition | null>(null);
  const [turnAnalytics, setTurnAnalytics] = useState<TurnAnalytics | null>(null);
  const [navHistory, setNavHistory] = useState<NavHistory | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.composition(gameId).catch(() => null),
      api.turnAnalytics(gameId).catch(() => null),
      api.navHistory(gameId).catch(() => null),
    ]).then(([c, t, n]) => {
      if (!mounted) return;
      setComposition(c);
      setTurnAnalytics(t);
      setNavHistory(n);
    });
    return () => {
      mounted = false;
    };
  }, [gameId, refreshKey]);

  return deriveMood({ state, portfolio, composition, turnAnalytics, navHistory });
}

function deriveMood(args: {
  state: GameState | null;
  portfolio: Portfolio | null;
  composition: Composition | null;
  turnAnalytics: TurnAnalytics | null;
  navHistory: NavHistory | null;
}): MascotState {
  const { state, portfolio, composition, turnAnalytics, navHistory } = args;

  if (!state) return { mood: "neutral", caption: "Awaiting turn…", tone: "neutral" };

  const nav = state.nav || 1;

  let currentDrawdown = 0;
  let worstPriorDrawdown = 0;
  let isNewATH = false;
  let idleStreak = 0;

  if (navHistory && navHistory.points.length >= 1) {
    const pts = navHistory.points;
    const start = navHistory.starting_nav;

    let priorPeak = start;
    let priorMinDD = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      if (p.nav > priorPeak) priorPeak = p.nav;
      const dd = (p.nav - priorPeak) / priorPeak;
      if (dd < priorMinDD) priorMinDD = dd;
    }
    worstPriorDrawdown = priorMinDD;

    const last = pts[pts.length - 1];
    const peakAll = Math.max(start, ...pts.map((p) => p.nav));
    currentDrawdown = peakAll > 0 ? (last.nav - peakAll) / peakAll : 0;

    const priorMax = Math.max(start, ...pts.slice(0, -1).map((p) => p.nav));
    isNewATH = pts.length >= 2 && last.nav > priorMax * 1.001;

    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      if (p.nav > 0 && p.cash / p.nav > 0.7) idleStreak++;
      else break;
    }
  }

  let maxStockWeight = 0;
  let maxStockName = "";
  if (portfolio) {
    for (const h of portfolio.holdings) {
      const w = h.market_value / nav;
      if (w > maxStockWeight) {
        maxStockWeight = w;
        maxStockName = h.name;
      }
    }
  }

  let maxSectorWeight = 0;
  let maxSectorName = "";
  if (composition) {
    for (const s of composition.by_sector) {
      if (s.label === "Cash") continue;
      if (s.weight > maxSectorWeight) {
        maxSectorWeight = s.weight;
        maxSectorName = s.label;
      }
    }
  }

  const hasPrev = turnAnalytics?.has_previous ?? false;
  const turnPct = turnAnalytics?.nav_delta_pct ?? 0;

  let churnDetected = false;
  if (turnAnalytics && hasPrev) {
    const rotate = Math.abs(turnAnalytics.net_invested_change) / nav;
    if (rotate > 0.1 && Math.abs(turnPct) < 0.5) churnDetected = true;
  }

  if (currentDrawdown < -0.05 && currentDrawdown < worstPriorDrawdown - 0.005) {
    return {
      mood: "drawdown_deep",
      caption: `New drawdown low — ${(currentDrawdown * 100).toFixed(1)}% from peak`,
      tone: "bad",
    };
  }

  if (isNewATH && navHistory && navHistory.points.length > 2) {
    return { mood: "all_time_high", caption: "New all-time high — trophy pose!", tone: "good" };
  }

  if (hasPrev && turnPct > 2) {
    return {
      mood: "celebrating",
      caption: `Portfolio +${turnPct.toFixed(1)}% this turn`,
      tone: "good",
    };
  }
  if (hasPrev && turnPct < -2) {
    return {
      mood: "worried",
      caption: `Portfolio ${turnPct.toFixed(1)}% this turn`,
      tone: "bad",
    };
  }

  if (maxStockWeight > 0.25) {
    return {
      mood: "concentration_stock",
      caption: `${truncate(maxStockName, 24)} is ${(maxStockWeight * 100).toFixed(0)}% of NAV`,
      tone: "warn",
    };
  }

  if (maxSectorWeight > 0.4) {
    return {
      mood: "concentration_sector",
      caption: `Heavy in ${truncate(maxSectorName, 18)} — ${(maxSectorWeight * 100).toFixed(0)}%`,
      tone: "warn",
    };
  }

  if (churnDetected) {
    return {
      mood: "churn",
      caption: "Heavy rotation this turn — watch charges",
      tone: "warn",
    };
  }

  if (idleStreak >= 3) {
    return {
      mood: "idle",
      caption: `Capital idle ${idleStreak} turns — cash over 70%`,
      tone: "warn",
    };
  }

  return { mood: "neutral", caption: "Markets steady — watching for signals", tone: "neutral" };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
