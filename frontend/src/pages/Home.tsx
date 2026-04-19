import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type StepUnit } from "@/lib/api";

export function Home() {
  const nav = useNavigate();
  const [step, setStep] = useState<StepUnit>("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await api.startGame(step);
      nav(`/game/${g.game_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to start game");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 sm:py-16">
      <div className="mb-10 sm:mb-14" data-tutorial="home-hero">
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight mb-4">
          Learn the market by{" "}
          <span className="bg-gradient-to-r from-accent to-success bg-clip-text text-transparent">
            living inside one.
          </span>
        </h1>
        <p className="text-muted max-w-2xl text-base sm:text-lg">
          You get ₹1 crore and a random hidden slice of Indian market history. No dates, no
          spoilers — just prices, sectors, and your own judgement. Trade Nifty 500 stocks and
          mutual funds, and see how your decisions stack up at the end.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10" data-tutorial="home-tiles">
        <Tile title="Hidden history"
              body="A random time window between 1 and 10 years — somewhere after 2010. You won't know the dates until the game ends." />
        <Tile title="Real frictions"
              body="Brokerage, STT, stamp duty, GST, DP charges and capital gains tax — all applied, as in real Indian markets." />
        <Tile title="Benchmarks"
              body="Your portfolio is compared against Nifty 50, Nifty 500, and a 7% FD over the same hidden period." />
      </div>

      <div className="card card-pad max-w-xl">
        <div className="text-xs text-muted uppercase tracking-wider mb-3">Start a new game</div>
        <div className="mb-4">
          <label className="block text-sm mb-2 text-muted">Each "Next" click advances by</label>
          <div className="flex gap-2" data-tutorial="home-step-selector">
            {(["day", "week", "month"] as const).map((s) => (
              <button
                key={s}
                className={`btn flex-1 ${step === s ? "bg-accent text-white" : "bg-panel2 border border-border"}`}
                onClick={() => setStep(s)}
              >
                {s === "day" ? "1 day" : s === "week" ? "1 week" : "1 month"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">
            Slower steps give more control; faster steps finish games sooner.
          </p>
        </div>
        {error && (
          <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/40 rounded p-2">
            {error}
          </div>
        )}
        <button className="btn-primary w-full" disabled={busy} onClick={start} data-tutorial="home-begin-btn">
          {busy ? "Starting…" : "Begin with ₹1,00,00,000"}
        </button>
        <p className="text-xs text-muted mt-3">
          First time? Run the price-ingest script — see the README.
        </p>
      </div>
    </div>
  );
}

function Tile({ title, body }: { title: string; body: string }) {
  return (
    <div className="card card-pad">
      <div className="font-medium mb-1">{title}</div>
      <div className="text-sm text-muted">{body}</div>
    </div>
  );
}
