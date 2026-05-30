#!/usr/bin/env python3
"""
四大指数成份股扩充 → tickers_custom.json
==========================================
来源：
  恒生指数 (HK.800000) · 恒生科技 (HK.800700) · 沪深300 (SH.000300)  ← 富途 get_plate_stock
  纳斯达克100  ← 硬编码（富途无对应板块 code；NDX 成份稳定，2025 版）

规则：
  - 去重：已在 config.TICKERS 或 tickers_custom.json 的跳过（港股按 5 位归一比对）
  - 内部 ticker / yf_symbol / market 按现有约定生成
  - sector 标来源指数（方便评分页按来源筛选），description 留空待 enrich
  - 只写元数据，不拉价格（价格由 sync_futu_bulk 富途拉）

用法: python build_index_universe.py   # 写入 tickers_custom.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import config

CUSTOM_PATH = BACKEND / "tickers_custom.json"

# ── NASDAQ-100 成份（2025）──────────────────────────────
NDX100 = [
    "AAPL","ABNB","ADBE","ADI","ADP","ADSK","AEP","AMAT","AMD","AMGN","AMZN","ANSS",
    "APP","ARM","ASML","AVGO","AZN","BIIB","BKNG","BKR","CCEP","CDNS","CDW","CEG",
    "CHTR","CMCSA","COST","CPRT","CRWD","CSCO","CSGP","CSX","CTAS","CTSH","DASH",
    "DDOG","DXCM","EA","EXC","FANG","FAST","FTNT","GEHC","GFS","GILD","GOOG","GOOGL",
    "HON","IDXX","INTC","INTU","ISRG","KDP","KHC","KLAC","LIN","LRCX","LULU","MAR",
    "MCHP","MDLZ","MELI","META","MNST","MRVL","MSFT","MSTR","MU","NFLX","NVDA","NXPI",
    "ODFL","ON","ORLY","PANW","PAYX","PCAR","PDD","PEP","PLTR","PYPL","QCOM","REGN",
    "ROP","ROST","SBUX","SNPS","TEAM","TMUS","TSLA","TTD","TTWO","TXN","VRSK","VRTX",
    "WBD","WDAY","XEL","ZS",
]

# 指数 → (富途板块 code | None, sector 标签, currency)
INDICES = [
    ("HK.800000", "恒生指数", "HKD"),
    ("HK.800700", "恒生科技", "HKD"),
    ("SH.000300", "沪深300", "CNY"),
]


def hk_ticker(code: str) -> tuple[str, str]:
    """HK.00700 → (内部 '00700.HK', yf '0700.HK')"""
    base = code.split(".")[1]
    internal = f"{base.zfill(5)}.HK"
    yf = f"{base.lstrip('0').zfill(4)}.HK"
    return internal, yf


def cn_ticker(code: str) -> tuple[str, str, str]:
    """SH.600519 → (内部 '600519.SS', yf '600519.SS', market 'SH')；SZ → .SZ"""
    mkt_prefix, num = code.split(".")
    if mkt_prefix == "SH":
        return f"{num}.SS", f"{num}.SS", "SH"
    else:  # SZ
        return f"{num}.SZ", f"{num}.SZ", "SZ"


def norm_existing(keys) -> set:
    """归一现有 ticker 集合（港股统一 5 位）用于去重比对。"""
    out = set()
    for k in keys:
        ku = k.upper()
        if ku.endswith(".HK"):
            base = ku.split(".")[0].zfill(5)
            out.add(f"{base}.HK")
        else:
            out.add(ku)
    return out


def main():
    # 现有标的（config + custom）
    custom = json.loads(CUSTOM_PATH.read_text(encoding="utf-8")) if CUSTOM_PATH.exists() else {}
    existing = norm_existing(list(config.TICKERS.keys()) + list(custom.keys()))
    print(f"现有标的: config={len(config.TICKERS)} + custom={len(custom)} = {len(existing)} (去重后)")

    from futu import OpenQuoteContext
    ctx = OpenQuoteContext("127.0.0.1", 11111)

    new_entries: dict[str, dict] = {}
    stats = {}

    try:
        # ── 港股 + A股指数（富途）──
        for code, label, ccy in INDICES:
            ret, data = ctx.get_plate_stock(code)
            if ret != 0:
                print(f"[{label}] 富途失败: {data}")
                continue
            added = 0
            for _, row in data.iterrows():
                fcode = row["code"]          # HK.00700 / SH.600519 / SZ.000001
                name = row.get("stock_name", "")
                mkt_prefix = fcode.split(".")[0]
                if mkt_prefix == "HK":
                    internal, yf = hk_ticker(fcode)
                    market = "HK"
                else:  # SH / SZ
                    internal, yf, market = cn_ticker(fcode)
                norm = internal.upper()
                if norm in existing or norm in new_entries:
                    continue  # 去重（含指数间重叠，如恒生科技⊂恒生指数）
                new_entries[norm] = {
                    "name": name, "yf_symbol": yf, "futu_symbol": fcode,
                    "type": "stock", "market": market,
                    "sector": label, "currency": ccy, "description": "",
                }
                added += 1
            stats[label] = added
            print(f"[{label}] {code}: {len(data)} 成份 → 新增 {added}")

        # ── 纳指100（硬编码）──
        added = 0
        for sym in NDX100:
            norm = sym.upper()
            if norm in existing or norm in new_entries:
                continue
            new_entries[norm] = {
                "name": sym, "yf_symbol": sym,
                "type": "stock", "market": "US",
                "sector": "纳斯达克100", "currency": "USD", "description": "",
            }
            added += 1
        stats["纳斯达克100"] = added
        print(f"[纳斯达克100] {len(NDX100)} 成份 → 新增 {added}")
    finally:
        ctx.close()

    # ── 合并写入 ──
    custom.update(new_entries)
    CUSTOM_PATH.write_text(json.dumps(custom, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(f"新增 {len(new_entries)} 只 → tickers_custom.json 现 {len(custom)} 只")
    print(f"明细: {stats}")


if __name__ == "__main__":
    main()
