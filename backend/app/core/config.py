from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

REPO_ROOT = BACKEND_DIR.parent
UNIVERSE_CSV = REPO_ROOT / "docs" / "ind_nifty500list.csv"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_path: Path = DATA_DIR / "market.sqlite"
    starting_cash: float = 1_00_00_000.0  # 1 Cr INR
    min_game_days: int = 365
    max_game_days: int = 3650
    earliest_start_year: int = 2010
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    mf_master_url: str = "https://api.mfapi.in/mf"
    mf_nav_url: str = "https://api.mfapi.in/mf/{code}"
    mf_master_ttl_hours: int = 24
    fd_annual_rate: float = 0.07
    yf_start_date: str = "2008-01-01"
    enable_algo_strategies: bool = True
    incremental_algos: bool = True

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"


settings = Settings()
