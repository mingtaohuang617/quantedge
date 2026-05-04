#!/usr/bin/env python3
"""
sync_us — 拉全 NASDAQ + NYSE/AMEX 上市股票元数据
=================================================
数据源：
  - 元数据：NASDAQ Trader Symbol Directory（公开 FTP，秒级，~12000+ 标的）
  - enrich (优先)：富途 OpenD（需美股 LV1+ 行情 + OpenD 在线，~10 分钟）
  - enrich (fallback)：yfinance（~1 小时，没 OpenD 时可用）

输出：backend/output/universe_us.json

用法：
  python -m backend.universe.sync_us                          # 仅元数据（秒级）
  python -m backend.universe.sync_us --enrich                 # 默认富途，OpenD 不可用时降级 yfinance
  python -m backend.universe.sync_us --enrich --source futu   # 强制富途
  python -m backend.universe.sync_us --enrich --source yfinance  # 强制 yfinance
  python -m backend.universe.sync_us --enrich --limit 100     # 测试时限量

注意：
  - 不要混进 builtin TICKERS（那是已 tracking 池）
  - 失败的标的字段保持 None，下次跑可以增量补
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


def _ticker_to_futu_code(ticker: str) -> str:
    """美股 ticker → 富途 code。AAPL → US.AAPL；BRK.B → US.BRK.B（富途接受）。"""
    return f"US.{ticker}"


# Security Name 中含这些子串的多为衍生品/优先股/Note，富途 owner_plate 不支持
_DERIVATIVE_KEYWORDS = (
    " warrant", "warrants",
    " unit", " units",
    " right", " rights",
    "preferred",
    "depositary",
    " note", " notes",
    "subordinated",
    "convertible",
)


def _is_derivative(name: str) -> bool:
    s = (name or "").lower()
    return any(kw in s for kw in _DERIVATIVE_KEYWORDS)


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
        name = str(row.get("Security Name", "")).strip()
        items.append({
            "ticker": sym,
            "futu_code": _ticker_to_futu_code(sym),
            "name": name,
            "market": "US",
            "exchange": "NASDAQ",
            "is_etf": str(row.get("ETF", "")).strip().upper() == "Y",
            "is_derivative": _is_derivative(name),
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
        name = str(row.get("Security Name", "")).strip()
        items.append({
            "ticker": sym,
            "futu_code": _ticker_to_futu_code(sym),
            "name": name,
            "market": "US",
            "exchange": EXCHANGE_MAP.get(exch_code, exch_code or "OTHER"),
            "is_etf": str(row.get("ETF", "")).strip().upper() == "Y",
            "is_derivative": _is_derivative(name),
            "sector": None,
            "industry": None,
            "marketCap": None,
        })
    print(f"  → 其他交易所 {len(items)} 只")
    return items


def enrich_with_futu(
    items: list[dict],
    limit: int | None = None,
    do_industry: bool = True,
    checkpoint_fn=None,
) -> tuple[int, int]:
    """
    用富途 OpenD 补市值 + 行业。返回 (n_market_cap_ok, n_industry_ok)。
    owner_plate 不支持 ETF / 衍生品，会自动跳过。
    checkpoint_fn 在 enrich_industry 进度中定期被调用（用于增量保存到磁盘）。
    """
    from . import _futu

    targets = items if limit is None else items[:limit]
    try:
        ctx = _futu.open_futu_ctx()
    except RuntimeError as e:
        print(f"  [error] OpenD 不可用: {e}")
        return 0, 0

    try:
        cap_ok = _futu.enrich_market_cap(ctx, targets)
        # 市值跑完先做一次 checkpoint
        if checkpoint_fn:
            try:
                checkpoint_fn()
                print("  [checkpoint] 市值阶段已保存")
            except Exception as e:
                print(f"  [checkpoint] 市值保存失败: {e}")

        ind_ok = 0
        if do_industry:
            stock_only = [
                it for it in targets
                if not it.get("is_etf") and not it.get("is_derivative")
            ]
            n_skipped = len(targets) - len(stock_only)
            print(f"  industry pass: 排除 {n_skipped} 只 ETF/衍生品，剩 {len(stock_only)} 只普通股")
            try:
                ind_ok = _futu.enrich_industry(ctx, stock_only, checkpoint_fn=checkpoint_fn)
            except OSError as e:
                print(f"  [warn] enrich_industry 因 OS 网络栈中断: {e}")
                print("  已 checkpoint 的进度被保留")
        return cap_ok, ind_ok
    finally:
        try:
            ctx.close()
        except Exception:
            pass


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
    parser.add_argument("--enrich", action="store_true", help="补 sector/industry/marketCap")
    parser.add_argument(
        "--source", choices=["auto", "futu", "yfinance"], default="auto",
        help="enrich 数据源：auto=优先 futu 失败回落 yfinance；futu 推荐（10 分钟）；yfinance 慢（1 小时）",
    )
    parser.add_argument("--no-industry", action="store_true", help="仅补市值，跳过行业（节省时间）")
    parser.add_argument("--limit", type=int, default=None, help="限制 enrich 标的数（测试用）")
    parser.add_argument("--sleep", type=float, default=0.15, help="yfinance 调用间隔秒数（仅 yfinance 用）")
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

    # ── Step 2: enrich ────────────────────────────────────
    enriched = False
    enrich_source = "none"
    cap_ok = ind_ok = 0

    # 抽出保存函数，enrich 过程中可作 checkpoint 调用
    def save_payload():
        # 重新统计当前 items 中已 enriched 的实际数（容忍 mid-flight 计数偏差）
        n_mc = sum(1 for it in unique if it.get("marketCap"))
        n_sec = sum(1 for it in unique if it.get("sector"))
        payload = {
            "meta": {
                "market": "US",
                "synced_at": datetime.now().isoformat(timespec="seconds"),
                "count": len(unique),
                "source": "nasdaqtrader.com SymDir",
                "enriched": (n_mc > 0 or n_sec > 0),
                "enrich_source": enrich_source,
                "enriched_market_cap": n_mc,
                "enriched_industry": n_sec,
            },
            "items": unique,
        }
        tmp = OUTPUT_PATH.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp.replace(OUTPUT_PATH)

    if args.enrich:
        print(f"\n[2/2] enrich (--source={args.source})")
        # futu 优先
        if args.source in ("auto", "futu"):
            try:
                enrich_source = "futu"
                cap_ok, ind_ok = enrich_with_futu(
                    unique, limit=args.limit, do_industry=not args.no_industry,
                    checkpoint_fn=save_payload,
                )
                if cap_ok > 0:
                    enriched = True
                    print(f"  futu 补全：市值 {cap_ok} / 行业 {ind_ok}")
            except Exception as e:
                print(f"  futu 失败: {e}")
        # yfinance fallback
        if (args.source == "yfinance") or (args.source == "auto" and cap_ok == 0):
            print("  → 尝试 yfinance")
            n_ok = enrich_with_yfinance(unique, limit=args.limit, sleep_sec=args.sleep)
            if n_ok > 0:
                enrich_source = "yfinance"
                enriched = True
                cap_ok = n_ok
        if not enriched:
            print("  两个源都未补到数据")
    else:
        print("\n[2/2] 跳过 enrich（加 --enrich 启用）")

    # ── 最终保存 ────────────────────────────────────────
    save_payload()

    # 重新统计实际状态（覆盖 mid-flight crash 时的计数偏差）
    n_mc = sum(1 for it in unique if it.get("marketCap"))
    n_sec = sum(1 for it in unique if it.get("sector"))
    print(f"\n写入 {OUTPUT_PATH}")
    print(f"  {len(unique)} 只标的 · 市值 {n_mc} · 行业 {n_sec} · source={enrich_source}")
    print("=" * 60)


if __name__ == "__main__":
    main()
