from app.services.algos.strategies.equal_weight_n50 import EqualWeightN50
from app.services.algos.strategies.low_vol import LowVolatility
from app.services.algos.strategies.mean_reversion import MeanReversion
from app.services.algos.strategies.momentum import Momentum
from app.services.algos.strategies.quality import Quality
from app.services.algos.strategies.risk_parity import RiskParity
from app.services.algos.strategies.value import Value

ALL_STRATEGIES = [
    Momentum(),
    Value(),
    LowVolatility(),
    Quality(),
    RiskParity(),
    MeanReversion(),
    EqualWeightN50(),
]

__all__ = [
    "ALL_STRATEGIES",
    "EqualWeightN50",
    "LowVolatility",
    "MeanReversion",
    "Momentum",
    "Quality",
    "RiskParity",
    "Value",
]
