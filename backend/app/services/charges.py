"""Indian equity-delivery brokerage + statutory charges (FY-2025 approximation).

Rates are based on publicly-documented retail delivery rates (Zerodha /
industry-typical). Values are approximate and for simulation only — not
for tax advice or production-accurate reporting.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

BROKERAGE_PCT = 0.0003         # 0.03% (with cap)
BROKERAGE_CAP = 20.0
STT_SELL_PCT = 0.001            # 0.1% on sell value (equity delivery)
EXCHANGE_TXN_PCT = 0.0000297    # 0.00297% NSE equity
SEBI_PCT = 0.000001             # 0.0001% (₹10 per Cr)
STAMP_DUTY_BUY_PCT = 0.00015    # 0.015% on buy value
GST_PCT = 0.18                  # 18% on brokerage + exchange + SEBI
DP_CHARGE_SELL = 15.93          # flat per-scrip sell day

MF_EXIT_LOAD_PCT = 0.0          # Direct-Growth; exit load handled per-scheme later


@dataclass(frozen=True)
class ChargeLine:
    brokerage: float
    stt: float
    exchange: float
    sebi: float
    stamp_duty: float
    gst: float
    dp_charges: float

    @property
    def total(self) -> float:
        return (
            self.brokerage
            + self.stt
            + self.exchange
            + self.sebi
            + self.stamp_duty
            + self.gst
            + self.dp_charges
        )

    def to_dict(self) -> dict[str, float]:
        d = asdict(self)
        d["total"] = round(self.total, 4)
        return {k: round(v, 4) for k, v in d.items()}


def _round(x: float) -> float:
    return round(x, 4)


def equity_charges(gross: float, side: str) -> ChargeLine:
    side = side.upper()
    brokerage = min(gross * BROKERAGE_PCT, BROKERAGE_CAP)
    stt = gross * STT_SELL_PCT if side == "SELL" else 0.0
    exchange = gross * EXCHANGE_TXN_PCT
    sebi = gross * SEBI_PCT
    stamp_duty = gross * STAMP_DUTY_BUY_PCT if side == "BUY" else 0.0
    gst = (brokerage + exchange + sebi) * GST_PCT
    dp = DP_CHARGE_SELL if side == "SELL" else 0.0
    return ChargeLine(
        brokerage=_round(brokerage),
        stt=_round(stt),
        exchange=_round(exchange),
        sebi=_round(sebi),
        stamp_duty=_round(stamp_duty),
        gst=_round(gst),
        dp_charges=_round(dp),
    )


def mf_charges(gross: float, side: str) -> ChargeLine:
    """Direct-Growth mutual funds have no brokerage or statutory charges on
    purchase/redemption beyond scheme-specific exit loads. STT on equity MF
    sells is ~0.001% but negligible for simulation granularity; we keep zero
    and capture tax differences in taxes.py instead.
    """
    return ChargeLine(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)


def charges_for(instrument_type: str, gross: float, side: str) -> ChargeLine:
    if instrument_type == "stock":
        return equity_charges(gross, side)
    return mf_charges(gross, side)
