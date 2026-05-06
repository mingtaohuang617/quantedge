"""
yfinance 时间序列源（薄层）
============================
拉指数/ETF 的"日收盘"作为通用时间序列写到 series_observations。
跟现有 yfinance_source.py（OHLC bars）解耦：那个走 router 用于个股；
本模块只产 close 单值给宏观/情绪因子用。

publish_date == value_date（日收盘当日可见，无修订概念）。
"""
from __future__ import annotations

from datetime import datetime

import factors_lib as _fl

try:
    import yfinance as yf
    HAS_YF = True
except ImportError:
    HAS_YF = False


class YFSeriesError(RuntimeError):
    pass


def fetch_close_series(yf_symbol: str, start: str = "1990-01-01") -> list[dict]:
    """返回 [{value_date, publish_date, value}, ...]，按 value_date 升序。"""
    if not HAS_YF:
        raise YFSeriesError("yfinance 未安装")
    df = yf.Ticker(yf_symbol).history(start=start, auto_adjust=False)
    if df is None or df.empty:
        raise YFSeriesError(f"yfinance 拉取空数据: {yf_symbol}")
    rows: list[dict] = []
    for ts, row in df.iterrows():
        close = row.get("Close")
        if close is None or close != close:  # 跳 NaN
            continue
        d = ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]
        rows.append({"value_date": d, "publish_date": d, "value": float(close)})
    return rows


def sync_series(
    local_series_id: str,
    yf_symbol: str,
    *,
    name: str,
    market: str = "US",
    frequency: str = "daily",
    description: str | None = None,
    start: str = "1990-01-01",
) -> int:
    rows = fetch_close_series(yf_symbol, start=start)
    _fl.upsert_series_meta(
        series_id=local_series_id,
        name=name,
        source="yfinance",
        source_id=yf_symbol,
        frequency=frequency,
        unit=None,
        market=market,
        description=description or f"yfinance {yf_symbol} 日收盘",
    )
    return _fl.upsert_observations(local_series_id, rows, source="yfinance")
