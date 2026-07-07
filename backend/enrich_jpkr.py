#!/usr/bin/env python3
"""JP/KR 小尾巴：给日股/韩股(iFinD 港美股不覆盖、FMP 免费档付费墙)补估值，写回 data.js
================================================================================
用 yfinance 兜底填 pe/pb/ps/peg/evEbitda/roe/dividend_yield（缺才填）。
坑：venv 在中文路径下时 curl_cffi 打不开 CA 文件 → 把 certifi 复制到 ASCII 路径并
设 CURL_CA_BUNDLE（必须在 import yfinance 前）。单位：roe×100、股息率÷100(yf 返回%)。
用法：python enrich_jpkr.py [--dry-run]
"""
from __future__ import annotations
import argparse, os, shutil, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# ── CA 修复：中文路径 → ASCII 副本（必须在 import yfinance 之前）──
import certifi
_ascii_ca = Path(os.environ.get("TEMP", "/tmp")) / "cacert_ascii.pem"
try:
    shutil.copyfile(certifi.where(), _ascii_ca)
    os.environ["CURL_CA_BUNDLE"] = str(_ascii_ca)
    os.environ["SSL_CERT_FILE"] = str(_ascii_ca)
except Exception as e:
    print(f"[warn] CA 复制失败: {e}")

import yfinance as yf
from refresh_data_js import parse_data_js, write_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
MARKETS = {"JP", "KR"}


def yf_valuation(sym: str) -> dict:
    try:
        i = yf.Ticker(sym).info
    except Exception as e:
        print(f"  [{sym}] {e}", flush=True); return {}
    def num(k):
        v = i.get(k)
        return v if isinstance(v, (int, float)) else None
    r = {}
    if num("trailingPE") is not None: r["pe"] = round(num("trailingPE"), 2)
    if num("priceToBook") is not None: r["pb"] = round(num("priceToBook"), 2)
    if num("priceToSalesTrailing12Months") is not None: r["ps"] = round(num("priceToSalesTrailing12Months"), 2)
    if num("trailingPegRatio") is not None: r["peg"] = round(num("trailingPegRatio"), 2)
    if num("enterpriseToEbitda") is not None: r["evEbitda"] = round(num("enterpriseToEbitda"), 2)
    if num("returnOnEquity") is not None: r["roe"] = round(num("returnOnEquity") * 100, 2)
    if num("dividendYield") is not None: r["dividend_yield"] = round(num("dividendYield") / 100.0, 4)  # yf 返回%
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    stocks, alerts = parse_data_js(DATA_JS)
    targets = [s for s in stocks if s.get("market") in MARKETS and not s.get("isETF")]
    print(f"JP/KR: yfinance 取数 {len(targets)} 只")
    FILL = ["pe", "pb", "roe", "ps", "peg", "evEbitda", "dividend_yield"]
    filled = {k: 0 for k in FILL}
    for s in targets:
        rec = yf_valuation(s["ticker"])
        for k in FILL:
            if s.get(k) is None and rec.get(k) is not None:
                s[k] = rec[k]; filled[k] += 1
        print(f"  {s['ticker']} {s.get('name')}: {rec}", flush=True)
    print("[填充] " + " ".join(f"{k}:{v}" for k, v in filled.items()))
    if args.dry_run:
        print("[dry-run] 未写回"); return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
