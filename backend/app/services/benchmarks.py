from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.pricing import index_between


def cagr(start_value: float, end_value: float, days: int) -> float:
    if start_value <= 0 or days <= 0:
        return 0.0
    years = days / 365.25
    if years <= 0:
        return 0.0
    return (end_value / start_value) ** (1.0 / years) - 1.0


def max_drawdown(curve: list[float]) -> float:
    if not curve:
        return 0.0
    peak = curve[0]
    mdd = 0.0
    for v in curve:
        peak = max(peak, v)
        if peak > 0:
            dd = (v - peak) / peak
            if dd < mdd:
                mdd = dd
    return mdd


def benchmark_curve_index(
    db: Session, index_name: str, start: date, end: date, starting_nav: float
) -> list[tuple[date, float]]:
    series = index_between(db, index_name, start, end)
    if not series:
        return []
    base = series[0][1]
    return [(d, starting_nav * (v / base)) for d, v in series]


def benchmark_curve_fd(start: date, end: date, starting_nav: float) -> list[tuple[date, float]]:
    """Daily-compounded FD at configured annual rate."""
    rate = settings.fd_annual_rate
    out: list[tuple[date, float]] = []
    d = start
    one_day = timedelta(days=1)
    daily = (1 + rate) ** (1 / 365.25) - 1
    nav = starting_nav
    # Emit a sample every 7 days for compactness
    step = 0
    while d <= end:
        if step % 7 == 0:
            out.append((d, nav))
        nav *= 1 + daily
        d += one_day
        step += 1
    out.append((end, nav))
    return out
