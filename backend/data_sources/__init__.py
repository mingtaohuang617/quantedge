"""
数据源模块（多源版）
====================
统一封装行情/报价/财务数据获取，按优先级路由到不同数据源：
  - 行情K线:  L0 SQLite → tushare → iTick → Futu(港股) → yfinance
  - 实时报价:  iTick → yfinance
  - 公司信息:  iTick
  - 港股财务:  AKShare(东方财富)
  - 搜索:     AKShare

容错：
  缺任一可选依赖（futu / akshare / tushare）时仍能 import；缺失源会从路由链中
  自动跳过。错误信息打印到 stderr 但不抛异常。
"""
import os
import sys

# ── futu 库 protobuf 兼容（必须在 futu 被 import 前设置）──
# 用户的 protobuf 版本若 ≥3.20，会与 futu 自带的 .pb 文件冲突，触发
# `TypeError: Descriptors cannot be created directly`。设环境变量切到
# pure-python 实现可绕开。（性能稍差，根治请 `pip install "protobuf<3.20.4"`）
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

# ── 容错 import router（router 内部已对各源做 try/except）──
try:
    from .router import (
        fetch_history,
        fetch_quote,
        fetch_info,
        fetch_hk_fundamentals,
        search_stocks,
        health_check,
    )
    _ROUTER_OK = True
except Exception as _e:
    print(f"[data_sources] router import failed: {_e}", file=sys.stderr)
    _ROUTER_OK = False

    # 提供占位 stub，避免上层 import 直接挂
    def _unavailable(*args, **kwargs):
        raise RuntimeError(
            "data_sources.router 未能加载，请检查依赖（futu/akshare/itick 等）"
        )

    fetch_history = _unavailable
    fetch_quote = _unavailable
    fetch_info = _unavailable
    fetch_hk_fundamentals = _unavailable
    search_stocks = _unavailable

    def health_check():
        return {"router": (False, "router 未加载")}


__all__ = [
    "fetch_history",
    "fetch_quote",
    "fetch_info",
    "fetch_hk_fundamentals",
    "search_stocks",
    "health_check",
]
