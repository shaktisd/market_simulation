from fastapi import APIRouter

from app.api import analytics, game, history, market, orders, portfolio

api_router = APIRouter(prefix="/api")
api_router.include_router(game.router)
api_router.include_router(orders.router)
api_router.include_router(portfolio.router)
api_router.include_router(market.router)
api_router.include_router(analytics.router)
api_router.include_router(history.router)
