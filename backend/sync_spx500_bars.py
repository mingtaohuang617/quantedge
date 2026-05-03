"""
拉取 SP500 全部成分股的日 K 线到 daily_bars
============================================
读 index_constituents 里 SP500 的当前成分股，用 yfinance 批量下载（默认 18 个月），
写入 daily_bars。breadth_engine 之后基于此表计算 200 日均线占比 / AD 线 / 新高新低 等。

用法:
    cd backend
    python sync_spx500_bars.py [--start YYYY-MM-DD] [--limit N]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import db  # noqa: E402
from data_sources.yfinance_bulk import bulk_sync_close  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2024-01-01", help="拉取起始日（默认 2024-01-01）")
    ap.add_argument("--limit", type=int, default=0, help="只拉前 N 只（debug 用）")
    args = ap.parse_args()

    db.init_db()
    conn = db._get_conn()
    rows = conn.execute(
        """
        SELECT ticker, yf_symbol FROM index_constituents
        WHERE index_id='SP500' AND removed_date=''
        ORDER BY ticker
        """
    ).fetchall()
    if not rows:
        print("index_constituents 没有 SP500 成分股；先跑 python load_spx500.py")
        return 1

    symbols = [(r["ticker"], r["yf_symbol"]) for r in rows]
    if args.limit > 0:
        symbols = symbols[:args.limit]

    print(f"开始批量拉取 {len(symbols)} 只 SP500 成分股，start={args.start}")
    t0 = time.time()
    out = bulk_sync_close(symbols, start=args.start, batch_size=100)
    elapsed = time.time() - t0

    total_bars = sum(out.values())
    ok = len(out)
    fail = len(symbols) - ok
    print(f"\n汇总：成功 {ok}/{len(symbols)} ticker，失败 {fail}，"
          f"共写入 {total_bars} 行，耗时 {elapsed:.1f}s")
    if fail:
        ok_set = set(out.keys())
        missed = [t for t, _ in symbols if t not in ok_set]
        print(f"  失败列表: {missed[:20]}{' …' if len(missed) > 20 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
