#!/usr/bin/env python3
"""
patch_smoke_fundamentals — 给 universe_*.json 手工补几只代表性价值股的财务字段
================================================================================

用途：
  真正的 `sync_us --enrich-fundamentals` 跑全市场 ~30 分钟，本脚本作为
  smoke 数据补丁，让用户立刻能在前端看到价值型筛选的效果（PE/股息/ROE
  实际过滤）。

数据来源：
  公开年报 + 主要财经站（finviz / yahoo finance / 雪球）2025-05 时点
  大致估算值，仅用于演示。真实数据请跑完整 enrich。

修改文件：
  - frontend/public/data/universe/universe_us.json (Vercel 部署用)
  - frontend/public/data/universe/universe_cn.json
  - frontend/public/data/universe/universe_hk.json

运行：
  python -m backend.universe.patch_smoke_fundamentals
"""
import json
import sys
from pathlib import Path

# 模式：覆盖 universe item 的 5 维财务字段（pe / pb / dividend_yield / roe / debt_to_equity）
# 同时补 sector / industry / marketCap — 让这些票能被价值赛道 sector_mapping 命中。
# 数值仅做 smoke 演示，非投资建议。
US_PATCHES = {
    # 高股息蓝筹（value_div 命中：电信/能源/烟草）
    "VZ":   {"pe": 9.5,  "pb": 1.7, "dividend_yield": 0.066, "roe": 0.234, "debt_to_equity": 1.62,
             "sector": "Telecom Services—Diversified", "industry": "Telecom Services—Diversified", "marketCap": 167e9},
    "T":    {"pe": 11.0, "pb": 1.4, "dividend_yield": 0.055, "roe": 0.131, "debt_to_equity": 1.30,
             "sector": "Telecom Services—Diversified", "industry": "Telecom Services—Diversified", "marketCap": 122e9},
    "XOM":  {"pe": 13.5, "pb": 1.95, "dividend_yield": 0.036, "roe": 0.160, "debt_to_equity": 0.25,
             "sector": "Oil & Gas Integrated", "industry": "Oil & Gas Integrated", "marketCap": 460e9},
    "CVX":  {"pe": 16.0, "pb": 1.60, "dividend_yield": 0.045, "roe": 0.108, "debt_to_equity": 0.16,
             "sector": "Oil & Gas Integrated", "industry": "Oil & Gas Integrated", "marketCap": 290e9},
    # MO 净资产为负（高分红+回购吃光股东权益），ROE / PB / D/E 数学上失真，留 null
    "MO":   {"pe": 9.2,  "pb": None, "dividend_yield": 0.075, "roe": None,  "debt_to_equity": None,
             "sector": "Tobacco", "industry": "Tobacco", "marketCap": 92e9},
    # 消费稳健（value_consumer 命中：饮料/食品/日用）
    "KO":   {"pe": 25.0, "pb": 9.5, "dividend_yield": 0.029, "roe": 0.470, "debt_to_equity": 1.85,
             "sector": "Beverages—Non-Alcoholic", "industry": "Beverages—Non-Alcoholic", "marketCap": 270e9},
    "PEP":  {"pe": 24.0, "pb": 11.5, "dividend_yield": 0.030, "roe": 0.460, "debt_to_equity": 1.98,
             "sector": "Beverages—Non-Alcoholic", "industry": "Beverages—Non-Alcoholic", "marketCap": 230e9},
    "PG":   {"pe": 26.5, "pb": 8.0, "dividend_yield": 0.025, "roe": 0.300, "debt_to_equity": 0.62,
             "sector": "Household & Personal Products", "industry": "Household & Personal Products", "marketCap": 380e9},
    "JNJ":  {"pe": 22.0, "pb": 5.5, "dividend_yield": 0.030, "roe": 0.260, "debt_to_equity": 0.50,
             "sector": "Drug Manufacturers—General", "industry": "Drug Manufacturers—General", "marketCap": 380e9},
    # 周期价值（value_cyclical 命中：银行）
    "BAC":  {"pe": 12.0, "pb": 1.10, "dividend_yield": 0.025, "roe": 0.095, "debt_to_equity": 0.85,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 280e9},
    "JPM":  {"pe": 12.5, "pb": 1.80, "dividend_yield": 0.024, "roe": 0.160, "debt_to_equity": 1.20,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 580e9},
    "WFC":  {"pe": 11.8, "pb": 1.30, "dividend_yield": 0.025, "roe": 0.120, "debt_to_equity": 1.00,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 200e9},
    # 成长股对照（不命中价值赛道；但 PE 高确认筛选会剔除）
    "NVDA": {"pe": 65.0, "pb": 45.0, "dividend_yield": 0.0003, "roe": 1.15, "debt_to_equity": 0.18},
    "TSLA": {"pe": 70.0, "pb": 12.0, "dividend_yield": 0.0,   "roe": 0.180, "debt_to_equity": 0.10},
}

CN_PATCHES = {
    # 高股息蓝筹（电信/能源/银行）
    "600028.SH": {"pe": 7.2,  "pb": 0.65, "dividend_yield": 0.060, "roe": 0.080, "debt_to_equity": 0.45},   # 中国石化
    "601857.SH": {"pe": 6.8,  "pb": 0.70, "dividend_yield": 0.062, "roe": 0.095, "debt_to_equity": 0.30},   # 中国石油
    "600519.SH": {"pe": 24.0, "pb": 8.5,  "dividend_yield": 0.020, "roe": 0.340, "debt_to_equity": 0.08},   # 贵州茅台
    "600036.SH": {"pe": 6.5,  "pb": 1.05, "dividend_yield": 0.058, "roe": 0.160, "debt_to_equity": 0.90},   # 招商银行
    "601398.SH": {"pe": 5.8,  "pb": 0.55, "dividend_yield": 0.072, "roe": 0.105, "debt_to_equity": 1.10},   # 工商银行
    "601318.SH": {"pe": 8.5,  "pb": 0.95, "dividend_yield": 0.044, "roe": 0.115, "debt_to_equity": 0.55},   # 中国平安
    # 周期价值（化工/钢铁/煤炭）
    "600028.SH": {"pe": 7.2,  "pb": 0.65, "dividend_yield": 0.060, "roe": 0.080, "debt_to_equity": 0.45},
    "601088.SH": {"pe": 10.5, "pb": 1.70, "dividend_yield": 0.080, "roe": 0.190, "debt_to_equity": 0.20},   # 中国神华
}

HK_PATCHES = {
    # 高股息蓝筹（公用事业/银行/能源）
    "00939.HK": {"pe": 4.2,  "pb": 0.45, "dividend_yield": 0.075, "roe": 0.106, "debt_to_equity": 1.00},   # 建设银行
    "01398.HK": {"pe": 4.0,  "pb": 0.42, "dividend_yield": 0.078, "roe": 0.105, "debt_to_equity": 1.05},   # 工商银行 H
    "00857.HK": {"pe": 5.5,  "pb": 0.55, "dividend_yield": 0.075, "roe": 0.105, "debt_to_equity": 0.28},   # 中国石油 H
    "00386.HK": {"pe": 6.0,  "pb": 0.55, "dividend_yield": 0.070, "roe": 0.090, "debt_to_equity": 0.45},   # 中国石化 H
    "00006.HK": {"pe": 10.5, "pb": 0.90, "dividend_yield": 0.052, "roe": 0.085, "debt_to_equity": 0.70},   # 电能实业
    # 消费稳健
    "00322.HK": {"pe": 14.0, "pb": 2.20, "dividend_yield": 0.025, "roe": 0.155, "debt_to_equity": 0.20},   # 康师傅
    "01113.HK": {"pe": 11.0, "pb": 1.65, "dividend_yield": 0.038, "roe": 0.150, "debt_to_equity": 0.65},   # 长实集团（地产 — 仅作低估值示例）
}


def patch_file(path: Path, patches: dict[str, dict]) -> int:
    """读取 universe JSON，给指定 ticker 加财务字段，写回。返回实际 patch 的票数。"""
    if not path.exists():
        print(f"[skip] 不存在: {path}")
        return 0
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    by_ticker = {it["ticker"]: it for it in data.get("items", [])}
    n = 0
    for tk, fields in patches.items():
        it = by_ticker.get(tk)
        if not it:
            print(f"  [miss] {tk}（universe 里没找到）")
            continue
        it.update(fields)
        n += 1
        def _fmt_pct(v):
            return f"{v*100:.1f}%" if isinstance(v, (int, float)) else "—"
        print(f"  [ok] {tk}: pe={fields['pe']} div={_fmt_pct(fields['dividend_yield'])} roe={_fmt_pct(fields['roe'])}")

    # 更新 meta（标记 smoke patch 让用户知道这不是完整 enrich）
    meta = data.setdefault("meta", {})
    meta["fundamentals_smoke_count"] = n
    meta.setdefault("fundamentals_note",
        "smoke patch (10-15 representative tickers); 跑 sync_*.py --enrich-fundamentals 获取全市场")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
    return n


def main():
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "frontend" / "public" / "data" / "universe"
    print(f"Target dir: {data_dir}\n")

    total = 0
    print("[US]")
    total += patch_file(data_dir / "universe_us.json", US_PATCHES)
    print(f"\n[CN]")
    total += patch_file(data_dir / "universe_cn.json", CN_PATCHES)
    print(f"\n[HK]")
    total += patch_file(data_dir / "universe_hk.json", HK_PATCHES)

    print(f"\n总计 patch {total} 只价值股 smoke 数据")
    return 0


if __name__ == "__main__":
    sys.exit(main())
