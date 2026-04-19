from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import api_router
from app.core.config import settings
from app.core.db import init_db, session_scope
from app.services.algos import seed_catalog as seed_algo_catalog
from app.services.mf_api import refresh_master_if_stale

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="Market Simulation",
    description="Turn-based Indian market simulation game",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    try:
        with session_scope() as db:
            seed_algo_catalog(db)
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("Algo catalog seed failed: %s", e)
    try:
        with session_scope() as db:
            refresh_master_if_stale(db)
    except Exception as e:  # network failure shouldn't block app start
        logging.getLogger(__name__).warning("MF master refresh failed: %s", e)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(api_router)


# ---- Serve the built frontend (Vite -> frontend/dist) ----
# Run `npm run build` in /frontend to produce the bundle. If the dist folder
# is missing (e.g. dev runs using the Vite dev server + proxy), these mounts
# are skipped so the API still works standalone.
_dist = settings.frontend_dist
if _dist.is_dir() and (_dist / "index.html").is_file():
    _assets_dir = _dist / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Let unknown /api/* requests 404 instead of returning the SPA shell.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:
    logging.getLogger(__name__).info(
        "Frontend dist not found at %s — API-only mode (use Vite dev server).", _dist
    )
