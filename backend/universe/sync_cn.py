#!/usr/bin/env python3
"""
sync_cn — 拉全 A 股（SH/SZ/BJ）元数据
======================================
数据源：tushare pro_api
  - pro.stock_basic — 全部上市股票（含 ts_code/name/industry/market/list_date）
  - pro.daily_basic — 最近交易日的市值 / PE / PB

输出：backend/output/universe_cn.json
  {
    "meta": { "market": "CN", "synced_at": "...", "count": N, "source": "tushare", "enriched": bool },
    "items": [ { ticker(ts_code), name, market(CN), exchange(SH|SZ|BJ), is_etf=False, sector, industry, marketCap }, ... ]
  }

用法：
  python -m backend.universe.sync_cn                  # 元数据 + marketCap（一次 daily_basic 就够）
  python -m backend.universe.sync_cn --no-enrich      # 仅元数据，跳过市值

依赖：环境变量 TUSHARE_TOKEN（在 backend/.env）
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

# 让 import 父目录的 data_sources 包能 work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 修复 Windows GBK 终端 Unicode 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from data_sources.tushare_source import _get_pro, TushareError  # noqa: E402

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUTPUT_PATH = OUTPUT_DIR / "universe_cn.json"


def fetch_stock_basic() -> list[dict]:
    """拉全部上市 A 股元数据。"""
    pro = _get_pro()
    print("  pro.stock_basic(exchange='', list_status='L')")
    df = pro.stock_basic(
        exchange="",
        list_status="L",
        fields="ts_code,symbol,name,area,industry,market,list_date",
    )
    if df is None or df.empty:
        raise TushareError("stock_basic 返回空")
    print(f"  → 上市 A 股 {len(df)} 只")

    items = []
    for _, row in df.iterrows():
        ts_code = str(row.get("ts_code", "")).strip()
        if not ts_code:
            continue
        # ts_code 格式：600519.SH / 000001.SZ / 830839.BJ
        exch = ts_code.split(".")[-1] if "." in ts_code else ""
        items.append({
            "ticker": ts_code,
            "name": str(row.get("name", "")).strip(),
            "market": "CN",
            "exchange": exch,
            "is_etf": False,
            "sector": str(row.get("industry", "") or "").strip() or None,
            "industry": str(row.get("industry", "") or "").strip() or None,
            "marketCap": None,
            "list_date": str(row.get("list_date", "") or "").strip() or None,
        })
    return items


def enrich_market_cap(items: list[dict], retries: int = 5) -> int:
    """
    用一次 pro.daily_basic 拉最近交易日的全市场市值，按 ts_code 回填。
    daily_basic 的 total_mv 单位是"万元"，转换成元再返回（与 yfinance marketCap 保持同单位级别）。
    若指定日期未开盘，回滚最多 retries 天。
    """
    pro = _get_pro()
    by_ts = {it["ticker"]: it for it in items}
    today = datetime.now()
    for offset in range(retries):
        d = today - timedelta(days=offset)
        ds = d.strftime("%Y%m%d")
        try:
            df = pro.daily_basic(trade_date=ds, fields="ts_code,total_mv,pe,pb")
        except Exception as e:
            print(f"    daily_basic({ds}) 失败: {e}")
            continue
        if df is None or df.empty:
            print(f"    daily_basic({ds}) 空（非交易日？）")
            continue
        print(f"  daily_basic 命中交易日 {ds}, {len(df)} 行")
        ok = 0
        for _, row in df.iterrows():
            ts_code = str(row.get("ts_code", "")).strip()
            mv_w = row.get("total_mv")  # 万元
            if not ts_code or mv_w is None:
                continue
            it = by_ts.get(ts_code)
            if not it:
                continue
            try:
                it["marketCap"] = float(mv_w) * 1e4  # → 元
                ok += 1
            except Exception:
                pass
        return ok
    print("  enrich_market_cap: 5 天内都没找到交易日，跳过")
    return 0


def main():
    parser = argparse.ArgumentParser(description="同步 A 股 universe")
    parser.add_argument("--no-enrich", action="store_true", help="跳过 marketCap 补全")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("CN Universe 同步 (Tushare)")
    print("=" * 60)

    print("\n[1/2] 拉元数据")
    try:
        items = fetch_stock_basic()
    except TushareError as e:
        print(f"\n[error] {e}")
        print("请确认 backend/.env 里设置了 TUSHARE_TOKEN")
        sys.exit(1)

    enriched = False
    if not args.no_enrich:
        print("\n[2/2] 用 daily_basic 补 marketCap")
        try:
            n_ok = enrich_market_cap(items)
            enriched = n_ok > 0
            print(f"  补全 {n_ok}/{len(items)} 只市值")
        except Exception as e:
            print(f"  enrich 失败: {e}（继续保存元数据）")
    else:
        print("\n[2/2] 跳过 enrich（--no-enrich）")

    payload = {
        "meta": {
            "market": "CN",
            "synced_at": datetime.now().isoformat(timespec="seconds"),
            "count": len(items),
            "source": "tushare pro.stock_basic + daily_basic",
            "enriched": enriched,
        },
        "items": items,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n写入 {OUTPUT_PATH}")
    print(f"  {len(items)} 只标的 · enriched={enriched}")
    print("=" * 60)


if __name__ == "__main__":
    main()
