#!/usr/bin/env python3
"""
sync_us — 拉全 NASDAQ + NYSE/AMEX 上市股票元数据
=================================================
数据源：NASDAQ Trader Symbol Directory（公开 FTP，免费、秒级）
  - https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt
  - https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt

输出：backend/output/universe_us.json
  {
    "meta": { "market": "US", "synced_at": "...", "count": N, "source": "...", "enriched": bool },
    "items": [ { ticker, name, market, exchange, is_etf, sector?, industry?, marketCap? }, ... ]
  }

用法：
  python -m backend.universe.sync_us              # 仅拉元数据（秒级，~5000+ 标的）
  python -m backend.universe.sync_us --enrich     # 加跑 yfinance 补 sector/industry/marketCap（慢，~小时级）
  python -m backend.universe.sync_us --enrich --limit 100   # 测试时限量

注意：
  - 不要混进 builtin TICKERS（那是已 tracking 池）
  - --enrich 失败的标的字段保持 None，下次跑可以增量补
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

# 修复 Windows GBK 终端 Unicode 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

# otherlisted.txt 的 Exchange 列代码 → 英文名
EXCHANGE_MAP = {
    "A": "AMEX",
    "N": "NYSE",
    "P": "NYSEArca",
    "Z": "BATS",
    "V": "IEXG",
}

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUTPUT_PATH = OUTPUT_DIR / "universe_us.json"


def fetch_nasdaq_listed() -> list[dict]:
    """NASDAQ 主板 + 全国市场上市股票。"""
    print(f"  GET {NASDAQ_URL}")
    txt = requests.get(NASDAQ_URL, timeout=30).text
    df = pd.read_csv(io.StringIO(txt), sep="|")
    items = []
    for _, row in df.iterrows():
        sym = str(row.get("Symbol", "")).strip()
        # 末尾会有 "File Creation Time: ..." 行，过滤掉
        if not sym or sym.lower().startswith("file"):
            continue
        if str(row.get("Test Issue", "N")).strip().upper() == "Y":
            continue
        items.append({
            "ticker": sym,
            "name": str(row.get("Security Name", "")).strip(),
            "market": "US",
            "exchange": "NASDAQ",
            "is_etf": str(row.get("ETF", "")).strip().upper() == "Y",
            "sector": None,
            "industry": None,
            "marketCap": None,
        })
    print(f"  → NASDAQ 上市 {len(items)} 只")
    return items


def fetch_other_listed() -> list[dict]:
    """NYSE / AMEX / NYSEArca / BATS 上市股票。"""
    print(f"  GET {OTHER_URL}")
    txt = requests.get(OTHER_URL, timeout=30).text
    df = pd.read_csv(io.StringIO(txt), sep="|")
    items = []
    for _, row in df.iterrows():
        sym = str(row.get("ACT Symbol", "")).strip()
        if not sym or sym.lower().startswith("file"):
            continue
        if str(row.get("Test Issue", "N")).strip().upper() == "Y":
            continue
        exch_code = str(row.get("Exchange", "")).strip().upper()
        items.append({
            "ticker": sym,
            "name": str(row.get("Security Name", "")).strip(),
            "market": "US",
            "exchange": EXCHANGE_MAP.get(exch_code, exch_code or "OTHER"),
            "is_etf": str(row.get("ETF", "")).strip().upper() == "Y",
            "sector": None,
            "industry": None,
            "marketCap": None,
        })
    print(f"  → 其他交易所 {len(items)} 只")
    return items


def enrich_with_yfinance(items: list[dict], limit: int | None = None, sleep_sec: float = 0.15) -> int:
    """
    用 yfinance 补 sector / industry / marketCap。
    慢（每只 ~0.5-1s），可用 --limit 测试。
    返回成功补全的数量。
    """
    try:
        import yfinance as yf
    except ImportError:
        print("  [error] yfinance 未安装，跳过 enrich")
        return 0

    targets = items if limit is None else items[:limit]
    total = len(targets)
    ok = 0
    print(f"  enriching {total} 只...")
    t0 = time.time()
    for i, item in enumerate(targets, 1):
        sym = item["ticker"]
        try:
            info = yf.Ticker(sym).info or {}
            sector = info.get("sector")
            industry = info.get("industry")
            mc = info.get("marketCap")
            if sector or industry or mc:
                item["sector"] = sector
                item["industry"] = industry
                item["marketCap"] = float(mc) if mc else None
                ok += 1
        except Exception:
            pass  # 失败的字段保持 None，下次跑可补
        if i % 100 == 0:
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed > 0 else 0
            eta = (total - i) / rate if rate > 0 else 0
            print(f"    [{i:5d}/{total}] {ok} ok / {i-ok} miss · {rate:.1f}/s · ETA {eta/60:.1f}min")
        time.sleep(sleep_sec)
    print(f"  enrich 完成: {ok}/{total} 成功")
    return ok


def main():
    parser = argparse.ArgumentParser(description="同步美股 universe")
    parser.add_argument("--enrich", action="store_true", help="用 yfinance 补 sector/industry/marketCap（慢）")
    parser.add_argument("--limit", type=int, default=None, help="限制 enrich 标的数（测试用）")
    parser.add_argument("--sleep", type=float, default=0.15, help="enrich 调用间隔秒数")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("US Universe 同步")
    print("=" * 60)

    # ── Step 1: 拉元数据 ─────────────────────────────────
    print("\n[1/2] 拉元数据（NASDAQ Trader SymDir）")
    items = fetch_nasdaq_listed() + fetch_other_listed()

    # 去重（同一只可能在两个文件都出现）
    seen = set()
    unique = []
    for it in items:
        if it["ticker"] in seen:
            continue
        seen.add(it["ticker"])
        unique.append(it)
    print(f"  去重后 {len(unique)} 只")

    # ── Step 2: 可选 enrich ──────────────────────────────
    enriched = False
    if args.enrich:
        print("\n[2/2] yfinance 补 sector/industry/marketCap")
        n_ok = enrich_with_yfinance(unique, limit=args.limit, sleep_sec=args.sleep)
        enriched = n_ok > 0
    else:
        print("\n[2/2] 跳过 enrich（加 --enrich 启用）")

    # ── 保存 ─────────────────────────────────────────────
    payload = {
        "meta": {
            "market": "US",
            "synced_at": datetime.now().isoformat(timespec="seconds"),
            "count": len(unique),
            "source": "nasdaqtrader.com SymDir",
            "enriched": enriched,
        },
        "items": unique,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n写入 {OUTPUT_PATH}")
    print(f"  {len(unique)} 只标的 · enriched={enriched}")
    print("=" * 60)


if __name__ == "__main__":
    main()
