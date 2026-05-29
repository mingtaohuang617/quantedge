#!/usr/bin/env python3
"""
富途优先批量拉取历史日 K（充分利用富途 OpenD 额度）
====================================================
标的源 = config.TICKERS + tickers_custom.json（合并去重）+ db daily_bars 已有。
按优先级拉数据写库：富途 OpenD (HK/US/SH/SZ) → yfinance 兜底 (KR/JP 及富途失败)。

富途前复权日 K，质量高速度快（~0.2s/只）。upsert_bars 源优先级 futu(3)>yfinance(1)，
富途数据自动覆盖此前 yfinance 旧数据。

用法:
    python sync_futu_bulk.py                # 全量 2 年
    python sync_futu_bulk.py --days 1095    # 3 年
    python sync_futu_bulk.py --only-new     # 只拉 db 里还没有的标的（增量扩充用）
    python sync_futu_bulk.py --limit 20     # 测试
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except ImportError:
    pass

import config
import db
from data_sources import futu_source, yfinance_source
try:
    from data_sources.router import _df_to_rows
except Exception:
    import math
    import pandas as pd

    def _df_to_rows(df):
        rows = []
        for idx, r in df.iterrows():
            c = r.get("Close")
            if c is None or (isinstance(c, float) and (math.isnan(c) or math.isinf(c))) or c <= 0:
                continue
            d_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            rows.append({
                "trade_date": d_str,
                "open": float(r["Open"]) if pd.notna(r.get("Open")) else None,
                "high": float(r["High"]) if pd.notna(r.get("High")) else None,
                "low": float(r["Low"]) if pd.notna(r.get("Low")) else None,
                "close": float(c),
                "volume": int(r["Volume"]) if pd.notna(r.get("Volume")) else None,
                "adj_factor": 1.0,
            })
        return rows

FUTU_MARKETS = {"HK", "US", "SH", "SZ", "CN"}
CUSTOM_PATH = BACKEND / "tickers_custom.json"


def infer_market(ticker: str) -> str:
    t = ticker.upper()
    if t.endswith(".HK"):
        return "HK"
    if t.endswith(".SS") or t.endswith(".SH"):
        return "SH"
    if t.endswith(".SZ"):
        return "SZ"
    if t.endswith(".KS") or t.endswith(".KQ"):
        return "KR"
    if t.endswith(".T"):
        return "JP"
    return "US"


def yfinance_symbol(ticker: str, market: str, cfg: dict) -> str:
    if cfg.get("yf_symbol"):
        return cfg["yf_symbol"]
    if market == "HK":
        base = ticker.split(".")[0].lstrip("0")
        return f"{base.zfill(4)}.HK"
    if market in ("SH", "SZ"):
        return f"{ticker.split('.')[0]}.{('SS' if market=='SH' else 'SZ')}"
    return ticker


def collect_cfgs() -> dict:
    """config + tickers_custom + db daily_bars distinct，合并去重。"""
    cfgs: dict[str, dict] = {}
    cfgs.update(config.TICKERS)
    if CUSTOM_PATH.exists():
        cfgs.update(json.loads(CUSTOM_PATH.read_text(encoding="utf-8")))
    # db 里多出来的（universe 同步进来的）
    conn = db._get_conn()
    for r in conn.execute("SELECT DISTINCT ticker FROM daily_bars"):
        cfgs.setdefault(r[0], {})
    # 补全字段
    for k, v in cfgs.items():
        v.setdefault("ticker", k)
        v.setdefault("market", infer_market(k))
        v.setdefault("yf_symbol", k)
    return cfgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=730)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.4)
    ap.add_argument("--only-new", action="store_true", help="只拉 db 里还没有数据的标的")
    args = ap.parse_args()

    db.init_db()
    cfgs = collect_cfgs()
    tickers = sorted(cfgs.keys())

    if args.only_new:
        conn = db._get_conn()
        have = {r[0] for r in conn.execute("SELECT DISTINCT ticker FROM daily_bars")}
        tickers = [t for t in tickers if t not in have]
    if args.limit > 0:
        tickers = tickers[:args.limit]

    total = len(tickers)
    print(f"[BULK] 目标 {total} 只, days={args.days}, sleep={args.sleep}s, only_new={args.only_new}")

    stats = {"futu": 0, "yfinance": 0, "fail": 0, "bars": 0}
    fails = []

    for i, ticker in enumerate(tickers, 1):
        cfg = dict(cfgs[ticker])
        cfg["ticker"] = ticker
        market = (cfg.get("market") or infer_market(ticker)).upper()
        got = False

        if market in FUTU_MARKETS:
            try:
                df = futu_source.fetch_history(cfg, days=args.days)
                if df is not None and len(df) >= 5:
                    n = db.upsert_bars(ticker, _df_to_rows(df), "futu")
                    stats["futu"] += 1
                    stats["bars"] += n
                    got = True
                time.sleep(args.sleep)
            except Exception:
                pass

        if not got:
            try:
                cfg["yf_symbol"] = yfinance_symbol(ticker, market, cfg)
                df = yfinance_source.fetch_history(cfg, days=args.days)
                if df is not None and len(df) >= 5:
                    n = db.upsert_bars(ticker, _df_to_rows(df), "yfinance")
                    stats["yfinance"] += 1
                    stats["bars"] += n
                    got = True
            except Exception as e:
                fails.append((ticker, str(e)[:50]))

        if not got:
            stats["fail"] += 1
            db.mark_sync_failure(ticker, "bulk", "all sources failed")

        if i % 25 == 0 or i == total:
            print(f"[BULK] {i}/{total} · futu={stats['futu']} yf={stats['yfinance']} "
                  f"fail={stats['fail']} bars+={stats['bars']}")

    print()
    print(f"[BULK DONE] futu={stats['futu']} yfinance={stats['yfinance']} "
          f"fail={stats['fail']} total_bars={stats['bars']}")
    if fails:
        print(f"[BULK] {len(fails)} 只全失败（前 10）:")
        for t, e in fails[:10]:
            print(f"  {t}: {e}")


if __name__ == "__main__":
    main()
