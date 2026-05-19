#!/usr/bin/env python3
"""
patch_smoke_sectors — 给主流成长股手填缺失的 sector / industry / marketCap
================================================================================

为什么独立 patch：
  universe sync 从 NASDAQ Trader 拉到 ticker 列表，但 sector/industry/marketCap
  靠 yfinance / futu enrich。两个数据源都对 mega-cap 不可靠（实测 fill rate 低，
  尤其 ADR / 中概 / REIT 类）。

  导致 TSM / EQIX / SNOW / BABA 等主流成长股 sector 字段空白 → screen 阶段
  不命中任何 supertrend → 用户在 UI 找不到。

  本 patch 给 22 只主流成长股手填，让它们在「AI 算力 / 半导体 / 光通信 /
  算力中心」4 个赛道里能被筛到。

数据来源：
  yfinance / finviz / 富途 / 公司官方分类（2025-12 时点）

修改文件：
  - frontend/public/data/universe/universe_us.json (Vercel 部署用)

运行：
  python -m backend.universe.patch_smoke_sectors
"""
import json
import sys
from pathlib import Path

# sector / industry 用中文，与现有 sector_mapping 关键词对齐
# marketCap 单位是美元（不是 B）
US_SECTOR_PATCHES = {
    # 半导体（命中 semi 赛道）
    "TSM":  {"sector": "半导体", "industry": "半导体", "marketCap": 1200e9},  # 台积电
    "QCOM": {"sector": "半导体", "industry": "半导体", "marketCap": 187e9},
    "TXN":  {"sector": "半导体", "industry": "半导体", "marketCap": 256e9},
    "ARM":  {"sector": "半导体", "industry": "半导体", "marketCap": 224e9},

    # 光通信（命中 optical via broad keyword "通讯设备"）
    "CIEN": {"sector": "通讯设备", "industry": "光通信", "marketCap": 18e9},
    "COHR": {"sector": "通讯设备", "industry": "激光与光电子", "marketCap": 13e9},
    "FN":   {"sector": "通讯设备", "industry": "光通信", "marketCap": 11e9},

    # 数据中心 REIT（命中 datacenter via "数据中心"）
    "EQIX": {"sector": "数据中心 REIT", "industry": "数据中心", "marketCap": 84e9},
    "DLR":  {"sector": "数据中心 REIT", "industry": "数据中心", "marketCap": 60e9},
    "IRM":  {"sector": "数据中心 REIT", "industry": "数据中心 REIT", "marketCap": 35e9},   # industry 不含"存储"避免误命中 semi 赛道

    # 独立电力（命中 datacenter via 新 keyword "独立电力"）
    "VST":  {"sector": "独立电力生产商", "industry": "独立电力", "marketCap": 65e9},
    "NRG":  {"sector": "独立电力生产商", "industry": "独立电力", "marketCap": 23e9},
    "TLN":  {"sector": "独立电力生产商", "industry": "独立电力", "marketCap": 17e9},

    # 软件基础设施（命中 ai_compute via broad）
    "GOOG":  {"sector": "互联网内容与信息", "industry": "互联网内容与信息", "marketCap": 2500e9},
    "GOOGL": {"sector": "互联网内容与信息", "industry": "互联网内容与信息", "marketCap": 2500e9},
    "NET":   {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 38e9},
    "SNOW":  {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 60e9},
    "CRWD":  {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 116e9},
    "ZS":    {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 36e9},
    "ORCL":  {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 460e9},

    # 注：以下不在现有 4 赛道，但补 marketCap 让用户能搜
    "TSLA":  {"sector": "汽车制造", "industry": "电动车", "marketCap": 1100e9},
    "AMZN":  {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 2200e9},
    # 中概股
    "BABA":  {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 180e9},
    "NIO":   {"sector": "汽车制造", "industry": "电动车", "marketCap": 8e9},
    "XPEV":  {"sector": "汽车制造", "industry": "电动车", "marketCap": 12e9},
}


def patch_file(path: Path, patches: dict[str, dict]) -> tuple[int, int]:
    """读 universe，把 patches 里的 ticker 字段合并写回。
    返回 (实际命中数, 缺失数)"""
    if not path.exists():
        print(f"[skip] 不存在: {path}")
        return 0, 0
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    by_ticker = {it["ticker"]: it for it in data.get("items", [])}
    n_ok = 0
    n_miss = 0
    for tk, fields in patches.items():
        it = by_ticker.get(tk)
        if not it:
            print(f"  [miss] {tk}")
            n_miss += 1
            continue
        # 仅填空字段 — 不覆盖已有 sector（避免破坏 yfinance 真实数据）
        for k, v in fields.items():
            if not it.get(k):
                it[k] = v
        n_ok += 1

    # 更新 meta
    meta = data.setdefault("meta", {})
    meta["sector_smoke_patch_count"] = n_ok
    meta["sector_smoke_note"] = (
        "手填 ~22 只主流成长股 sector 数据；解决 yfinance enrich 对 mega-cap"
        " 不可靠导致的 supertrend 不命中问题"
    )

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)

    print(f"  [{path.stem}] patched {n_ok}, missing {n_miss}")
    return n_ok, n_miss


def main():
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "frontend" / "public" / "data" / "universe"
    print(f"Target dir: {data_dir}\n")
    print("[US]")
    n_ok, n_miss = patch_file(data_dir / "universe_us.json", US_SECTOR_PATCHES)
    print(f"\n总计 {n_ok} 只主流成长股 sector 数据已补齐（缺 {n_miss}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
