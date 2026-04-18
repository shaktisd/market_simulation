"""Client for https://api.mfapi.in/mf with SQLite-backed caching.

- Master list is cached for settings.mf_master_ttl_hours (default 24h).
- Per-scheme NAV history is fetched lazily on first request and cached forever
  (NAV is append-only historical data — we only ever extend it, never rewrite).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import MFNav, MFScheme

log = logging.getLogger(__name__)

# Curated AMC list to keep universe teaching-friendly (~top-AUM fund houses).
CURATED_AMCS = {
    "SBI", "ICICI Prudential", "HDFC", "Axis", "Kotak", "Nippon India",
    "Aditya Birla Sun Life", "UTI", "Mirae Asset", "DSP", "Franklin",
    "Tata", "Invesco", "Edelweiss", "PGIM India", "Parag Parikh", "Quant",
    "Motilal Oswal", "Canara Robeco", "Sundaram",
}

CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    ("Index", "Index / ETF"),
    ("Nifty", "Index / ETF"),
    ("Sensex", "Index / ETF"),
    ("ETF", "Index / ETF"),
    ("Large Cap", "Large Cap"),
    ("Large & Mid Cap", "Large & Mid Cap"),
    ("Large and Mid Cap", "Large & Mid Cap"),
    ("Mid Cap", "Mid Cap"),
    ("Small Cap", "Small Cap"),
    ("Flexi Cap", "Flexi Cap"),
    ("Multi Cap", "Multi Cap"),
    ("ELSS", "ELSS"),
    ("Tax", "ELSS"),
    ("Hybrid", "Hybrid"),
    ("Balanced", "Hybrid"),
    ("Debt", "Debt"),
    ("Liquid", "Debt"),
    ("Overnight", "Debt"),
    ("Gilt", "Debt"),
]


def _infer_category(name: str) -> str | None:
    for kw, label in CATEGORY_KEYWORDS:
        if kw.lower() in name.lower():
            return label
    return None


def _parse_plan_option(name: str) -> tuple[str | None, str | None]:
    n = name.lower()
    plan = "Direct" if "direct" in n else ("Regular" if "regular" in n else None)
    if "growth" in n:
        option = "Growth"
    elif "idcw" in n or "dividend" in n:
        option = "IDCW"
    else:
        option = None
    return plan, option


def _infer_fund_house(name: str) -> str | None:
    for amc in CURATED_AMCS:
        if name.lower().startswith(amc.lower()):
            return amc
    # Try prefix match on first 2-3 words
    first_two = " ".join(name.split()[:2])
    for amc in CURATED_AMCS:
        if first_two.lower().startswith(amc.lower()):
            return amc
    return None


def refresh_master_if_stale(db: Session) -> int:
    """Fetch the full mfapi.in master list and keep every Direct-Growth scheme.

    Categorization (large/mid/small/index/etc.) is best-effort from the scheme
    name — anything that doesn't match a keyword falls into "Other".
    Fund-house is matched against a known-AMC list when possible.
    Returns total schemes in DB after refresh.
    """
    latest = db.execute(select(MFScheme.last_refreshed).limit(1)).scalar_one_or_none()
    existing_count = db.query(MFScheme).count()
    if latest is not None:
        age_h = (datetime.utcnow() - latest).total_seconds() / 3600
        # Skip refresh only if the cached set is reasonably-sized AND fresh.
        # A small cache (<1000) is treated as stale to invalidate older curated
        # snapshots that pre-date the move to the full Direct-Growth catalog.
        if age_h < settings.mf_master_ttl_hours and existing_count >= 1000:
            return existing_count

    log.info("Refreshing MF master list from %s", settings.mf_master_url)
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(settings.mf_master_url)
        resp.raise_for_status()
        data = resp.json()

    now = datetime.utcnow()
    kept_codes: set[int] = set()
    rows: list[dict] = []

    for item in data:
        name: str = item.get("schemeName", "")
        code = item.get("schemeCode")
        if not code or not name:
            continue
        plan, option = _parse_plan_option(name)
        if plan != "Direct" or option != "Growth":
            continue
        try:
            code_int = int(code)
        except (TypeError, ValueError):
            continue
        if code_int in kept_codes:
            continue
        kept_codes.add(code_int)
        rows.append({
            "scheme_code": code_int,
            "scheme_name": name,
            "fund_house": _infer_fund_house(name),
            "category": _infer_category(name) or "Other",
            "plan": plan,
            "option": option,
            "last_refreshed": now,
        })

    # Bulk upsert via SQLite-flavored INSERT OR REPLACE for speed (~10k rows).
    if rows:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(MFScheme).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["scheme_code"],
            set_={
                "scheme_name": stmt.excluded.scheme_name,
                "fund_house": stmt.excluded.fund_house,
                "category": stmt.excluded.category,
                "plan": stmt.excluded.plan,
                "option": stmt.excluded.option,
                "last_refreshed": stmt.excluded.last_refreshed,
            },
        )
        db.execute(stmt)
    db.commit()
    log.info("MF master refreshed: %d Direct-Growth schemes available", len(rows))
    return len(rows)


_NAV_DATE_RE = re.compile(r"^\d{2}-\d{2}-\d{4}$")


def ensure_nav_history(db: Session, scheme_code: int) -> int:
    """Fetch + cache NAV history for a scheme if not already cached.
    Returns number of NAV rows for the scheme after load.
    """
    existing = db.query(MFNav).filter(MFNav.scheme_code == scheme_code).count()
    if existing > 0:
        return existing

    url = settings.mf_nav_url.format(code=scheme_code)
    log.info("Fetching NAV history for %d from %s", scheme_code, url)
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as e:
        log.warning("NAV fetch failed for scheme %d: %s", scheme_code, e)
        return 0

    rows = payload.get("data", []) or []
    inserted = 0
    for r in rows:
        d_str = r.get("date")
        nav_str = r.get("nav")
        if not d_str or not nav_str or not _NAV_DATE_RE.match(d_str):
            continue
        try:
            dt = datetime.strptime(d_str, "%d-%m-%Y").date()
            nav = float(nav_str)
        except (ValueError, TypeError):
            continue
        db.add(MFNav(scheme_code=scheme_code, date=dt, nav=nav))
        inserted += 1
    db.commit()
    if inserted == 0:
        log.warning("Scheme %d returned 0 usable NAV rows (payload had %d)", scheme_code, len(rows))
    else:
        log.info("Scheme %d: cached %d NAV rows", scheme_code, inserted)
    return inserted


def list_schemes(db: Session, category: str | None = None) -> Iterable[MFScheme]:
    q = db.query(MFScheme)
    if category:
        q = q.filter(MFScheme.category == category)
    return q.order_by(MFScheme.scheme_name).all()
