"""
yfinance 数据源
================
用于美股等富途无权限的市场。延迟约 15 分钟，但免费且覆盖全。
"""
import math

import pandas as pd
import yfinance as yf

from ._intervals import Interval, yfinance_period_for


class YFinanceError(RuntimeError):
    pass


def fetch_history(
    cfg: dict,
    days: int = 120,
    interval: Interval | str = Interval.DAY_1,
) -> pd.DataFrame:
    """
    拉取 K 线，返回标准化 DataFrame：
      列：Open / High / Low / Close / Volume
      索引：DatetimeIndex
        - 日 K（默认）：tz-naive
        - 分钟/小时级 (intraday)：tz-aware，统一 tz_convert("UTC")

    interval 默认 DAY_1，保持向后兼容。
    分钟级仅 yfinance 7 天滚动窗口可用；超出请用日 K 或外部历史源。
    """
    iv = Interval.from_str(interval)
    symbol = cfg["yf_symbol"]
    period = yfinance_period_for(iv, days)
    tk = yf.Ticker(symbol)
    df = tk.history(period=period, interval=iv.value)
    if df is None or df.empty:
        # 仅日 K 做"再试 1mo"兜底；分钟级直接抛错（period 已是上限）
        if not iv.is_intraday:
            df = tk.history(period="1mo")
        if df is None or df.empty:
            raise YFinanceError(
                f"yfinance 无法获取 {symbol} 行情数据 (interval={iv.value})"
            )
    out = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    # intraday 统一 UTC；日 K 保持原 tz-naive，避免动既有 daily 调用
    if iv.is_intraday and getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_convert("UTC")
    return out


# ── 价值型基本面字段 ────────────────────────────────────
def fetch_fundamentals(yf_symbol: str) -> dict:
    """拉单只标的的估值/质量/股东回报字段。

    返回 5 个 key（缺失时置 None，调用方需容错）：
      - pe: trailingPE (TTM)
      - pb: priceToBook
      - dividend_yield: 0~1 小数（如 0.066 = 6.6%）
      - roe: returnOnEquity，0~1 小数
      - debt_to_equity: yfinance 给的是百分数（如 162 = 1.62），统一除 100 转小数
    任何失败都抛 YFinanceError；上游决定是否跳过。
    """
    if not yf_symbol:
        raise YFinanceError("yf_symbol 不能为空")
    tk = yf.Ticker(yf_symbol)
    try:
        info = tk.info or {}
    except Exception as e:
        raise YFinanceError(f"yfinance .info 失败 ({yf_symbol}): {e}") from e

    def _f(key):
        v = info.get(key)
        if v is None:
            return None
        try:
            f = float(v)
            # NaN/Inf → None
            if math.isnan(f) or math.isinf(f):
                return None
            return f
        except (TypeError, ValueError):
            return None

    de_pct = _f("debtToEquity")
    return {
        "pe": _f("trailingPE"),
        "pb": _f("priceToBook"),
        "dividend_yield": _f("dividendYield"),
        "roe": _f("returnOnEquity"),
        # yfinance debtToEquity 单位是百分比，例如 Verizon 显示 162（=1.62 倍）
        "debt_to_equity": (de_pct / 100.0) if de_pct is not None else None,
    }
