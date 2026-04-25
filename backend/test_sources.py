#!/usr/bin/env python3
"""
快速测试所有数据源是否可用。
用法: python test_sources.py
"""
import sys
import os

# 加载 .env
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# 确保 stdout 能输出 Unicode（Windows GBK 兜底）
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

from data_sources import health_check, fetch_history, fetch_quote, fetch_info, fetch_hk_fundamentals

# ── 1. 健康检查 ──────────────────────────────────────────
print("=" * 60)
print("  数据源健康检查")
print("=" * 60)
status = health_check()
for name, (ok, msg) in status.items():
    icon = "OK" if ok else "FAIL"
    print(f"  [{icon:4s}] {name}: {msg}")

# ── 2. 测试 K线拉取 ──────────────────────────────────────
print("\n" + "=" * 60)
print("  K线测试 (fetch_history)")
print("=" * 60)

test_cases = [
    {"yf_symbol": "NVDA", "market": "US", "name": "NVIDIA"},
    {"yf_symbol": "0005.HK", "market": "HK", "name": "汇丰控股", "futu_symbol": "HK.00005"},
]
for cfg in test_cases:
    try:
        df, src = fetch_history(cfg, days=30)
        latest = round(float(df["Close"].iloc[-1]), 2)
        print(f"  [OK]   {cfg['name']:10s} | 源={src:8s} | {len(df)} 行 | 最新={latest}")
    except Exception as e:
        print(f"  [FAIL] {cfg['name']:10s} | {e}")

# ── 3. 测试实时报价 ──────────────────────────────────────
print("\n" + "=" * 60)
print("  实时报价测试 (fetch_quote)")
print("=" * 60)
for cfg in test_cases:
    try:
        q, src = fetch_quote(cfg)
        price = q.get("price", "N/A")
        chg = q.get("change_pct", "N/A")
        print(f"  [OK]   {cfg['name']:10s} | 源={src:8s} | 价格={price} | 涨跌={chg}%")
    except Exception as e:
        print(f"  [FAIL] {cfg['name']:10s} | {e}")

# ── 4. 测试公司信息 (iTick) ──────────────────────────────
print("\n" + "=" * 60)
print("  公司信息测试 (fetch_info → iTick)")
print("=" * 60)
for cfg in test_cases:
    try:
        info, src = fetch_info(cfg)
        name = info.get("name", "N/A")
        pe = info.get("pe", "N/A")
        mcap = info.get("market_cap", "N/A")
        print(f"  [OK]   {cfg['name']:10s} | 源={src:8s} | 名={name} | PE={pe} | 市值={mcap}")
    except Exception as e:
        print(f"  [FAIL] {cfg['name']:10s} | {e}")

# ── 5. 测试港股财务 (AKShare) ─────────────────────────────
print("\n" + "=" * 60)
print("  港股财务测试 (fetch_hk_fundamentals → AKShare)")
print("=" * 60)
hk_cfg = {"yf_symbol": "0005.HK", "market": "HK", "name": "汇丰控股"}
try:
    fund, src = fetch_hk_fundamentals(hk_cfg)
    pe = fund.get("pe", "N/A")
    mcap = fund.get("market_cap", "N/A")
    pm = fund.get("profit_margin", "N/A")
    print(f"  [OK]   汇丰控股     | 源={src:8s} | PE={pe} | 市值={mcap} | 利润率={pm}%")
except Exception as e:
    print(f"  [FAIL] 汇丰控股     | {e}")

print("\n" + "=" * 60)
print("  测试完成!")
print("=" * 60)
