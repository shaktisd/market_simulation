from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Stock(Base):
    __tablename__ = "stocks"
    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    company_name: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str] = mapped_column(String(128))
    isin: Mapped[str] = mapped_column(String(32))
    yf_ticker: Mapped[str] = mapped_column(String(48))
    coverage_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    coverage_end: Mapped[date | None] = mapped_column(Date, nullable=True)


class StockPrice(Base):
    __tablename__ = "stock_prices"
    symbol: Mapped[str] = mapped_column(String(32), ForeignKey("stocks.symbol"), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float)
    adj_close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)


class StockFundamental(Base):
    __tablename__ = "stock_fundamentals"
    symbol: Mapped[str] = mapped_column(String(32), ForeignKey("stocks.symbol"), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    pe: Mapped[float | None] = mapped_column(Float, nullable=True)
    pb: Mapped[float | None] = mapped_column(Float, nullable=True)
    eps: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)


class IndexPrice(Base):
    __tablename__ = "index_prices"
    index_name: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float)


class MFScheme(Base):
    __tablename__ = "mf_master"
    scheme_code: Mapped[int] = mapped_column(Integer, primary_key=True)
    scheme_name: Mapped[str] = mapped_column(String(255))
    fund_house: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    plan: Mapped[str] = mapped_column(String(16))  # Direct / Regular
    option: Mapped[str] = mapped_column(String(16))  # Growth / Dividend
    last_refreshed: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MFNav(Base):
    __tablename__ = "mf_nav"
    scheme_code: Mapped[int] = mapped_column(
        Integer, ForeignKey("mf_master.scheme_code"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    nav: Mapped[float] = mapped_column(Float)


class Game(Base):
    __tablename__ = "games"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    step_unit: Mapped[str] = mapped_column(String(8))  # day | week | month
    hidden_start_date: Mapped[date] = mapped_column(Date)
    hidden_end_date: Mapped[date] = mapped_column(Date)
    current_date: Mapped[date] = mapped_column(Date)
    starting_cash: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | ended
    turn_index: Mapped[int] = mapped_column(Integer, default=0)

    holdings: Mapped[list["Holding"]] = relationship(back_populates="game", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship(back_populates="game", cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("game_id", "instrument_type", "symbol"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), index=True)
    instrument_type: Mapped[str] = mapped_column(String(8))  # stock | mf
    symbol: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_cost: Mapped[float] = mapped_column(Float, default=0.0)
    first_buy_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    game: Mapped[Game] = relationship(back_populates="holdings")


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), index=True)
    turn_index: Mapped[int] = mapped_column(Integer)
    instrument_type: Mapped[str] = mapped_column(String(8))
    symbol: Mapped[str] = mapped_column(String(64))
    side: Mapped[str] = mapped_column(String(4))  # BUY | SELL
    quantity: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    gross: Mapped[float] = mapped_column(Float)
    charges: Mapped[float] = mapped_column(Float)
    net_cashflow: Mapped[float] = mapped_column(Float)
    charges_breakdown: Mapped[str] = mapped_column(Text)  # JSON
    executed_hidden_date: Mapped[date] = mapped_column(Date)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)

    game: Mapped[Game] = relationship(back_populates="orders")


class TurnSnapshot(Base):
    __tablename__ = "turn_snapshots"
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), primary_key=True)
    turn_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    nav: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)
    holdings_mv: Mapped[float] = mapped_column(Float)
    hidden_date: Mapped[date] = mapped_column(Date)


class GameResult(Base):
    __tablename__ = "game_results"
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), primary_key=True)
    final_nav: Mapped[float] = mapped_column(Float)
    cagr: Mapped[float] = mapped_column(Float)
    max_drawdown: Mapped[float] = mapped_column(Float)
    total_charges: Mapped[float] = mapped_column(Float)
    total_taxes: Mapped[float] = mapped_column(Float)
    benchmark_nifty50_cagr: Mapped[float | None] = mapped_column(Float, nullable=True)
    benchmark_nifty500_cagr: Mapped[float | None] = mapped_column(Float, nullable=True)
    benchmark_fd_cagr: Mapped[float | None] = mapped_column(Float, nullable=True)
    revealed_start_date: Mapped[date] = mapped_column(Date)
    revealed_end_date: Mapped[date] = mapped_column(Date)
