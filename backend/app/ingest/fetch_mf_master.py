"""CLI helper to pre-refresh the MF master list (normally done on server start)."""
from __future__ import annotations

import logging

from app.core.db import init_db, session_scope
from app.services.mf_api import refresh_master_if_stale


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_db()
    with session_scope() as db:
        n = refresh_master_if_stale(db)
        print(f"MF master: {n} curated schemes available.")


if __name__ == "__main__":
    main()
