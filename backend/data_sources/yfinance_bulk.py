"""
yfinance 批量拉取（专给 breadth_engine 用）
============================================
用 yf.download() 一次拉多个 ticker 的 OHLC，写到 daily_bars 表。
比走 router 单只快 10-50x，但只用 yfinance（不做 fallback）。
breadth 计算只需要 close，所以我们只写 close + 必要的索引字段。
"""
from __future__ import annotations

import time

import pandas as pd

import db

try:
    import yfinance as yf
    HAS_YF = True
except ImportError:
    HAS_YF = False


def _extract_ticker_df(big_df: pd.DataFrame, sym: str, single: bool):
    """从 yf.download 多 ticker 返回中拆出单只的 DataFrame。"""
    if single:
        return big_df
    try:
        return big_df[sym]
    except KeyError:
        return None


def bulk_sync_close(
    symbols: list[tuple[str, str]],
    start: str = "2024-01-01",
    end: str | None = None,
    batch_size: int = 100,
) -> dict:
    """
    symbols: [(internal_ticker, yf_symbol), ...]
    batch_size: yf.download 一次拉的股票数（Yahoo 100 内稳定）

    返回 {ticker: bars_written}。失败的 ticker 不在返回里。
    """
    if not HAS_YF:
        raise RuntimeError("yfinance 未安装")
    if not symbols:
        return {}

    out: dict[str, int] = {}
    for i in range(0, len(symbols), batch_size):
        chunk = symbols[i:i + batch_size]
        yf_syms = [yf for _, yf in chunk]
        t0 = time.time()
        df = yf.download(
            yf_syms, start=start, end=end, auto_adjust=False,
            group_by="ticker", progress=False, threads=True,
        )
        single = len(chunk) == 1
        for ticker, yf_sym in chunk:
            tdf = _extract_ticker_df(df, yf_sym, single)
            if tdf is None or tdf.empty:
                continue
            rows = []
            for ts, row in tdf.iterrows():
                close = row.get("Close")
                if close is None or pd.isna(close):
                    continue
                d = ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]

                def _f(v):
                    return float(v) if v is not None and not pd.isna(v) else None

                def _i(v):
                    return int(v) if v is not None and not pd.isna(v) else None

                rows.append({
                    "trade_date": d,
                    "open":   _f(row.get("Open")),
                    "high":   _f(row.get("High")),
                    "low":    _f(row.get("Low")),
                    "close":  float(close),
                    "volume": _i(row.get("Volume")),
                    "amount": None,
                    "adj_factor": 1.0,
                })
            if rows:
                try:
                    db.upsert_bars(ticker, rows, source="yfinance")
                    out[ticker] = len(rows)
                except Exception as e:
                    print(f"  [warn] upsert {ticker} failed: {e}")
        elapsed = time.time() - t0
        ok = sum(1 for t, _ in chunk if t in out)
        print(f"  batch {i//batch_size + 1}: {ok}/{len(chunk)} ok ({elapsed:.1f}s)")
    return out
