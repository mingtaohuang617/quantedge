#!/usr/bin/env python3
"""P1 数据地基：全市场 yf.info 基本面回补 + 为全量个股算 gicsSector，写回 data.js
================================================================================
病根：data.js 里 A股(301)+港股(103) 几乎没有 ROE/利润率/营收增速 → 它们的评分实际只剩
动量。这里用 yfinance .info（与美股同源同口径）回补，并为横截面评分打底——给每个个股
打一个 GICS 11 大类标签 `gicsSector`（同市场×同行业排名分位的分组依据）。

一次 .info 取齐、按市场缺口「缺才填」：
  - A股/港股：ROE/利润率/营收增速 + eps/beta/revenue/ebitda 绝对值（原本全空）
  - 美股：ps/peg/evEbitda 残缺回补（iFinD 对美股 PEG 几乎空）
  - 全市场：targetPrice/analystCount 卖方目标价 + nextEarnings 财报日（仅未来）
策略：
  - 全权益市场（SH/SZ/HK/US/JP/KR）跑 yfinance；「缺才填」绝不覆盖已有值（不降级）
  - 单位对齐 data.js：roe/利润率/营收增速 = 百分比；pe/pb/ps/peg round 2；
    revenue/ebitda = "X.XB" 字符串；eps/beta/targetPrice 裸数；nextEarnings = 日期串
  - 基本面慢变，daily refresh 不动它们；本脚本按需手动跑（季度级）

用法：
  python enrich_fundamentals.py                 # 全量 SH/SZ/HK
  python enrich_fundamentals.py --only HK       # 只港股
  python enrich_fundamentals.py --limit 5 --dry-run   # 试跑不写
"""
from __future__ import annotations

import argparse
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
from sector_gics import classify_gics, OTHER
from data_sources.yfinance_source import fetch_fundamentals_enrich
from refresh_data_js import parse_data_js, write_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
# 全权益市场：A股/港股回补基本面绝对值；美股回补 ps/peg/evEbitda 残缺；全市场补
# 目标价/财报日。yfinance .info 一次取齐，「缺才填」不覆盖已有值，跑全市场是净增量。
FETCH_MARKETS = {"SH", "SZ", "HK", "US", "JP", "KR"}


def yf_symbol_for(ticker: str) -> str:
    """ticker → yfinance 符号。优先 config，缺则按市场后缀推导。
    600519.SH→600519.SS；000333.SZ→000333.SZ；00700.HK→0700.HK；NVDA→NVDA。"""
    cfg = config.TICKERS.get(ticker)
    if cfg and cfg.get("yf_symbol"):
        return cfg["yf_symbol"]
    if ticker.endswith(".SH"):
        return ticker[:-3] + ".SS"
    if ticker.endswith(".SZ"):
        return ticker  # 深市 yahoo 同为 .SZ
    if ticker.endswith(".HK"):
        base = ticker[:-3]
        try:
            return f"{int(base):04d}.HK"  # 港股 yahoo 用 4 位（00700→0700）
        except ValueError:
            return ticker
    return ticker  # 美股等


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="只处理某些市场，逗号分隔，如 HK 或 SH,SZ")
    ap.add_argument("--limit", type=int, default=0, help="最多取数多少只（调试用，0=不限）")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写回")
    args = ap.parse_args()

    fetch_markets = set(args.only.upper().split(",")) if args.only else FETCH_MARKETS

    stocks, alerts = parse_data_js(DATA_JS)
    print(f"读入 {len(stocks)} 标的；将对 {sorted(fetch_markets)} 跑 yfinance 回补")

    FUND_KEYS = [  # (data.js 字段, fetch 返回 key)
        ("pe", "pe"), ("pb", "pb"), ("roe", "roe"),
        ("profitMargin", "profit_margin"), ("revenueGrowth", "revenue_growth"),
        ("marketCap", "market_cap"),
        # 绝对值字段：A股/港股原本全空，详情页「年营收/EBITDA/EPS/Beta」显示 N/A
        ("eps", "eps"), ("beta", "beta"),
        ("revenue", "revenue"), ("ebitda", "ebitda"),
        # 估值比率：美股 ps/peg/evEbitda 残缺（iFinD 对美股 PEG 几乎空），yfinance 兜底
        ("ps", "ps"), ("peg", "peg"), ("evEbitda", "ev_ebitda"),
        # 卖方目标价（美股/港股 yf 覆盖好；A股 yf 无，留 iFinD）+ 财报日历
        ("targetPrice", "target_price"), ("analystCount", "analyst_count"),
        ("nextEarnings", "next_earnings"),
    ]
    fetched = filled = gics_set = gics_other = 0
    fetch_budget = args.limit or 10**9

    for s in stocks:
        if s.get("isETF"):
            continue  # ETF 走 4 类专属评分，无个股基本面
        mkt = s.get("market")

        # 取数触发（增量幂等）：
        #   ① A/港(默认市场)还缺基本面字段 → 补
        #   ② 现有信息（持久化的 yfSector / 现有 sector）都无法归类 → 补（捞回指数标签美股）
        # gicsSector 用持久化的 yfSector 重算，所以已取过数的标的再跑会跳过、且分类稳定不被破坏。
        missing_fund = any(s.get(jk) is None for jk, _ in FUND_KEYS)
        unclassified = classify_gics(s.get("yfSector"), s.get("sector")) == OTHER
        if ((mkt in fetch_markets and missing_fund) or unclassified) and fetched < fetch_budget:
            f = fetch_fundamentals_enrich(yf_symbol_for(s["ticker"]))
            fetched += 1
            if f.get("sector"):
                s["yfSector"] = f["sector"]  # 持久化 yfinance 行业 → 后续无取数也能稳定归类
            for js_key, f_key in FUND_KEYS:
                if s.get(js_key) is None and f.get(f_key) is not None:
                    s[js_key] = f[f_key]
                    filled += 1
            if fetched % 25 == 0:
                print(f"  ...已取数 {fetched}（填充字段 {filled}）", flush=True)
            time.sleep(0.15)  # 轻微限速，避免 yahoo 限频

        # gicsSector：持久化 yfSector 优先，落空退现有 sector —— 始终可重算、不破坏
        gics = classify_gics(s.get("yfSector"), s.get("sector"))
        s["gicsSector"] = gics
        gics_set += 1
        if gics == OTHER:
            gics_other += 1

    print(f"[统计] 取数 {fetched} 只；填充字段 {filled} 处；"
          f"gicsSector 覆盖 {gics_set}，其中无法归类(其他) {gics_other}")

    if args.dry_run:
        print("[dry-run] 未写回")
        return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
