#!/usr/bin/env python3
"""
日常刷新 data.js —— 重算已有标的的动态字段（价格/涨跌/K线/动量/RSI/评分）
========================================================================
读 frontend/src/data.js 现有 STOCKS（含 yf.info 基本面）→ 用本地 db 最新日 K
重算时间序列派生字段 → 写回 data.js。基本面字段（ROE/sector/marketCap/eps…）原样
保留，绝不降级。db 里 bars<20 的标的跳过（保持原值）。

配合 sync_futu_bulk.py（先把最新 K 拉进库）使用，是 data.js 的"日常刷新"入口：
    python sync_futu_bulk.py --days 30
    python refresh_data_js.py

注意：
  - 不刷新 PE（日内漂移小，且避免给本步骤引入富途依赖；评分仍用现有 PE）。
  - 新增标的（db 有、data.js 没有）不在这里补，请用 gen_data_js.py。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except ImportError:
    pass

import db
from factors import (
    calc_rsi, calc_momentum, calc_stock_score, calc_etf_score, parse_aum_to_usd,
)
from gen_data_js import build_ranges

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"


def parse_data_js(path: Path):
    """解析 `export const STOCKS=[...]; export const ALERTS=[...];` → (stocks, alerts)。"""
    txt = path.read_text(encoding="utf-8")
    s_key = txt.index("export const STOCKS")
    s_eq = txt.index("=", s_key) + 1
    a_key = txt.index("export const ALERTS")
    stocks = json.loads(txt[s_eq:a_key].strip().rstrip(";").strip())
    a_eq = txt.index("=", a_key) + 1
    alerts = json.loads(txt[a_eq:].strip().rstrip(";").strip())
    return stocks, alerts


def write_data_js(path: Path, stocks: list, alerts: list):
    with open(path, "w", encoding="utf-8") as f:
        f.write("// 自动生成 - refresh_data_js.py (日常行情刷新，勿手改)\n\n")
        f.write("export const STOCKS = ")
        json.dump(stocks, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        f.write(";\n\nexport const ALERTS = ")
        json.dump(alerts, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        f.write(";\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(DATA_JS),
                    help="读取的 data.js（默认本地工作树；定时任务传 origin/main 导出的临时文件）")
    ap.add_argument("--output", default=None, help="写出的 data.js（默认 = --input）")
    args = ap.parse_args()
    in_path = Path(args.input)
    out_path = Path(args.output) if args.output else in_path

    db.init_db()
    stocks, alerts = parse_data_js(in_path)
    print(f"读入 {in_path.name}: {len(stocks)} 标的, alerts {len(alerts)}")

    refreshed = skipped = 0
    for s in stocks:
        t = s.get("ticker")
        bars = db.get_bars(t) if t else []
        if len(bars) < 20:
            skipped += 1
            continue
        closes = pd.Series([b["close"] for b in bars])
        rsi = calc_rsi(closes)
        mom = calc_momentum(closes)
        if not (math.isfinite(rsi) and math.isfinite(mom)):
            skipped += 1
            continue
        ranges, ph = build_ranges(bars)
        if not ranges:
            skipped += 1
            continue
        latest = round(bars[-1]["close"], 2)
        prev = bars[-2]["close"]
        chg = round((latest - prev) / prev * 100, 2) if prev else 0.0
        # ETF 与个股用各自的评分模型——ETF 没有 PE/ROE/营收，绝不能套个股公式
        # （历史 bug：此处对 ETF 误用 calc_stock_score，把四维分写成个股三维分）
        if s.get("isETF"):
            score, subs = calc_etf_score(
                s.get("expenseRatio"), s.get("premiumDiscount"),
                parse_aum_to_usd(s.get("aum")), mom,
                s.get("concentrationTop3"), s.get("leverage"), detailed=True)
        else:
            score, subs = calc_stock_score(
                s.get("pe"), s.get("roe"), s.get("revenueGrowth"),
                s.get("profitMargin"), mom, rsi, detailed=True)
        s["price"] = latest
        s["change"] = chg
        s["momentum"] = mom
        s["rsi"] = rsi
        s["priceRanges"] = ranges
        s["priceHistory"] = ph
        s["score"] = score
        s["subScores"] = subs
        refreshed += 1

    stocks.sort(key=lambda x: x.get("score", 0) or 0, reverse=True)
    for i, s in enumerate(stocks):
        s["rank"] = i + 1

    write_data_js(out_path, stocks, alerts)
    print(f"[DONE] 刷新 {refreshed}, 跳过(bars<20/无K) {skipped}, "
          f"写出 {len(stocks)} 标的 → {out_path}")


if __name__ == "__main__":
    main()
