"""Convert absolute (date, value) series to masked t-index series.

The golden rule: the frontend must never receive a real calendar date while a
game is active. This module is the single choke-point that enforces that rule.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable


def mask_series(
    series: Iterable[tuple[date, float]],
    anchor: date,
) -> list[tuple[int, float]]:
    """Return points as (t_index, value) where t_index <= 0 and anchor == 0.

    Points are emitted in chronological order. `t` is the negative number of
    sample points before the anchor (i.e. t = -N for the oldest sample, t = 0
    for the anchor sample). No calendar information is retained.
    """
    points = [(d, v) for d, v in series if d <= anchor]
    points.sort(key=lambda p: p[0])
    n = len(points)
    return [(-(n - 1 - i), v) for i, (_, v) in enumerate(points)]
