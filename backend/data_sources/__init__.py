"""
数据源模块（多源版）
====================
统一封装行情/报价/财务数据获取，按优先级路由到不同数据源：
  - 行情K线:  iTick → Futu(港股) → yfinance
  - 实时报价:  iTick → yfinance
  - 公司信息:  iTick
  - 港股财务:  AKShare(东方财富)
  - 搜索:     AKShare
"""
from .router import (
    fetch_history,
    fetch_quote,
    fetch_info,
    fetch_hk_fundamentals,
    search_stocks,
    health_check,
)

__all__ = [
    "fetch_history",
    "fetch_quote",
    "fetch_info",
    "fetch_hk_fundamentals",
    "search_stocks",
    "health_check",
]
