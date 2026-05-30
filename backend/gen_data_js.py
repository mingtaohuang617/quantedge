#!/usr/bin/env python3
"""
富途快速生成 data.js（为新增成份股补评分，合并现有完整数据）
==============================================================
生产 vercel 只读 frontend/src/data.js（git-tracked），所以让评分页显示 544 标的
只需重新生成 data.js。本脚本：
  - 保留 stocks_data.json 已有标的的完整数据（含 yf.info 的 ROE/sector 等，不降级）
  - 为缺失标的：db 富途价格算 momentum/RSI/priceRanges + 富途 snapshot 拿 PE → calc_stock_score
  - 合并 → 排序 → 写 stocks_data.json + data.js

不调 yf.info（避免 A股超时），~分钟级完成。A股评分 = 真实 PE + 技术面（ROE/margin 缺则默认）。
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime as dt, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

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
from factors import calc_rsi, calc_momentum, calc_stock_score

OUTPUT = BACKEND / "output"
DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
CUSTOM = BACKEND / "tickers_custom.json"


def build_ranges(bars: list[dict]):
    """bars: [{trade_date, close}] 升序 → (priceRanges, price_history)"""
    if len(bars) < 2:
        return {}, []
    end = dt.strptime(bars[-1]["trade_date"], "%Y-%m-%d")

    def sample(sub, fmt, mx=40):
        if len(sub) < 2:
            return []
        idxs = np.linspace(0, len(sub) - 1, min(mx, len(sub)), dtype=int)
        out = []
        for i in idxs:
            v = sub[int(i)]["close"]
            if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) or v <= 0:
                continue
            d = dt.strptime(sub[int(i)]["trade_date"], "%Y-%m-%d")
            out.append({"m": d.strftime(fmt), "p": round(v, 2)})
        return out

    def days(n):
        cut = end - timedelta(days=n)
        return [b for b in bars if dt.strptime(b["trade_date"], "%Y-%m-%d") >= cut]

    ranges = {
        "1M": sample(days(31), "%m/%d"),
        "6M": sample(days(183), "%m/%d"),
        "YTD": sample([b for b in bars if b["trade_date"] >= f"{end.year}-01-01"], "%m/%d"),
        "1Y": sample(days(365), "%m/%d"),
        "5Y": sample(days(1825), "%Y/%m"),   # db 富途仅 2 年，给 2 年
        "ALL": sample(bars, "%Y/%m"),
    }
    ph = sample(days(365), "%b %d", mx=12)
    return ranges, ph


def futu_code(ticker: str, cfg: dict) -> str | None:
    if cfg.get("futu_symbol"):
        return cfg["futu_symbol"]
    m = (cfg.get("market") or "US").upper()
    t = ticker
    if m == "HK":
        return f"HK.{t.split('.')[0].zfill(5)}"
    if m == "SH":
        return f"SH.{t.split('.')[0]}"
    if m == "SZ":
        return f"SZ.{t.split('.')[0]}"
    if m == "US":
        return f"US.{t.replace('-', '.')}"
    return None


def futu_snapshot(futu_codes: list[str]) -> dict:
    """批量富途 snapshot → {futu_code: {pe, name}}。单批 ≤200。"""
    from futu import OpenQuoteContext, RET_OK
    out = {}
    if not futu_codes:
        return out
    ctx = OpenQuoteContext("127.0.0.1", 11111)
    try:
        for i in range(0, len(futu_codes), 200):
            chunk = futu_codes[i:i + 200]
            ret, dfm = ctx.get_market_snapshot(chunk)
            if ret != RET_OK:
                continue
            for _, r in dfm.iterrows():
                c = str(r.get("code", ""))
                pe = r.get("pe_ratio")
                out[c] = {
                    "pe": float(pe) if pe is not None and pe > 0 else None,
                    "name": r.get("stock_name") or r.get("name"),
                }
    finally:
        ctx.close()
    return out


def main():
    db.init_db()
    existing = {}
    sd = OUTPUT / "stocks_data.json"
    if sd.exists():
        for s in json.loads(sd.read_text(encoding="utf-8")):
            existing[s["ticker"]] = s
    print(f"现有 {len(existing)} 只完整数据（保留不降级）")

    cfgs = dict(config.TICKERS)
    if CUSTOM.exists():
        cfgs.update(json.loads(CUSTOM.read_text(encoding="utf-8")))
    missing = {t: c for t, c in cfgs.items() if t not in existing}
    print(f"标的清单 {len(cfgs)}, 缺 {len(missing)} 只待生成")

    # 富途批量基本面
    code_map = {}
    for t, c in missing.items():
        fc = futu_code(t, c)
        if fc:
            code_map[fc] = t
    snap = futu_snapshot(list(code_map.keys()))
    print(f"富途 snapshot 拿到 {len(snap)} 只基本面")

    new, fail = [], 0
    for t, c in missing.items():
        bars = db.get_bars(t)
        if len(bars) < 20:
            fail += 1
            continue
        closes = pd.Series([b["close"] for b in bars])
        rsi = calc_rsi(closes)
        mom = calc_momentum(closes)
        ranges, ph = build_ranges(bars)
        sn = snap.get(futu_code(t, c) or "", {})
        pe = sn.get("pe")
        score, subs = calc_stock_score(pe, None, None, None, mom, rsi, detailed=True)
        latest = round(bars[-1]["close"], 2)
        prev = bars[-2]["close"]
        chg = round((latest - prev) / prev * 100, 2) if prev else 0
        new.append({
            "ticker": t, "name": c.get("name") or sn.get("name") or t,
            "market": c.get("market", "US"), "sector": c.get("sector", "未知"),
            "currency": c.get("currency", "USD"), "price": latest, "change": chg,
            "score": score, "subScores": subs, "isETF": False,
            "pe": round(pe, 2) if pe else None, "roe": None,
            "momentum": mom, "rsi": rsi,
            "revenueGrowth": None, "profitMargin": None, "ebitda": None,
            "marketCap": None, "revenue": None, "eps": None, "beta": None,
            "week52High": None, "week52Low": None, "avgVolume": None,
            "nextEarnings": None,
            "priceHistory": ph, "priceRanges": ranges,
            "description": c.get("description", ""),
        })
    print(f"生成 {len(new)} 只新标的, 跳过(数据<20) {fail}")

    allstocks = list(existing.values()) + new
    allstocks.sort(key=lambda x: x.get("score", 0) or 0, reverse=True)
    for i, s in enumerate(allstocks):
        s["rank"] = i + 1

    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / "stocks_data.json").write_text(
        json.dumps(allstocks, ensure_ascii=False, indent=2), encoding="utf-8")
    alerts = []
    aj = OUTPUT / "alerts.json"
    if aj.exists():
        alerts = json.loads(aj.read_text(encoding="utf-8"))
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write("// 自动生成 - gen_data_js.py (富途快速生成 + 指数成份扩充)\n")
        f.write(f"// 生成时间: {dt.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        # 紧凑序列化（生成文件，无需缩进）— 543 标的含 priceRanges，indent 会让体积翻倍
        f.write("export const STOCKS = ")
        json.dump(allstocks, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        f.write(";\n\nexport const ALERTS = ")
        json.dump(alerts, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        f.write(";\n")
    print(f"[DONE] data.js 写出 {len(allstocks)} 只标的")


if __name__ == "__main__":
    main()
