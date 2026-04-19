"""Strategy registry + catalog seeding."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AlgoStrategy as AlgoStrategyModel
from app.services.algos.base import Strategy
from app.services.algos.strategies import ALL_STRATEGIES

STRATEGIES: dict[str, Strategy] = {s.key: s for s in ALL_STRATEGIES}


def seed_catalog(db: Session) -> None:
    """Upsert strategy rows into the catalog table. Safe to call on every startup."""
    for s in ALL_STRATEGIES:
        db.merge(
            AlgoStrategyModel(
                key=s.key,
                display_name=s.display_name,
                description=s.description,
            )
        )
