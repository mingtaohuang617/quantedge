#!/usr/bin/env python3
"""A股财报日历：给 SH/SZ 补 nextEarnings（预约披露日），写回 data.js
================================================================================
yfinance 对 A股只给「上次」财报日（被 enrich_fundamentals 的未来护栏挡掉），A股的
「下次财报日」正源是交易所预约披露制度。用 akshare stock_report_disclosure 一次拿全
市场预约披露日（沪深京 5000+ 行），按当前报告期取「首次预约/最新变更」日，仅未来才填。

策略：缺才填不覆盖（yfinance/iFinD 已填的不动）；只对 SH/SZ 个股；按需手动跑（季度级）。
报告期随季度推进：Q1 用「一季报」、年中用「半年报」、Q3 用「三季报」、年末用「年报」。

用法：
  python enrich_earnings_cn.py                 # 自动选当前报告期
  python enrich_earnings_cn.py --period 2026半年报 --dry-run
"""
from __future__ import annotations
import argparse
import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from refresh_data_js import parse_data_js, write_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
SCHED_COLS = ["三次变更", "二次变更", "初次变更", "首次预约"]  # 优先级：最新变更 > 首次


def default_period(today: date) -> str:
    """按月份推断「下一份将披露的报告期」。A股披露窗口：
    Q1报 4月底 / 半年报 8月底 / Q3报 10月底 / 年报 次年4月底。"""
    m = today.month
    if m <= 4:
        return f"{today.year}年报" if m < 4 else f"{today.year}一季报"
    if m <= 8:
        return f"{today.year}半年报"
    return f"{today.year}三季报"


def code_from_ticker(ticker: str) -> str | None:
    """data.js ticker(yahoo) → akshare 裸码。688256.SS→688256；300308.SZ→300308。"""
    if ticker.endswith(".SS") or ticker.endswith(".SZ"):
        return ticker[:-3]
    return None


def fetch_disclosure(period: str) -> dict[str, str]:
    """akshare 预约披露表 → {裸码: 'YYYY-MM-DD'}（未实际披露 & 未来的排期日）。"""
    import akshare as ak
    df = ak.stock_report_disclosure(market="沪深京", period=period)
    out: dict[str, str] = {}
    today = date.today().isoformat()
    for _, row in df.iterrows():
        code = str(row.get("股票代码", "")).strip()
        if not code:
            continue
        actual = row.get("实际披露")
        # 已实际披露 → 本期报告已出，"下次"是再下一期（不在本查询），跳过
        if actual is not None and str(actual) not in ("NaT", "nan", "None", ""):
            continue
        sched = None
        for col in SCHED_COLS:  # 取最新的排期（变更优先于首次）
            v = row.get(col)
            vs = str(v)[:10] if v is not None else ""
            if vs and vs not in ("NaT", "nan", "None"):
                sched = vs
                break
        if sched and sched >= today:  # 仅未来
            out[code] = sched
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--period", default=None, help="报告期，如 2026半年报；默认按月份自动选")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    period = args.period or default_period(date.today())

    stocks, alerts = parse_data_js(DATA_JS)
    cn = [s for s in stocks if s.get("market") in ("SH", "SZ") and not s.get("isETF")]
    print(f"读入 {len(stocks)} 标的，其中 A股个股 {len(cn)}；报告期 = {period}")

    sched = fetch_disclosure(period)
    print(f"akshare 预约披露表：{len(sched)} 只有未来排期")

    filled = 0
    for s in cn:
        if s.get("nextEarnings"):  # 缺才填
            continue
        code = code_from_ticker(s["ticker"])
        if code and code in sched:
            s["nextEarnings"] = sched[code]
            filled += 1

    print(f"[统计] 填充 nextEarnings {filled} 处")
    if args.dry_run:
        print("[dry-run] 未写回")
        return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
