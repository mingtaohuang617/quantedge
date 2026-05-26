#!/usr/bin/env python3
"""
QuantEdge 分钟级行情按需拉取 CLI（不落库）
==========================================
B 路径"内存版"：通过 data_sources.router 拉 intraday K 线，输出 stdout / 文件。
日 K 主流程仍走 pipeline.py，本脚本独立。

yfinance interval 滚动窗口（实测）：
    1m  → 最近 ~7 个交易日
    5m  → 最近 60 天
    15m → 最近 60 天
    1h  → 最近 730 天

示例:
    # 打印 SPY 过去 5 天 1m K 到 stdout（CSV）
    python backend/pipeline_intraday.py --ticker SPY --interval 1m --lookback-days 5

    # 写 JSON
    python backend/pipeline_intraday.py --ticker QQQ --interval 5m --out qqq_5m.json

输出列：timestamp(UTC ISO8601) / Open / High / Low / Close / Volume。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import Interval, fetch_history


def _cfg_for_ticker(ticker: str, market: str) -> dict:
    """最小 cfg —— router 只读 yf_symbol 和 market；不依赖 SQLite 元数据。"""
    return {"yf_symbol": ticker, "market": market.upper(), "name": ticker}


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    """统一输出 schema：timestamp + OHLCV。"""
    out = []
    for ts, row in df.iterrows():
        # router 对 intraday 已 tz_convert("UTC")；日 K tz-naive 按 UTC 视
        if hasattr(ts, "tz_convert") and ts.tz is not None:
            iso = ts.tz_convert("UTC").isoformat()
        elif hasattr(ts, "isoformat"):
            iso = ts.isoformat()
        else:
            iso = str(ts)
        out.append({
            "timestamp": iso,
            "open":  float(row["Open"])  if pd.notna(row.get("Open"))  else None,
            "high":  float(row["High"])  if pd.notna(row.get("High"))  else None,
            "low":   float(row["Low"])   if pd.notna(row.get("Low"))   else None,
            "close": float(row["Close"]) if pd.notna(row.get("Close")) else None,
            "volume": int(row["Volume"]) if pd.notna(row.get("Volume")) else None,
        })
    return out


def fetch_intraday(
    ticker: str,
    interval: str | Interval,
    lookback_days: int,
    market: str = "US",
) -> tuple[list[dict], str]:
    """拉一个标的，返回 (records, source_name)。"""
    iv = Interval.from_str(interval)
    cfg = _cfg_for_ticker(ticker, market)
    df, src = fetch_history(cfg, days=lookback_days, interval=iv)
    return _df_to_records(df), src


def _write_csv(records: list[dict], fp) -> None:
    fp.write("timestamp,open,high,low,close,volume\n")
    for r in records:
        fp.write(
            f"{r['timestamp']},"
            f"{r['open'] if r['open'] is not None else ''},"
            f"{r['high'] if r['high'] is not None else ''},"
            f"{r['low']  if r['low']  is not None else ''},"
            f"{r['close']if r['close']is not None else ''},"
            f"{r['volume'] if r['volume'] is not None else ''}\n"
        )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="QuantEdge intraday 按需拉取（不落库）")
    ap.add_argument("--ticker", required=True, help="yfinance symbol，例如 SPY / 0005.HK")
    ap.add_argument(
        "--interval", required=True,
        choices=[i.value for i in Interval],
        help="K 线周期",
    )
    ap.add_argument("--lookback-days", type=int, default=5, help="回溯自然日，默认 5")
    ap.add_argument("--market", default="US", help="市场（US/HK/SH/SZ/KR/JP），默认 US")
    ap.add_argument(
        "--out", type=Path, default=None,
        help="输出路径；不指定则写 stdout（CSV）。后缀 .json → JSON；其他 → CSV",
    )
    args = ap.parse_args(argv)

    try:
        records, src = fetch_intraday(
            ticker=args.ticker,
            interval=args.interval,
            lookback_days=args.lookback_days,
            market=args.market,
        )
    except Exception as e:
        print(f"[pipeline_intraday] FAILED: {e}", file=sys.stderr)
        return 1

    print(
        f"[pipeline_intraday] {args.ticker} {args.interval} "
        f"rows={len(records)} src={src}",
        file=sys.stderr,
    )

    if args.out is None:
        _write_csv(records, sys.stdout)
    elif args.out.suffix.lower() == ".json":
        args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[pipeline_intraday] wrote {args.out}", file=sys.stderr)
    else:
        with args.out.open("w", encoding="utf-8", newline="") as fp:
            _write_csv(records, fp)
        print(f"[pipeline_intraday] wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
