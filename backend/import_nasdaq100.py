#!/usr/bin/env python3
"""
一次性脚本：导入纳斯达克 100 成分股到 tickers_custom.json。
跳过 config.py 和 tickers_custom.json 中已存在的标的。
"""
import json
import sys
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

import yfinance as yf
import requests

# ── 路径 ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
CUSTOM_PATH = BASE_DIR / "tickers_custom.json"

from config import TICKERS as BUILTIN

# ── 加载已有 custom tickers ──────────────────────────────
if CUSTOM_PATH.exists():
    with open(CUSTOM_PATH, "r", encoding="utf-8") as f:
        custom = json.load(f)
else:
    custom = {}

existing_keys = set(BUILTIN.keys()) | set(custom.keys())
print(f"已有标的: {len(existing_keys)} 个 (内置 {len(BUILTIN)} + 自定义 {len(custom)})")

# ── 获取纳斯达克 100 成分股 ──────────────────────────────
print("\n拉取纳斯达克 100 成分股列表...")

# 方法: 用 yfinance 的 ^NDX 成分股
try:
    ndx = yf.Ticker("^NDX")
    # yfinance 没有直接的 constituents 属性，用 Wikipedia 备选
    raise AttributeError("try wikipedia")
except Exception:
    pass

# 方法: 从 Wikipedia 拉取（最可靠）
import pandas as pd
try:
    tables = pd.read_html("https://en.wikipedia.org/wiki/Nasdaq-100", match="Ticker")
    df = tables[0]
    # 列名可能是 "Ticker" 或 "Symbol"
    ticker_col = [c for c in df.columns if "ticker" in c.lower() or "symbol" in c.lower()][0]
    company_col = [c for c in df.columns if "company" in c.lower() or "name" in c.lower()][0]
    sector_col = [c for c in df.columns if "sector" in c.lower() or "industry" in c.lower() or "gics" in c.lower()]
    sector_col = sector_col[0] if sector_col else None

    nasdaq100 = []
    for _, row in df.iterrows():
        ticker = str(row[ticker_col]).strip()
        name = str(row[company_col]).strip()
        sector = str(row[sector_col]).strip() if sector_col else ""
        nasdaq100.append({"ticker": ticker, "name": name, "sector": sector})

    print(f"Wikipedia 获取到 {len(nasdaq100)} 个纳斯达克 100 成分股")
except Exception as e:
    print(f"Wikipedia 拉取失败: {e}")
    print("使用内置列表作为 fallback...")
    # Fallback: 2026年4月 纳斯达克100 主要成分（不完整但覆盖大头）
    nasdaq100 = [
        {"ticker": t, "name": "", "sector": ""} for t in [
            "AAPL", "MSFT", "AMZN", "NVDA", "META", "GOOGL", "GOOG", "AVGO",
            "TSLA", "COST", "NFLX", "TMUS", "ADBE", "AMD", "PEP", "LIN",
            "CSCO", "TXN", "ISRG", "INTU", "QCOM", "AMGN", "BKNG", "AMAT",
            "HON", "CMCSA", "VRTX", "PANW", "ADP", "GILD", "SBUX", "ADI",
            "MU", "LRCX", "MELI", "REGN", "INTC", "KLAC", "MDLZ", "PYPL",
            "SNPS", "CDNS", "CRWD", "CTAS", "MAR", "MRVL", "CEG", "CSX",
            "ORLY", "ABNB", "WDAY", "MNST", "FTNT", "ADSK", "NXPI", "PCAR",
            "DASH", "AEP", "ROP", "PAYX", "TTD", "CHTR", "FANG", "CPRT",
            "FAST", "ROST", "MCHP", "KHC", "KDP", "DXCM", "EA", "ODFL",
            "EXC", "VRSK", "CTSH", "LULU", "CCEP", "GEHC", "XEL", "IDXX",
            "CSGP", "ZS", "ANSS", "BIIB", "ON", "TTWO", "ILMN", "DLTR",
            "CDW", "GFS", "WBD", "BKR", "APP", "TEAM", "MDB", "ARM",
            "DDOG", "SMCI", "COIN", "RDDT",
        ]
    ]

# ── SECTOR 英中映射 ──────────────────────────────────────
SECTOR_MAP = {
    "Technology": "科技", "Consumer Cyclical": "消费/周期",
    "Consumer Defensive": "消费/必需品", "Financial Services": "金融",
    "Healthcare": "医疗健康", "Industrials": "工业",
    "Energy": "能源", "Utilities": "公用事业",
    "Basic Materials": "基础材料", "Communication Services": "通信服务",
    "Real Estate": "房地产",
}

# ── 逐个处理，跳过已有 ────────────────────────────────────
added = 0
skipped = 0
failed = 0

for item in nasdaq100:
    ticker = item["ticker"]
    if ticker in existing_keys:
        skipped += 1
        continue

    # 用 yfinance 补充元数据
    try:
        tk = yf.Ticker(ticker)
        info = tk.info or {}

        name = item["name"] or info.get("shortName") or info.get("longName") or ticker
        yf_sector = info.get("sector", "")
        industry = info.get("industry", "")
        cn_sector = SECTOR_MAP.get(yf_sector, yf_sector)
        sector = f"{cn_sector}/{industry}" if industry else cn_sector
        currency = info.get("currency", "USD")
        desc = (info.get("longBusinessSummary") or "")[:300]
        quote_type = info.get("quoteType", "EQUITY")

        cfg = {
            "name": name,
            "yf_symbol": ticker,
            "type": "etf" if quote_type in ("ETF", "MUTUALFUND") else "stock",
            "market": "US",
            "sector": sector or item.get("sector", ""),
            "currency": currency,
            "description": desc,
        }

        custom[ticker] = cfg
        existing_keys.add(ticker)
        added += 1
        print(f"  [+] {ticker:6s} {name[:30]:30s} ({sector[:20]})")

    except Exception as e:
        failed += 1
        # 即使 yfinance 失败，也加一个最小配置
        custom[ticker] = {
            "name": item.get("name", ticker),
            "yf_symbol": ticker,
            "type": "stock",
            "market": "US",
            "sector": item.get("sector", ""),
            "currency": "USD",
            "description": "",
        }
        existing_keys.add(ticker)
        added += 1
        print(f"  [+] {ticker:6s} (yfinance 失败，最小配置) - {e}")

# ── 保存 ─────────────────────────────────────────────────
with open(CUSTOM_PATH, "w", encoding="utf-8") as f:
    json.dump(custom, f, ensure_ascii=False, indent=2)

total = len(BUILTIN) + len(custom)
print(f"\n{'='*50}")
print(f"完成! 新增 {added} / 跳过 {skipped} / 失败 {failed}")
print(f"tickers_custom.json: {len(custom)} 个")
print(f"总标的数: {total} (内置 {len(BUILTIN)} + 自定义 {len(custom)})")
print(f"{'='*50}")
