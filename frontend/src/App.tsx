import { Routes, Route, Link } from "react-router-dom";
import { Home } from "@/pages/Home";
import { Game } from "@/pages/Game";
import { Results } from "@/pages/Results";
import { History } from "@/pages/History";

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-success" />
            <span className="font-semibold tracking-tight">Market Sim</span>
            <span className="chip ml-2 hidden sm:inline-flex">Learn by playing</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/" className="btn-ghost">Home</Link>
            <Link to="/history" className="btn-ghost">History</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/game/:gameId" element={<Game />} />
          <Route path="/game/:gameId/results" element={<Results />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
      <footer className="border-t border-border mt-10">
        <div className="max-w-7xl mx-auto px-4 py-4 text-xs text-muted flex flex-wrap justify-between gap-2">
          <span>Educational simulation. Historical data is indicative only.</span>
          <span>Not investment advice.</span>
        </div>
      </footer>
    </div>
  );
}
