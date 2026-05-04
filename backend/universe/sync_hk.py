#!/usr/bin/env python3
"""
sync_hk — 拉港股 universe（元数据 + 市值 + 行业板块）
======================================================
数据源：富途 OpenD（需本地 OpenD 在线 + 港股行情登录）
  - get_stock_basicinfo(Market.HK, STOCK)  全港股元数据
  - get_market_snapshot([codes...])         市值（total_market_val 单位元）
  - get_owner_plate([codes...])             每只票所属板块（INDUSTRY 类）

输出：backend/output/universe_hk.json
  {
    "meta": { "market": "HK", "synced_at": "...", "count": N, "source": "futu", "enriched": bool },
    "items": [ { ticker, name, market(HK), exchange, is_etf=False,
                 sector(板块名), industry, marketCap, listing_date }, ... ]
  }

用法：
  python -m backend.universe.sync_hk             # 元数据 + 市值 + 行业（约 1-2 分钟）
  python -m backend.universe.sync_hk --no-enrich # 仅元数据（秒级）
  python -m backend.universe.sync_hk --no-plate  # 跳过板块查询（仅元数据 + 市值）
  python -m backend.universe.sync_hk --limit 50  # 测试时限量

依赖：futu OpenD 已启动并登录港股行情服务
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

# 让 import 父目录 work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 修复 Windows GBK 终端
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from futu import OpenQuoteContext, RET_OK, Market, SecurityType
except ImportError:
    print("[error] futu 未安装：pip install futu-api")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUTPUT_PATH = OUTPUT_DIR / "universe_hk.json"

FUTU_HOST = "127.0.0.1"
FUTU_PORT = 11111

BATCH_SIZE = 200       # snapshot/owner_plate 单次最大 ~400，保守用 200
SLEEP_SNAPSHOT = 1.0   # snapshot 限频较松
SLEEP_OWNER_PLATE = 3.1  # owner_plate 限频严：30 秒 10 次 → 3s/批 + buffer


def fetch_basic_info(ctx) -> list[dict]:
    """拉港股全部 STOCK 元数据。"""
    print("  get_stock_basicinfo(HK, STOCK)")
    ret, df = ctx.get_stock_basicinfo(Market.HK, SecurityType.STOCK)
    if ret != RET_OK:
        raise RuntimeError(f"get_stock_basicinfo HK 失败: {df}")
    print(f"  → {len(df)} 只")

    items = []
    for _, row in df.iterrows():
        code = str(row.get("code", "")).strip()
        if not code:
            continue
        if bool(row.get("delisting", False)):
            continue
        # code 形如 "HK.00700"，转换成 ticker "00700.HK"（与 config.py 风格对齐）
        base = code.split(".", 1)[1] if "." in code else code
        ticker = f"{base}.HK"
        items.append({
            "ticker": ticker,
            "futu_code": code,
            "name": str(row.get("name", "")).strip(),
            "market": "HK",
            "exchange": str(row.get("exchange_type", "")).strip(),
            "is_etf": False,
            "sector": None,
            "industry": None,
            "marketCap": None,
            "listing_date": str(row.get("listing_date", "") or "").strip() or None,
        })
    return items


def enrich_market_cap(ctx, items: list[dict]) -> int:
    """用 get_market_snapshot 分批补市值。"""
    by_code = {it["futu_code"]: it for it in items}
    codes = list(by_code.keys())
    total = len(codes)
    ok = 0
    print(f"  enrich market_cap: {total} 只 / batch_size={BATCH_SIZE}")
    t0 = time.time()
    for i in range(0, total, BATCH_SIZE):
        chunk = codes[i:i + BATCH_SIZE]
        ret, df = ctx.get_market_snapshot(chunk)
        if ret != RET_OK:
            print(f"    batch {i//BATCH_SIZE+1}: snapshot fail - {df}")
            time.sleep(SLEEP_SNAPSHOT * 2)
            continue
        for _, row in df.iterrows():
            code = str(row.get("code", "")).strip()
            mv = row.get("total_market_val")
            if code in by_code and mv is not None:
                try:
                    by_code[code]["marketCap"] = float(mv)
                    ok += 1
                except Exception:
                    pass
        elapsed = time.time() - t0
        rate = (i + len(chunk)) / elapsed if elapsed > 0 else 0
        print(f"    batch {i//BATCH_SIZE+1}/{(total+BATCH_SIZE-1)//BATCH_SIZE}: {len(chunk)} fetched, ok cumulative {ok} ({rate:.0f}/s)")
        time.sleep(SLEEP_SNAPSHOT)
    return ok


def enrich_industry(ctx, items: list[dict]) -> int:
    """用 get_owner_plate 拿每只票的 INDUSTRY 板块名。"""
    by_code = {it["futu_code"]: it for it in items}
    codes = list(by_code.keys())
    total = len(codes)
    ok = 0
    print(f"  enrich industry (owner_plate): {total} 只 / batch_size={BATCH_SIZE}")
    t0 = time.time()
    for i in range(0, total, BATCH_SIZE):
        chunk = codes[i:i + BATCH_SIZE]
        ret, df = ctx.get_owner_plate(chunk)
        if ret != RET_OK:
            # 限频或临时失败 → 多 sleep 再重试一次
            print(f"    batch {i//BATCH_SIZE+1}: owner_plate fail - {df}")
            print(f"      sleep {SLEEP_OWNER_PLATE * 3:.0f}s then retry once")
            time.sleep(SLEEP_OWNER_PLATE * 3)
            ret, df = ctx.get_owner_plate(chunk)
            if ret != RET_OK:
                print(f"      retry still failed: {df}; skip this batch")
                continue
        # 同一只票多行（每个板块一行），收集 INDUSTRY 类
        ind_map: dict[str, list[str]] = {}
        for _, row in df.iterrows():
            if str(row.get("plate_type", "")).strip().upper() != "INDUSTRY":
                continue
            code = str(row.get("code", "")).strip()
            pname = str(row.get("plate_name", "")).strip()
            if code and pname:
                ind_map.setdefault(code, []).append(pname)
        for code, names in ind_map.items():
            if code in by_code:
                # 多个 industry 用 " / " 拼，第一个作为主 sector（与 universe_us/cn 字段对齐）
                primary = names[0]
                by_code[code]["sector"] = primary
                by_code[code]["industry"] = " / ".join(names) if len(names) > 1 else primary
                ok += 1
        elapsed = time.time() - t0
        print(f"    batch {i//BATCH_SIZE+1}/{(total+BATCH_SIZE-1)//BATCH_SIZE}: ok cumulative {ok} ({elapsed:.0f}s)")
        time.sleep(SLEEP_OWNER_PLATE)
    return ok


def main():
    parser = argparse.ArgumentParser(description="同步港股 universe（富途 OpenD）")
    parser.add_argument("--no-enrich", action="store_true", help="跳过市值 + 板块（仅元数据）")
    parser.add_argument("--no-plate", action="store_true", help="跳过板块查询（仅元数据 + 市值）")
    parser.add_argument("--limit", type=int, default=None, help="限量（测试用）")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("HK Universe 同步 (Futu OpenD)")
    print("=" * 60)

    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        # health check
        ret, data = ctx.get_global_state()
        if ret != RET_OK:
            print(f"[error] OpenD get_global_state 失败: {data}")
            sys.exit(1)
        if not data.get("qot_logined"):
            print("[error] OpenD 未登录行情服务，请在 GUI 登录")
            sys.exit(1)
        print(f"  OpenD ok (server_ver={data.get('server_ver')})")

        print("\n[1/3] 拉元数据")
        items = fetch_basic_info(ctx)
        if args.limit:
            items = items[:args.limit]
            print(f"  --limit 截取至 {len(items)} 只")

        cap_ok = ind_ok = 0
        if not args.no_enrich:
            print("\n[2/3] 市值（snapshot）")
            cap_ok = enrich_market_cap(ctx, items)
            print(f"  → {cap_ok}/{len(items)} 补全市值")

            if not args.no_plate:
                print("\n[3/3] 行业板块（owner_plate）")
                ind_ok = enrich_industry(ctx, items)
                print(f"  → {ind_ok}/{len(items)} 补全行业")
            else:
                print("\n[3/3] 跳过板块（--no-plate）")
        else:
            print("\n[2-3/3] 跳过 enrich（--no-enrich）")

    finally:
        ctx.close()

    payload = {
        "meta": {
            "market": "HK",
            "synced_at": datetime.now().isoformat(timespec="seconds"),
            "count": len(items),
            "source": "futu OpenD: stock_basicinfo + market_snapshot + owner_plate",
            "enriched": (cap_ok > 0) or (ind_ok > 0),
            "enriched_market_cap": cap_ok,
            "enriched_industry": ind_ok,
        },
        "items": items,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n写入 {OUTPUT_PATH}")
    print(f"  {len(items)} 只标的 · 市值 {cap_ok} · 行业 {ind_ok}")
    print("=" * 60)


if __name__ == "__main__":
    main()
