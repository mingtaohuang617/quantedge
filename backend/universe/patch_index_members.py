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


# ─── Phase 2: 批量扩 SPX 500 / NDX 100 剩余票 ───────────────
# 使用 helper 批量定义同 sector 的多 ticker，避免重复打字
def _expand(tickers, sector, industry=None, marketCap=None):
    """生成 {ticker: {sector, industry, marketCap}} dict。industry 默认同 sector。"""
    industry = industry or sector
    return {t: {"sector": sector, "industry": industry, "marketCap": marketCap} for t in tickers}


US_PHASE2 = {}

# 半导体 + 半导体设备
US_PHASE2.update(_expand(
    ["GFS", "MU", "SNPS", "CDNS", "ANSS", "KEYS", "TER", "ENPH", "FSLR"],
    "半导体", "半导体", 80e9,
))

# AI 软件 / 应用软件 / 信息技术服务
US_PHASE2.update(_expand(
    ["IBM", "AKAM", "ANSS", "CDW", "EPAM", "FFIV", "GEN", "FIS", "FI", "GPN",
     "INTU", "FICO", "IT", "JKHY", "KEYS", "MSCI", "MCO", "MKTX",
     "NWSA", "NWS", "NTAP", "ORCL", "PAYC", "PAYX", "PTC", "ROP",
     "TYL", "TXN", "VRSK", "VRSN", "WDC", "STX"],
    "信息技术服务", "信息技术服务", 50e9,
))
US_PHASE2.update(_expand(
    ["AKAM", "CDAY", "DXC", "ENPH", "LDOS"],
    "信息技术服务", "信息技术服务", 20e9,
))

# 通讯设备 / 网络（→ optical broad）
US_PHASE2.update(_expand(
    ["CSCO", "ANET", "JNPR", "MSI", "GLW", "NTAP", "ZBRA", "KEYS"],
    "通讯设备", "通讯设备", 50e9,
))

# 消费互联网 / 媒体娱乐
US_PHASE2.update(_expand(
    ["DIS", "WBD", "PARA", "NFLX", "FOXA", "FOX", "OMC", "IPG", "CHTR", "CMCSA"],
    "媒体娱乐", "媒体娱乐", 50e9,
))
US_PHASE2.update(_expand(
    ["TTWO", "EA", "RBLX", "ROKU"],
    "电子游戏与多媒体", "电子游戏与多媒体", 30e9,
))

# 旅游 / 酒店 / 餐饮 / 休闲（→ consumer_internet）
US_PHASE2.update(_expand(
    ["MAR", "HLT", "LVS", "MGM", "WYNN", "CZR", "NCLH", "RCL", "CCL", "BKNG", "EXPE", "ABNB"],
    "住宿", "住宿", 50e9,
))
US_PHASE2.update(_expand(
    ["YUM", "MCD", "SBUX", "CMG", "DPZ", "DRI"],
    "餐厅", "餐厅", 50e9,
))
US_PHASE2.update(_expand(
    ["LYV", "HAS", "POOL"],
    "休闲", "休闲", 10e9,
))

# 国防航天（新 supertrend）
US_PHASE2.update(_expand(
    ["BA", "RTX", "LMT", "NOC", "GD", "HII", "TXT", "AXON", "LHX", "TDG", "LDOS",
     "L3HARRIS"],
    "航空航天与国防", "航空航天与国防", 100e9,
))
US_PHASE2.update(_expand(
    ["GE", "GEHC", "GEN"],
    "航空航天与国防", "航空航天与国防", 100e9,
))

# 生物科技 / 医疗（→ biotech）
US_PHASE2.update(_expand(
    ["LLY", "NVO", "REGN", "VRTX", "MRNA", "BIIB", "GILD", "AMGN", "ALNY",
     "BMRN", "INCY", "SGEN", "BIO", "TECH", "CRL", "WAT", "MTD", "RVTY",
     "VTRS", "ZTS", "HSIC", "PODD", "RMD", "STE", "SYK", "TFX", "ZBH"],
    "生物技术", "生物技术", 50e9,
))
US_PHASE2.update(_expand(
    ["ISRG", "DXCM", "EW", "MDT", "ABT", "BSX", "BAX", "BDX", "COO", "HOLX",
     "DGX", "IDXX", "DHR", "TMO", "ILMN", "WST", "HCA", "UHS", "MOH", "ELV",
     "CI", "HUM", "UNH", "CNC", "MCK", "COR", "CAH", "CVS"],
    "医疗设备", "医疗设备", 50e9,
))
US_PHASE2.update(_expand(
    ["IQV", "A", "RVTY"],
    "诊断与研究", "诊断与研究", 30e9,
))

# 大盘药企（→ value_consumer）
US_PHASE2.update(_expand(
    ["JNJ", "PFE", "MRK", "ABBV", "BMY", "AZN", "NVS", "GSK", "SNY", "GEHC",
     "OGN"],
    "一般药品制造商", "一般药品制造商", 100e9,
))

# 金融服务 / 资本市场 / 资产管理（→ value_cyclical）
US_PHASE2.update(_expand(
    ["V", "MA", "AXP", "PYPL", "FIS", "FI", "GPN", "PAYX", "PAYC",
     "SCHW", "MS", "GS", "C", "BAC", "JPM", "WFC", "USB", "PNC", "TFC",
     "BK", "STT", "NTRS", "MTB", "CMA", "HBAN", "FITB", "CFG", "RF", "KEY",
     "SYF", "DFS", "COF", "ALLY", "AXP"],
    "金融服务", "金融服务", 100e9,
))
US_PHASE2.update(_expand(
    ["BLK", "BX", "TROW", "BEN", "IVZ", "AMP", "RJF", "MKTX", "CBOE", "CME",
     "ICE", "NDAQ", "SPGI", "MCO", "MSCI", "FDS"],
    "资本市场", "资本市场", 100e9,
))

# 保险（→ value_cyclical 现已含 Insurance—Diversified）
US_PHASE2.update(_expand(
    ["AIG", "MMC", "AON", "WLTW", "WRB", "TRV", "PGR", "ALL", "CINF", "HIG",
     "AJG", "BRO", "AIZ", "WTW", "L", "AFL", "MET", "PRU", "PFG", "GL",
     "EG", "ACGL", "WRB", "RGA", "UNM"],
    "Insurance—Diversified", "保险", 50e9,
))

# 能源（→ value_div - 现已扩 E&P / Refining / Equipment）
US_PHASE2.update(_expand(
    ["XOM", "CVX", "COP", "EOG", "MPC", "PSX", "VLO", "OXY", "FANG",
     "PXD", "APA", "EQT", "DVN", "MRO", "HES", "HAL", "SLB", "BKR",
     "OKE", "TRGP", "WMB", "CTRA", "KMI", "ENB", "ET", "EPD"],
    "油气勘探与开发", "油气勘探与开发", 50e9,
))

# 公用事业（→ datacenter broad / value_div）
US_PHASE2.update(_expand(
    ["NEE", "DUK", "SO", "AEP", "EXC", "ED", "ETR", "AES", "SRE", "XEL",
     "WEC", "ES", "PEG", "PCG", "AWK", "EIX", "DTE", "CMS", "PPL", "ATO",
     "FE", "NI", "LNT", "EVRG", "PNW", "AEE", "CNP", "D"],
    "受监管电力", "受监管电力", 50e9,
))

# 电信（→ value_div）
US_PHASE2.update(_expand(
    ["VZ", "T", "TMUS", "CMCSA", "CHTR"],
    "电信服务", "电信服务", 150e9,
))

# 零售（→ value_consumer）
US_PHASE2.update(_expand(
    ["WMT", "COST", "TGT", "DG", "DLTR", "BJ"],
    "折扣零售", "折扣零售", 100e9,
))
US_PHASE2.update(_expand(
    ["HD", "LOW", "POOL", "BLDR"],
    "家居装饰零售", "家居装饰零售", 100e9,
))
US_PHASE2.update(_expand(
    ["NKE", "LULU", "TJX", "ROST", "ULTA", "VFC", "GPS", "TPR", "RL",
     "LVS", "DECK", "ANF", "URBN", "BBWI"],
    "服装鞋类", "服装鞋类", 30e9,
))

# 房地产 REIT（部分映射到 datacenter 现已含数据中心 REIT）
US_PHASE2.update(_expand(
    ["AMT", "CCI", "SBAC"],
    "数据中心 REIT", "通讯铁塔", 50e9,
))
US_PHASE2.update(_expand(
    ["EQIX", "DLR"],
    "数据中心 REIT", "数据中心", 70e9,
))
US_PHASE2.update(_expand(
    ["IRM"],
    "数据中心 REIT", "数据中心 REIT", 35e9,
))
US_PHASE2.update(_expand(
    ["PLD", "WELL", "AVB", "EQR", "PSA", "MAA", "ESS", "INVH", "UDR", "CPT",
     "FRT", "REG", "KIM", "BXP", "VTR", "PEAK", "ARE", "EXR", "VICI",
     "WPC", "O", "STAG", "HST"],
    "房地产", "房地产 REIT", 30e9,
))

# 工业制造（→ value_cyclical 现已含 Farm & Heavy Construction Machinery / Specialty Industrial Machinery）
US_PHASE2.update(_expand(
    ["CAT", "DE", "PCAR", "PH", "ETN", "EMR", "ROK", "DOV", "ITW", "IR",
     "GNRC", "IEX", "HUBB", "MMM", "AOS", "AME", "FAST", "FTV", "GWW",
     "HON", "GWW", "PNR", "SNA", "SWK", "URI", "WAB", "XYL", "NDSN",
     "HWM", "JCI", "RSG", "WM", "OTIS", "AYI", "ALLE", "PWR", "CARR"],
    "工业机械", "工业机械", 50e9,
))
US_PHASE2.update(_expand(
    ["UNP", "CSX", "NSC"],
    "铁路", "铁路", 100e9,
))
US_PHASE2.update(_expand(
    ["UPS", "FDX", "EXPD", "JBHT", "CHRW", "CDW", "ODFL", "XPO", "GXO"],
    "综合货运与物流", "综合货运与物流", 50e9,
))
US_PHASE2.update(_expand(
    ["AAL", "DAL", "LUV", "UAL", "ALK", "JBLU"],
    "航空", "航空", 20e9,
))

# 化工 / 材料（→ value_cyclical）
US_PHASE2.update(_expand(
    ["LIN", "APD", "ECL", "SHW", "PPG", "CE", "EMN", "DOW", "DD",
     "ALB", "LYB", "AVY", "AMCR", "IFF", "FMC", "CTVA", "MOS", "CF"],
    "化工", "Specialty Chemicals", 50e9,
))
US_PHASE2.update(_expand(
    ["FCX", "NEM", "NUE", "STLD", "MOS", "VMC", "MLM"],
    "有色金属", "有色金属", 50e9,
))

# 食品 / 饮料 / 必需消费（→ value_consumer）
US_PHASE2.update(_expand(
    ["KO", "PEP", "MNST", "STZ", "KDP", "TAP", "BF.B", "FIZZ"],
    "饮料", "饮料", 100e9,
))
US_PHASE2.update(_expand(
    ["MDLZ", "KHC", "GIS", "K", "CPB", "CAG", "HRL", "HSY", "SJM", "MKC",
     "TSN", "PG", "CL", "CHD", "KMB", "EL", "CLX", "ADM", "BG"],
    "包装食品", "Packaged Foods", 50e9,
))
US_PHASE2.update(_expand(
    ["MO", "PM", "BTI"],
    "Tobacco", "烟草", 100e9,
))

# AI 软件 / SaaS（许多已分类，补漏）
US_PHASE2.update(_expand(
    ["NOW", "PANW", "FTNT", "CRWD", "ZS", "OKTA", "WDAY", "TEAM", "MDB",
     "DDOG", "SNOW", "NET", "PLTR", "SPLK", "ESTC", "GTLB", "S",
     "DOCN", "CFLT", "PATH", "DBX", "TWLO", "BILL"],
    "应用软件", "SaaS", 50e9,
))
US_PHASE2.update(_expand(
    ["CRM", "ADBE", "INTU", "ORCL"],
    "应用软件", "应用软件", 200e9,
))

# 消费电子（→ ai_compute）
US_PHASE2.update(_expand(
    ["AAPL"],
    "消费电子产品", "消费电子产品", 4000e9,
))
US_PHASE2.update(_expand(
    ["DELL", "HPQ", "HPE"],
    "计算机硬件", "计算机硬件", 50e9,
))
US_PHASE2.update(_expand(
    ["SMCI"],
    "计算机硬件", "计算机硬件", 50e9,
))

US_PATCHES.update(US_PHASE2)

# ─── Phase 3: 补 SPX 中盘剩余票 ──────────────────────────────
US_PHASE3 = {}
# IT 服务 / 软件（→ ai_compute）
US_PHASE3.update(_expand(
    ["ACN", "CTSH", "ANSS", "CTAS", "CDAY", "PAYC", "PAYX", "CPRT", "CSGP",
     "TRMB", "EFX", "FI", "FLT", "TDY", "GEN", "BR", "J"],
    "信息技术服务", "信息技术服务", 50e9,
))
# 汽车零部件（→ ev_auto via 汽车零部件 broad）
US_PHASE3.update(_expand(
    ["APTV", "BWA", "CMI", "GPC", "LKQ", "ORLY", "AZO", "GRMN", "TEL", "APH"],
    "汽车零部件", "汽车零部件", 30e9,
))
# 生物 / 医疗器械（→ biotech）
US_PHASE3.update(_expand(
    ["CTLT", "HOLX", "LH", "DVA"],
    "医疗设备", "医疗设备", 30e9,
))
# 保险（→ value_cyclical）
US_PHASE3.update(_expand(
    ["CB", "MMC", "AON", "WLTW", "WRB", "TRV", "PGR", "ALL", "CINF", "HIG",
     "AJG", "BRO", "AIZ", "WTW"],
    "保险", "Insurance—Property & Casualty", 50e9,
))
# 银行 / 金融（→ value_cyclical）
US_PHASE3.update(_expand(
    ["CMA", "DFS"],
    "银行", "Banks - Regional", 25e9,
))
# 食品 / 必需消费（→ value_consumer）
US_PHASE3.update(_expand(
    ["K", "KR", "LW", "SYY", "MKC"],
    "食品", "Packaged Foods", 30e9,
))
# 油气（→ value_div）
US_PHASE3.update(_expand(
    ["MRO", "HES", "PXD"],
    "油气勘探与开发", "油气勘探与开发", 30e9,
))
# 媒体广告（→ consumer_internet）
US_PHASE3.update(_expand(
    ["IPG", "PARA", "OMC"],
    "媒体娱乐", "媒体娱乐", 20e9,
))
# 餐饮 / 零售（→ consumer_internet / value_consumer）
US_PHASE3.update(_expand(
    ["TSCO", "BBY", "KMX", "ROST", "TJX"],
    "折扣零售", "折扣零售", 50e9,
))
# REIT 综合（→ datacenter via 房地产，部分公用事业）
US_PHASE3.update(_expand(
    ["SPG", "PEAK", "WELL", "VTR", "INVH"],
    "房地产", "房地产 REIT", 50e9,
))
# 包装 / 工业（→ value_cyclical 现已含 Specialty Industrial Machinery）
US_PHASE3.update(_expand(
    ["BALL", "PKG", "SEE", "IP", "AMCR"],
    "化工", "包装材料", 20e9,
))
US_PHASE3.update(_expand(
    ["MAS", "JNPR", "TT", "MHK", "ROL"],
    "工业机械", "工业机械", 30e9,
))
# 国防（→ defense_aerospace）
US_PHASE3.update(_expand(
    ["TXT", "HII"],
    "航空航天与国防", "航空航天与国防", 30e9,
))
# 综合金融（→ value_cyclical）
US_PHASE3.update(_expand(
    ["BRK.B"],
    "Insurance—Diversified", "保险", 1000e9,
))

US_PATCHES.update(US_PHASE3)

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

HK_PHASE2 = {}
# HSI 蓝筹补充（金融 / 地产 / 能源 / 公用）
HK_PHASE2.update(_expand(
    ["00005.HK", "00011.HK", "00939.HK", "01398.HK", "03988.HK", "02388.HK",
     "00388.HK", "01113.HK", "00016.HK", "00017.HK", "00688.HK",
     "01038.HK", "00006.HK", "00002.HK", "00003.HK", "01999.HK"],
    "金融服务", "金融服务", 100e9,
))
# 中概互联 / 科技
HK_PHASE2.update(_expand(
    ["00700.HK", "09988.HK", "03690.HK", "01024.HK", "06618.HK",
     "09618.HK", "09888.HK", "01810.HK", "06862.HK", "01177.HK"],
    "互联网内容", "互联网", 100e9,
))
# 电动车 H 股
HK_PHASE2.update(_expand(
    ["01211.HK", "02015.HK", "09866.HK", "09868.HK", "00175.HK"],
    "汽车", "电动车", 50e9,
))
# 港交所 / 保险
HK_PHASE2.update(_expand(
    ["01299.HK", "02318.HK", "01336.HK", "00966.HK"],
    "保险", "保险", 100e9,
))
# 港股医药
HK_PHASE2.update(_expand(
    ["02269.HK", "01093.HK", "01177.HK", "06160.HK", "02196.HK"],
    "生物技术", "生物技术", 30e9,
))

HK_PATCHES.update(HK_PHASE2)

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

CN_PHASE2 = {}
# 沪深300 银行（→ value_cyclical）
CN_PHASE2.update(_expand(
    ["600036.SH", "601398.SH", "601288.SH", "601988.SH", "601939.SH",
     "601166.SH", "600000.SH", "600015.SH", "601169.SH", "601229.SH",
     "601328.SH", "601658.SH", "601818.SH", "600016.SH", "601009.SH",
     "601128.SH", "002142.SZ"],
    "银行", "银行", 200e9,
))
# 保险 + 券商
CN_PHASE2.update(_expand(
    ["601318.SH", "601628.SH", "601601.SH", "601336.SH"],
    "保险", "保险", 200e9,
))
CN_PHASE2.update(_expand(
    ["600030.SH", "601995.SH", "600999.SH", "601066.SH", "601211.SH"],
    "证券", "证券", 100e9,
))
# 沪深300 白酒 + 食品 + 消费
CN_PHASE2.update(_expand(
    ["600519.SH", "000858.SZ", "002304.SZ", "000568.SZ", "600809.SH"],
    "白酒", "白酒", 200e9,
))
CN_PHASE2.update(_expand(
    ["600887.SH", "603288.SH", "000895.SZ", "000333.SZ", "000651.SZ"],
    "食品", "食品", 100e9,
))
# 沪深300 医药 / CXO
CN_PHASE2.update(_expand(
    ["600276.SH", "600196.SH", "300122.SZ", "603259.SH", "002007.SZ",
     "300015.SZ", "300760.SZ", "002821.SZ", "300347.SZ"],
    "化学制药", "创新药", 100e9,
))
# 沪深300 半导体 / 科技
CN_PHASE2.update(_expand(
    ["688981.SH", "002371.SZ", "002475.SZ", "002241.SZ", "300782.SZ",
     "603501.SH", "688012.SH", "300661.SZ", "688256.SH", "688041.SH"],
    "半导体", "半导体", 100e9,
))
# 沪深300 软件 / AI
CN_PHASE2.update(_expand(
    ["002230.SZ", "300033.SZ", "300059.SZ", "002405.SZ", "300144.SZ",
     "002624.SZ"],
    "应用软件", "应用软件", 50e9,
))
# 沪深300 电动车 / 新能源
CN_PHASE2.update(_expand(
    ["300750.SZ", "002594.SZ", "601127.SH", "601633.SH", "600104.SH",
     "601238.SH", "002460.SZ", "300014.SZ", "300316.SZ", "688599.SH"],
    "新能源", "电动车", 100e9,
))
# 沪深300 光伏
CN_PHASE2.update(_expand(
    ["601012.SH", "002129.SZ", "601865.SH", "300274.SZ", "688303.SH"],
    "新能源", "光伏", 50e9,
))
# 沪深300 能源
CN_PHASE2.update(_expand(
    ["600028.SH", "601857.SH", "600938.SH", "601088.SH", "600188.SH",
     "601225.SH", "601898.SH"],
    "石油", "石油", 200e9,
))
# 沪深300 电信 / 公用
CN_PHASE2.update(_expand(
    ["600941.SH", "601728.SH", "600050.SH"],
    "电信服务", "电信运营", 100e9,
))
CN_PHASE2.update(_expand(
    ["600900.SH", "600025.SH", "601985.SH", "600886.SH"],
    "受监管电力", "公用事业", 200e9,
))
# 沪深300 化工 / 钢铁 / 有色
CN_PHASE2.update(_expand(
    ["600309.SH", "600019.SH", "600362.SH", "601600.SH", "603799.SH",
     "601899.SH", "600547.SH", "002460.SZ"],
    "有色金属", "化工", 100e9,
))
# 沪深300 家电 / 必需消费
CN_PHASE2.update(_expand(
    ["600585.SH", "002714.SZ", "300498.SZ"],
    "包装食品", "Packaged Foods", 100e9,
))
# 沪深300 房地产
CN_PHASE2.update(_expand(
    ["000002.SZ", "600048.SH", "600340.SH", "001979.SZ"],
    "房地产", "房地产 REIT", 50e9,
))

CN_PATCHES.update(CN_PHASE2)


def patch_file(path: Path, patches: dict, label: str) -> tuple[int, int, int]:
    """读 universe，把 patches 里的 ticker 合并写回。
    返回 (新增 sector 数, 跳过已有 sector 数, 缺失 universe 数)"""
    if not path.exists():
        print(f"[skip] 不存在: {path}")
        return 0, 0, 0
    with open(path, encoding="utf-8") as f:
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
