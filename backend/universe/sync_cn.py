#!/usr/bin/env python3
"""
sync_cn — 拉全 A 股（SH/SZ/BJ）元数据
======================================
数据源：
  - 元数据 + 行业字段：tushare pro.stock_basic
  - 市值（优先）：tushare pro.daily_basic（需 2000+ 积分）
  - 市值（fallback）：富途 OpenD get_market_snapshot（仅 SH/SZ；需 OpenD 在线 + A 股行情登录）

输出：backend/output/universe_cn.json
  {
    "meta": { "market": "CN", "synced_at": "...", "count": N, "source": "...", "enriched": bool, "mc_source": "tushare" | "futu" | "none" },
    "items": [ { ticker(ts_code), name, market(CN), exchange(SH|SZ|BJ), is_etf=False, sector, industry, marketCap }, ... ]
  }

用法：
  python -m backend.universe.sync_cn                  # 自动尝试 tushare → futu fallback
  python -m backend.universe.sync_cn --no-enrich      # 仅元数据，跳过市值
  python -m backend.universe.sync_cn --mc-source futu # 强制只用 futu 补市值

依赖：环境变量 TUSHARE_TOKEN（在 backend/.env）；可选 OpenD 在线
"""
from __future__ import annotations

import argparse
import json
import sys
import time
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


def enrich_market_cap_tushare(items: list[dict], retries: int = 5) -> int:
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
    print("  enrich_market_cap_tushare: 5 天内都没找到交易日，跳过")
    return 0


def _tscode_to_futu(ts_code: str) -> str | None:
    """600519.SH → SH.600519；000001.SZ → SZ.000001；BJ 不支持。"""
    if "." not in ts_code:
        return None
    base, exch = ts_code.split(".", 1)
    exch = exch.upper()
    if exch not in ("SH", "SZ"):
        return None
    return f"{exch}.{base}"


def enrich_market_cap_futu(items: list[dict]) -> int:
    """用富途 OpenD get_market_snapshot 分批拉市值（仅 SH/SZ；BJ 跳过）。"""
    try:
        from futu import OpenQuoteContext, RET_OK
    except ImportError:
        print("  [warn] futu-api 未安装，跳过 OpenD fallback")
        return 0

    BATCH_SIZE = 200
    SLEEP = 1.0

    # 建立 ts_code ↔ futu_code 映射
    by_futu: dict[str, dict] = {}
    for it in items:
        fc = _tscode_to_futu(it["ticker"])
        if fc:
            by_futu[fc] = it
    codes = list(by_futu.keys())
    if not codes:
        print("  没有可映射到 futu 的 SH/SZ 标的")
        return 0

    print(f"  futu enrich: {len(codes)} 只 SH/SZ / batch_size={BATCH_SIZE}")

    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    ok = 0
    try:
        ret, gs = ctx.get_global_state()
        if ret != RET_OK:
            print(f"  [warn] OpenD 不可达: {gs}")
            return 0
        if not gs.get("qot_logined"):
            print("  [warn] OpenD 未登录行情服务，跳过")
            return 0

        t0 = time.time()
        for i in range(0, len(codes), BATCH_SIZE):
            chunk = codes[i:i + BATCH_SIZE]
            ret, df = ctx.get_market_snapshot(chunk)
            if ret != RET_OK:
                print(f"    batch {i//BATCH_SIZE+1}: snapshot fail - {df}")
                time.sleep(SLEEP * 2)
                continue
            for _, row in df.iterrows():
                code = str(row.get("code", "")).strip()
                mv = row.get("total_market_val")
                if code in by_futu and mv is not None:
                    try:
                        by_futu[code]["marketCap"] = float(mv)
                        ok += 1
                    except Exception:
                        pass
            elapsed = time.time() - t0
            print(f"    batch {i//BATCH_SIZE+1}/{(len(codes)+BATCH_SIZE-1)//BATCH_SIZE}: ok cumulative {ok} ({elapsed:.0f}s)")
            time.sleep(SLEEP)
    finally:
        ctx.close()
    return ok


def main():
    parser = argparse.ArgumentParser(description="同步 A 股 universe")
    parser.add_argument("--no-enrich", action="store_true", help="跳过 marketCap 补全")
    parser.add_argument(
        "--mc-source", choices=["auto", "tushare", "futu"], default="auto",
        help="市值来源（auto = 先 tushare 再 futu fallback）",
    )
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("CN Universe 同步 (Tushare + Futu fallback)")
    print("=" * 60)

    print("\n[1/2] 拉元数据 (tushare)")
    try:
        items = fetch_stock_basic()
    except TushareError as e:
        print(f"\n[error] {e}")
        print("请确认 backend/.env 里设置了 TUSHARE_TOKEN")
        sys.exit(1)

    n_ok = 0
    mc_source = "none"
    if not args.no_enrich:
        print("\n[2/2] 补 marketCap")
        # tushare 优先
        if args.mc_source in ("auto", "tushare"):
            try:
                print("  → 尝试 tushare daily_basic")
                n_ok = enrich_market_cap_tushare(items)
                if n_ok > 0:
                    mc_source = "tushare"
                    print(f"  tushare 补全 {n_ok}/{len(items)}")
            except Exception as e:
                print(f"  tushare 失败: {e}")
        # futu fallback（auto 模式 tushare 失败时；显式 futu 模式直接用）
        if (args.mc_source == "futu") or (args.mc_source == "auto" and n_ok == 0):
            print("  → 尝试 futu OpenD")
            try:
                n_ok = enrich_market_cap_futu(items)
                if n_ok > 0:
                    mc_source = "futu"
                    print(f"  futu 补全 {n_ok}/{len(items)}")
            except Exception as e:
                print(f"  futu 失败: {e}")
        if n_ok == 0:
            print("  两个数据源都未补到市值")
    else:
        print("\n[2/2] 跳过 enrich（--no-enrich）")

    payload = {
        "meta": {
            "market": "CN",
            "synced_at": datetime.now().isoformat(timespec="seconds"),
            "count": len(items),
            "source": "tushare pro.stock_basic",
            "enriched": n_ok > 0,
            "mc_source": mc_source,
            "mc_filled": n_ok,
        },
        "items": items,
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n写入 {OUTPUT_PATH}")
    print(f"  {len(items)} 只标的 · 市值 {n_ok}/{len(items)} (source={mc_source})")
    print("=" * 60)


if __name__ == "__main__":
    main()
