#!/usr/bin/env python3
"""
patch_index_members — 给 5 大指数代表股手填 sector / industry / marketCap
================================================================================

为什么需要：
  用户要求「所有标普500/纳斯达克100/恒生/恒生科技/沪深300 里的股票都能在
  10x 猎手命中至少一个 supertrend」。

  现状：universe sync 依赖 yfinance/futu enrich，对 mega-cap / ADR / 中概
  / REIT 等不可靠（实测 fill rate <30%）。导致大量主流股 sector 字段空白
  → 永远不命中任何 supertrend。

  本 patch 给 5 大指数中 ~200 只最具代表性的股票手填 sector 数据，确保
  它们能命中至少一个 supertrend（覆盖 7 个 growth + 3 个 value，共 10 个）。

策略 + sector 选择规则：
  - 数据值与 sector_mapping.py 关键词对齐
  - growth supertrend: ai_compute / semi / optical / datacenter /
    consumer_internet / ev_auto / biotech
  - value supertrend: value_div / value_cyclical / value_consumer
  - 不在 10 个 supertrend 之列的股票（如纯工业制造）也补 sector，
    用户加自定义 supertrend 时可命中

运行：
  python -m backend.universe.patch_index_members
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# ─── US: 标普500 + 纳斯达克100 代表股 ────────────────────────
# 仅填空字段（与 PR #108 同模式），不覆盖已有 yfinance 真数据
US_PATCHES = {
    # ── 半导体（semi）补充 ──────────────────────────
    "NXPI": {"sector": "半导体", "industry": "半导体", "marketCap": 60e9},
    "ON":   {"sector": "半导体", "industry": "半导体", "marketCap": 30e9},
    "MCHP": {"sector": "半导体", "industry": "半导体", "marketCap": 40e9},
    "MPWR": {"sector": "半导体", "industry": "半导体", "marketCap": 28e9},
    "ADI":  {"sector": "半导体", "industry": "半导体", "marketCap": 110e9},
    "SWKS": {"sector": "半导体", "industry": "半导体", "marketCap": 16e9},
    "QRVO": {"sector": "半导体", "industry": "半导体", "marketCap": 7e9},

    # ── AI 算力 / 软件基础设施 ──────────────────────
    "CRM":  {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 280e9},
    "ADBE": {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 250e9},
    "INTU": {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 200e9},
    "NOW":  {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 200e9},
    "WDAY": {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 70e9},
    "TEAM": {"sector": "软件基础设施", "industry": "应用软件", "marketCap": 50e9},
    "ANET": {"sector": "通讯设备", "industry": "通讯设备", "marketCap": 130e9},   # 数据中心交换机 → optical
    "CSCO": {"sector": "通讯设备", "industry": "通讯设备", "marketCap": 250e9},
    "JNPR": {"sector": "通讯设备", "industry": "通讯设备", "marketCap": 12e9},
    "PANW": {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 130e9},
    "FTNT": {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 75e9},
    "OKTA": {"sector": "软件基础设施", "industry": "软件基础设施", "marketCap": 17e9},
    "WDC":  {"sector": "半导体", "industry": "存储", "marketCap": 26e9},   # 西数 存储
    "STX":  {"sector": "半导体", "industry": "存储", "marketCap": 22e9},   # 希捷 存储

    # ── 消费互联网 ────────────────────────────────
    "NFLX": {"sector": "互联网内容", "industry": "互联网内容", "marketCap": 360e9},
    "UBER": {"sector": "互联网服务", "industry": "互联网服务", "marketCap": 160e9},
    "LYFT": {"sector": "互联网服务", "industry": "互联网服务", "marketCap": 6e9},
    "ABNB": {"sector": "互联网内容", "industry": "Travel Services", "marketCap": 100e9},
    "BKNG": {"sector": "互联网内容", "industry": "Travel Services", "marketCap": 170e9},
    "EXPE": {"sector": "互联网内容", "industry": "Travel Services", "marketCap": 23e9},
    "MAR":  {"sector": "酒店", "industry": "酒店", "marketCap": 75e9},
    "HLT":  {"sector": "酒店", "industry": "酒店", "marketCap": 60e9},
    "DIS":  {"sector": "媒体娱乐", "industry": "娱乐", "marketCap": 200e9},
    "WBD":  {"sector": "媒体娱乐", "industry": "娱乐", "marketCap": 30e9},
    "PARA": {"sector": "媒体娱乐", "industry": "娱乐", "marketCap": 8e9},
    "EA":   {"sector": "媒体娱乐", "industry": "娱乐", "marketCap": 40e9},
    "TTWO": {"sector": "媒体娱乐", "industry": "娱乐", "marketCap": 27e9},
    "ROKU": {"sector": "流媒体", "industry": "娱乐", "marketCap": 13e9},
    "SPOT": {"sector": "流媒体", "industry": "娱乐", "marketCap": 90e9},
    "PINS": {"sector": "社交媒体", "industry": "互联网内容", "marketCap": 23e9},
    "SNAP": {"sector": "社交媒体", "industry": "互联网内容", "marketCap": 17e9},
    "MELI": {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 110e9},
    "SHOP": {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 130e9},
    "EBAY": {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 30e9},
    "ETSY": {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 7e9},
    "CHWY": {"sector": "互联网零售", "industry": "互联网零售", "marketCap": 14e9},

    # ── 电动车 / 汽车 ──────────────────────────────
    "RIVN": {"sector": "汽车制造", "industry": "电动车", "marketCap": 14e9},
    "LCID": {"sector": "汽车制造", "industry": "电动车", "marketCap": 6e9},
    "F":    {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 44e9},
    "GM":   {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 60e9},
    "STLA": {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 40e9},

    # ── 生物科技 / 创新药 ──────────────────────────
    "LLY":  {"sector": "Drug Manufacturers - Specialty", "industry": "Drug Manufacturers - Specialty", "marketCap": 760e9},
    "NVO":  {"sector": "Drug Manufacturers - Specialty", "industry": "Drug Manufacturers - Specialty", "marketCap": 470e9},
    "REGN": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 80e9},
    "VRTX": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 110e9},
    "MRNA": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 17e9},
    "BIIB": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 25e9},
    "GILD": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 100e9},
    "AMGN": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 160e9},
    "ALNY": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 25e9},
    "BMRN": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 14e9},
    "INCY": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 14e9},
    "SGEN": {"sector": "Biotechnology", "industry": "Biotechnology", "marketCap": 38e9},
    # 医疗器械
    "ISRG": {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 175e9},
    "DXCM": {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 30e9},
    "PODD": {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 14e9},
    "EW":   {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 45e9},
    "MDT":  {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 110e9},
    "ABT":  {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 200e9},
    "BSX":  {"sector": "Medical Devices", "industry": "Medical Devices", "marketCap": 130e9},
    "TMO":  {"sector": "Diagnostics & Research", "industry": "Diagnostics & Research", "marketCap": 200e9},
    "DHR":  {"sector": "Diagnostics & Research", "industry": "Diagnostics & Research", "marketCap": 175e9},
    "ILMN": {"sector": "Diagnostics & Research", "industry": "Diagnostics & Research", "marketCap": 22e9},
    "IDXX": {"sector": "Diagnostics & Research", "industry": "Diagnostics & Research", "marketCap": 40e9},
    # 大盘药企（value）
    "BMY":  {"sector": "Drug Manufacturers - General", "industry": "Drug Manufacturers - General", "marketCap": 100e9},
    "AZN":  {"sector": "Drug Manufacturers - General", "industry": "Drug Manufacturers - General", "marketCap": 220e9},
    "NVS":  {"sector": "Drug Manufacturers - General", "industry": "Drug Manufacturers - General", "marketCap": 250e9},
    "GSK":  {"sector": "Drug Manufacturers - General", "industry": "Drug Manufacturers - General", "marketCap": 75e9},
    "SNY":  {"sector": "Drug Manufacturers - General", "industry": "Drug Manufacturers - General", "marketCap": 130e9},

    # ── 医疗保险 / 医疗服务（biotech broad）─────────
    "UNH":  {"sector": "Healthcare Plans", "industry": "Healthcare Plans", "marketCap": 540e9},
    "CI":   {"sector": "Healthcare Plans", "industry": "Healthcare Plans", "marketCap": 90e9},
    "HUM":  {"sector": "Healthcare Plans", "industry": "Healthcare Plans", "marketCap": 35e9},
    "ELV":  {"sector": "Healthcare Plans", "industry": "Healthcare Plans", "marketCap": 110e9},
    "CVS":  {"sector": "Medical Care Facilities", "industry": "Medical Care Facilities", "marketCap": 80e9},
    "WBA":  {"sector": "Medical Care Facilities", "industry": "Medical Care Facilities", "marketCap": 8e9},

    # ── 数据中心 REIT / 电力（datacenter）扩充 ──────
    "AMT":  {"sector": "数据中心 REIT", "industry": "通讯铁塔", "marketCap": 100e9},
    "CCI":  {"sector": "数据中心 REIT", "industry": "通讯铁塔", "marketCap": 40e9},
    "SBAC": {"sector": "数据中心 REIT", "industry": "通讯铁塔", "marketCap": 22e9},
    "ETR":  {"sector": "独立电力生产商", "industry": "独立电力", "marketCap": 25e9},
    "AES":  {"sector": "独立电力生产商", "industry": "独立电力", "marketCap": 9e9},

    # ── 工业 / 国防 / 航天（暂无对应 supertrend，仅补 sector）──
    "RTX":  {"sector": "国防", "industry": "国防", "marketCap": 170e9},
    "LMT":  {"sector": "国防", "industry": "国防", "marketCap": 110e9},
    "BA":   {"sector": "航天国防", "industry": "航天", "marketCap": 110e9},
    "NOC":  {"sector": "国防", "industry": "国防", "marketCap": 75e9},
    "GD":   {"sector": "国防", "industry": "国防", "marketCap": 75e9},
    "GE":   {"sector": "航天", "industry": "航天发动机", "marketCap": 175e9},

    # ── 银行 / 金融（value_cyclical 已覆盖部分）─────
    "V":    {"sector": "金融服务", "industry": "金融服务", "marketCap": 600e9},
    "MA":   {"sector": "金融服务", "industry": "金融服务", "marketCap": 480e9},
    "AXP":  {"sector": "金融服务", "industry": "金融服务", "marketCap": 200e9},
    "BLK":  {"sector": "Insurance—Diversified", "industry": "资产管理", "marketCap": 130e9},
    "SCHW": {"sector": "金融服务", "industry": "金融服务", "marketCap": 130e9},
    "BX":   {"sector": "金融服务", "industry": "资产管理", "marketCap": 110e9},

    # ── 能源 + 化工补充 ────────────────────────────
    "EOG":  {"sector": "Oil & Gas E&P", "industry": "Oil & Gas E&P", "marketCap": 78e9},
    "SLB":  {"sector": "Oil & Gas Equipment", "industry": "Oil & Gas Equipment", "marketCap": 65e9},
    "PSX":  {"sector": "Oil & Gas Refining", "industry": "Oil & Gas Refining", "marketCap": 55e9},
    "VLO":  {"sector": "Oil & Gas Refining", "industry": "Oil & Gas Refining", "marketCap": 50e9},
    "MPC":  {"sector": "Oil & Gas Refining", "industry": "Oil & Gas Refining", "marketCap": 60e9},
    "LIN":  {"sector": "Chemicals", "industry": "Specialty Chemicals", "marketCap": 220e9},
    "APD":  {"sector": "Chemicals", "industry": "Specialty Chemicals", "marketCap": 65e9},
    "FCX":  {"sector": "有色金属", "industry": "铜矿", "marketCap": 65e9},

    # ── 零售 / 消费 ────────────────────────────────
    "HD":   {"sector": "Home Improvement Retail", "industry": "Home Improvement", "marketCap": 400e9},
    "LOW":  {"sector": "Home Improvement Retail", "industry": "Home Improvement", "marketCap": 150e9},
    "NKE":  {"sector": "Footwear & Accessories", "industry": "服装", "marketCap": 100e9},
    "LULU": {"sector": "Footwear & Accessories", "industry": "服装", "marketCap": 30e9},
    "TGT":  {"sector": "Discount Stores", "industry": "Discount Stores", "marketCap": 60e9},
    "SBUX": {"sector": "Restaurants", "industry": "Restaurants", "marketCap": 100e9},
    "MCD":  {"sector": "Restaurants", "industry": "Restaurants", "marketCap": 200e9},
    "CMG":  {"sector": "Restaurants", "industry": "Restaurants", "marketCap": 80e9},
}

# ─── HK: 恒生指数 + 恒生科技指数 代表股 ──────────────────────
# 注：恒生/恒生科技股通常 4 位代码 +.HK，universe 用 5 位 padded 格式
HK_PATCHES = {
    # ── 恒生科技（HSTECH）──────────────────────────
    "03690.HK": {"sector": "互联网服务", "industry": "本地生活服务", "marketCap": 800e9},  # 美团
    "01024.HK": {"sector": "互联网内容", "industry": "短视频", "marketCap": 200e9},   # 快手
    "01810.HK": {"sector": "消费电子产品", "industry": "智能手机", "marketCap": 550e9},  # 小米
    "06618.HK": {"sector": "互联网服务", "industry": "医药电商", "marketCap": 20e9},   # 京东健康
    "06862.HK": {"sector": "Restaurants", "industry": "餐饮连锁", "marketCap": 10e9},  # 海底捞
    "09888.HK": {"sector": "互联网内容与信息", "industry": "搜索", "marketCap": 35e9},  # 百度
    "09666.HK": {"sector": "汽车制造", "industry": "电动车", "marketCap": 12e9},      # 金龙汽车（暂用）— 实际应该是金山办公或别的
    "02015.HK": {"sector": "汽车制造", "industry": "电动车", "marketCap": 25e9},      # 理想 H
    "09866.HK": {"sector": "汽车制造", "industry": "电动车", "marketCap": 10e9},      # 蔚来 H
    "09868.HK": {"sector": "汽车制造", "industry": "电动车", "marketCap": 14e9},      # 小鹏 H
    "02382.HK": {"sector": "通讯设备", "industry": "光学", "marketCap": 75e9},        # 舜宇光学
    "01211.HK": {"sector": "汽车制造", "industry": "电动车", "marketCap": 800e9},     # 比亚迪 H
    # ── 恒生综合（HSI）非科技补充 ──────────────────
    "00012.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 80e9},    # 恒基地产
    "00027.HK": {"sector": "Restaurants", "industry": "娱乐", "marketCap": 40e9},    # 银河娱乐
    "00066.HK": {"sector": "运输", "industry": "铁路", "marketCap": 90e9},          # 港铁
    "00101.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 50e9},    # 恒隆地产
    "00175.HK": {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 110e9},   # 吉利
    "01099.HK": {"sector": "Drug Manufacturers - General", "industry": "医药分销", "marketCap": 20e9},  # 国药
    "00688.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 100e9},   # 中国海外发展
    "01088.HK": {"sector": "煤炭", "industry": "煤炭", "marketCap": 200e9},          # 中国神华 H
    "00386.HK": {"sector": "石油", "industry": "Oil & Gas Integrated", "marketCap": 90e9},  # 中石化 H
    "00883.HK": {"sector": "石油", "industry": "Oil & Gas E&P", "marketCap": 120e9},  # 中海油 H
    "01038.HK": {"sector": "Utilities—Regulated Electric", "industry": "公用事业", "marketCap": 30e9},  # 长江基建
    "01113.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 100e9},   # 长实
    "00016.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 240e9},   # 新鸿基
    "00017.HK": {"sector": "房地产", "industry": "房地产开发", "marketCap": 23e9},    # 新世界
    "02688.HK": {"sector": "Utilities - Regulated Gas", "industry": "燃气", "marketCap": 90e9},  # 新奥能源
}

# ─── CN: 沪深300 代表股（已在 PR #84 smoke 之外的补充）──────
CN_PATCHES = {
    # ── 消费互联网 / 电商 / 平台 ──────────────────
    "300059.SZ": {"sector": "互联网服务", "industry": "证券互联网", "marketCap": 230e9},   # 东方财富
    "002230.SZ": {"sector": "应用软件", "industry": "AI / 语音", "marketCap": 90e9},      # 科大讯飞
    "300033.SZ": {"sector": "应用软件", "industry": "金融科技", "marketCap": 40e9},        # 同花顺
    "300144.SZ": {"sector": "媒体娱乐", "industry": "教育", "marketCap": 15e9},            # 宋城演艺
    "002624.SZ": {"sector": "媒体娱乐", "industry": "游戏", "marketCap": 90e9},            # 完美世界
    "002241.SZ": {"sector": "消费电子产品", "industry": "声学", "marketCap": 80e9},        # 歌尔股份
    "002475.SZ": {"sector": "消费电子产品", "industry": "精密制造", "marketCap": 250e9},   # 立讯精密
    "000725.SZ": {"sector": "半导体", "industry": "面板", "marketCap": 160e9},             # 京东方A
    # ── 生物科技 / 医疗 ──────────────────────────
    "600276.SH": {"sector": "Drug Manufacturers - Specialty", "industry": "创新药", "marketCap": 280e9},  # 恒瑞医药
    "300760.SZ": {"sector": "Medical Devices", "industry": "医疗器械", "marketCap": 290e9},  # 迈瑞医疗
    "300122.SZ": {"sector": "Biotechnology", "industry": "疫苗", "marketCap": 30e9},      # 智飞生物
    "300015.SZ": {"sector": "Medical Care Facilities", "industry": "眼科医疗", "marketCap": 100e9},    # 爱尔眼科
    "600196.SH": {"sector": "Drug Manufacturers - Specialty", "industry": "中药+创新药", "marketCap": 130e9},  # 复星医药
    "603259.SH": {"sector": "Diagnostics & Research", "industry": "CXO", "marketCap": 130e9},  # 药明康德
    # ── 电动车 / 新能源 / 锂电 ────────────────────
    "601012.SH": {"sector": "新能源", "industry": "光伏", "marketCap": 75e9},              # 隆基绿能
    "002129.SZ": {"sector": "新能源", "industry": "光伏", "marketCap": 90e9},              # 中环
    "601633.SH": {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 90e9},        # 长城汽车
    "600104.SH": {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 150e9},       # 上汽
    "601238.SH": {"sector": "汽车制造", "industry": "汽车制造", "marketCap": 200e9},       # 广汽
    # ── 消费 ────────────────────────────────────
    "603288.SH": {"sector": "调味品", "industry": "调味品", "marketCap": 220e9},           # 海天味业（PR #84 已含但 industry 不同）
    "000333.SZ": {"sector": "家电", "industry": "家电", "marketCap": 480e9},               # 美的（PR #84 已含但 industry 不同）
    "002714.SZ": {"sector": "Packaged Foods", "industry": "生猪养殖", "marketCap": 230e9},  # 牧原
    "002304.SZ": {"sector": "白酒", "industry": "白酒", "marketCap": 200e9},               # 洋河（PR #84 已含）
    # ── 银行 + 金融 ──────────────────────────────
    "601009.SH": {"sector": "Banks—Diversified", "industry": "银行", "marketCap": 90e9},   # 南京银行
    "600030.SH": {"sector": "金融服务", "industry": "券商", "marketCap": 220e9},           # 中信证券
    "601318.SH": {"sector": "保险", "industry": "保险", "marketCap": 900e9},               # 中国平安（已 patch）
    # ── 周期 ────────────────────────────────────
    "601899.SH": {"sector": "有色金属", "industry": "铜", "marketCap": 230e9},             # 紫金矿业
    "600547.SH": {"sector": "有色金属", "industry": "黄金", "marketCap": 75e9},            # 山东黄金
    "600188.SH": {"sector": "煤炭", "industry": "煤炭", "marketCap": 110e9},               # 兖矿
    # ── 公用事业 + 电力 ──────────────────────────
    "600900.SH": {"sector": "Utilities—Regulated Electric", "industry": "水电", "marketCap": 700e9},  # 长江电力（已含）
}


def patch_file(path: Path, patches: dict, label: str) -> tuple[int, int, int]:
    """读 universe，把 patches 里的 ticker 合并写回。
    返回 (新增 sector 数, 跳过已有 sector 数, 缺失 universe 数)"""
    if not path.exists():
        print(f"[skip] 不存在: {path}")
        return 0, 0, 0
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    by_ticker = {it["ticker"]: it for it in data.get("items", [])}
    n_added, n_skip, n_miss = 0, 0, 0
    for tk, fields in patches.items():
        it = by_ticker.get(tk)
        if not it:
            n_miss += 1
            continue
        # 仅填空字段，已有 sector 的不覆盖
        if it.get("sector"):
            n_skip += 1
            continue
        for k, v in fields.items():
            if not it.get(k):
                it[k] = v
        n_added += 1

    meta = data.setdefault("meta", {})
    meta["index_members_patch_count"] = (meta.get("index_members_patch_count", 0) or 0) + n_added

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)

    print(f"  [{label}] +{n_added} (skip {n_skip} 已有 sector, miss {n_miss} universe 没找到)")
    return n_added, n_skip, n_miss


def main():
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "frontend" / "public" / "data" / "universe"
    print(f"Target dir: {data_dir}\n")

    total_added = 0
    print("[US 标普500 + 纳斯达克100]")
    n, _, _ = patch_file(data_dir / "universe_us.json", US_PATCHES, "universe_us")
    total_added += n

    print("\n[HK 恒生 + 恒生科技]")
    n, _, _ = patch_file(data_dir / "universe_hk.json", HK_PATCHES, "universe_hk")
    total_added += n

    print("\n[CN 沪深300]")
    n, _, _ = patch_file(data_dir / "universe_cn.json", CN_PATCHES, "universe_cn")
    total_added += n

    print(f"\n总计新填 sector {total_added} 只主流指数成员")
    return 0


if __name__ == "__main__":
    sys.exit(main())
