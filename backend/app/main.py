from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
