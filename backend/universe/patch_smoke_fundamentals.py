#!/usr/bin/env python3
"""
patch_smoke_fundamentals — 给 universe_*.json 手工补代表性价值股的财务字段
================================================================================

用途：
  真正的 `sync_us --enrich-fundamentals` 跑全市场被 Yahoo 严重限频（实测
  fill rate 0.1%），本脚本作为 smoke 数据补丁，让用户立刻能在前端看到价值
  型筛选的效果（PE/股息/ROE 实际过滤）。

数据来源：
  公开年报 + 主要财经站（finviz / yahoo finance / 雪球）2025-12 / 2026-01
  时点大致估算值，仅用于演示与筛选 demo。真实交易决策请人工核实。

覆盖（v3.0：28 → ~110）：
  - US ~50 只：银行 / 保险 / 能源 / 公用事业 / 电信 / 消费 / 医药 / 工业 / 化工
  - CN ~35 只：银行 / 保险 / 能源 / 电信 / 公用事业 / 白酒 / 食品 / 周期
  - HK ~25 只：银行 / 保险 / 能源 / 电信 / 公用事业 / 消费 / 地产
  - 含少量成长股对照（NVDA / TSLA / 腾讯 / 阿里 等），方便看 PE 筛选剔除

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

# ──────────────────────────────────────────────────────────────────
# US — 50 只
# ──────────────────────────────────────────────────────────────────
US_PATCHES = {
    # ── 高股息蓝筹：电信 ───────────────────────────────
    "VZ":   {"pe": 9.5,  "pb": 1.7, "dividend_yield": 0.066, "roe": 0.234, "debt_to_equity": 1.62,
             "sector": "Telecom Services—Diversified", "industry": "Telecom Services—Diversified", "marketCap": 167e9},
    "T":    {"pe": 11.0, "pb": 1.4, "dividend_yield": 0.055, "roe": 0.131, "debt_to_equity": 1.30,
             "sector": "Telecom Services—Diversified", "industry": "Telecom Services—Diversified", "marketCap": 122e9},
    "TMUS": {"pe": 24.0, "pb": 4.5, "dividend_yield": 0.014, "roe": 0.190, "debt_to_equity": 1.55,
             "sector": "Telecom Services—Diversified", "industry": "Telecom Services—Diversified", "marketCap": 270e9},
    # ── 高股息蓝筹：能源 ───────────────────────────────
    "XOM":  {"pe": 13.5, "pb": 1.95, "dividend_yield": 0.036, "roe": 0.160, "debt_to_equity": 0.25,
             "sector": "Oil & Gas Integrated", "industry": "Oil & Gas Integrated", "marketCap": 460e9},
    "CVX":  {"pe": 16.0, "pb": 1.60, "dividend_yield": 0.045, "roe": 0.108, "debt_to_equity": 0.16,
             "sector": "Oil & Gas Integrated", "industry": "Oil & Gas Integrated", "marketCap": 290e9},
    "COP":  {"pe": 13.0, "pb": 2.40, "dividend_yield": 0.024, "roe": 0.205, "debt_to_equity": 0.36,
             "sector": "Oil & Gas E&P", "industry": "Oil & Gas E&P", "marketCap": 130e9},
    "OXY":  {"pe": 15.0, "pb": 2.10, "dividend_yield": 0.018, "roe": 0.150, "debt_to_equity": 0.65,
             "sector": "Oil & Gas E&P", "industry": "Oil & Gas E&P", "marketCap": 50e9},
    # ── 高股息蓝筹：烟草 ───────────────────────────────
    # MO 净资产为负 → ROE/PB/D/E 失真留 null
    "MO":   {"pe": 9.2,  "pb": None, "dividend_yield": 0.075, "roe": None,  "debt_to_equity": None,
             "sector": "Tobacco", "industry": "Tobacco", "marketCap": 92e9},
    "PM":   {"pe": 22.0, "pb": None, "dividend_yield": 0.043, "roe": None,  "debt_to_equity": None,
             "sector": "Tobacco", "industry": "Tobacco", "marketCap": 200e9},
    # ── 高股息蓝筹：银行 ───────────────────────────────
    "BAC":  {"pe": 12.0, "pb": 1.10, "dividend_yield": 0.025, "roe": 0.095, "debt_to_equity": 0.85,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 280e9},
    "JPM":  {"pe": 12.5, "pb": 1.80, "dividend_yield": 0.024, "roe": 0.160, "debt_to_equity": 1.20,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 580e9},
    "WFC":  {"pe": 11.8, "pb": 1.30, "dividend_yield": 0.025, "roe": 0.120, "debt_to_equity": 1.00,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 200e9},
    "C":    {"pe": 9.5,  "pb": 0.65, "dividend_yield": 0.034, "roe": 0.080, "debt_to_equity": 1.50,
             "sector": "Banks—Diversified", "industry": "Banks—Diversified", "marketCap": 130e9},
    "USB":  {"pe": 11.0, "pb": 1.20, "dividend_yield": 0.046, "roe": 0.115, "debt_to_equity": 0.95,
             "sector": "Banks—Regional", "industry": "Banks—Regional", "marketCap": 70e9},
    "PNC":  {"pe": 12.5, "pb": 1.25, "dividend_yield": 0.039, "roe": 0.105, "debt_to_equity": 0.85,
             "sector": "Banks—Regional", "industry": "Banks—Regional", "marketCap": 75e9},
    "TFC":  {"pe": 11.0, "pb": 0.95, "dividend_yield": 0.052, "roe": 0.085, "debt_to_equity": 0.95,
             "sector": "Banks—Regional", "industry": "Banks—Regional", "marketCap": 55e9},
    "GS":   {"pe": 13.5, "pb": 1.50, "dividend_yield": 0.025, "roe": 0.115, "debt_to_equity": 2.80,
             "sector": "Capital Markets", "industry": "Capital Markets", "marketCap": 170e9},
    "MS":   {"pe": 15.0, "pb": 1.85, "dividend_yield": 0.030, "roe": 0.135, "debt_to_equity": 2.50,
             "sector": "Capital Markets", "industry": "Capital Markets", "marketCap": 165e9},
    # ── 高股息蓝筹：公用事业 ────────────────────────────
    "DUK":  {"pe": 19.5, "pb": 1.85, "dividend_yield": 0.038, "roe": 0.095, "debt_to_equity": 1.62,
             "sector": "Utilities—Regulated Electric", "industry": "Utilities—Regulated Electric", "marketCap": 90e9},
    "SO":   {"pe": 21.0, "pb": 2.35, "dividend_yield": 0.034, "roe": 0.115, "debt_to_equity": 1.75,
             "sector": "Utilities—Regulated Electric", "industry": "Utilities—Regulated Electric", "marketCap": 100e9},
    "AEP":  {"pe": 18.0, "pb": 2.05, "dividend_yield": 0.036, "roe": 0.115, "debt_to_equity": 1.65,
             "sector": "Utilities—Regulated Electric", "industry": "Utilities—Regulated Electric", "marketCap": 55e9},
    "NEE":  {"pe": 22.0, "pb": 3.00, "dividend_yield": 0.030, "roe": 0.140, "debt_to_equity": 1.40,
             "sector": "Utilities—Regulated Electric", "industry": "Utilities—Regulated Electric", "marketCap": 160e9},
    "EXC":  {"pe": 16.5, "pb": 1.75, "dividend_yield": 0.038, "roe": 0.105, "debt_to_equity": 1.50,
             "sector": "Utilities—Regulated Electric", "industry": "Utilities—Regulated Electric", "marketCap": 45e9},
    # ── 周期价值：保险 ─────────────────────────────────
    "MET":  {"pe": 10.5, "pb": 1.10, "dividend_yield": 0.035, "roe": 0.105, "debt_to_equity": 0.50,
             "sector": "Insurance—Life", "industry": "Insurance—Life", "marketCap": 55e9},
    "PRU":  {"pe": 9.5,  "pb": 0.95, "dividend_yield": 0.046, "roe": 0.100, "debt_to_equity": 0.55,
             "sector": "Insurance—Life", "industry": "Insurance—Life", "marketCap": 45e9},
    "AIG":  {"pe": 11.0, "pb": 1.05, "dividend_yield": 0.022, "roe": 0.095, "debt_to_equity": 0.40,
             "sector": "Insurance—Diversified", "industry": "Insurance—Diversified", "marketCap": 50e9},
    "AFL":  {"pe": 11.5, "pb": 1.95, "dividend_yield": 0.022, "roe": 0.175, "debt_to_equity": 0.25,
             "sector": "Insurance—Life", "industry": "Insurance—Life", "marketCap": 60e9},
    "ALL":  {"pe": 14.0, "pb": 2.10, "dividend_yield": 0.022, "roe": 0.155, "debt_to_equity": 0.35,
             "sector": "Insurance—Property & Casualty", "industry": "Insurance—Property & Casualty", "marketCap": 55e9},
    "TRV":  {"pe": 13.5, "pb": 1.95, "dividend_yield": 0.018, "roe": 0.165, "debt_to_equity": 0.30,
             "sector": "Insurance—Property & Casualty", "industry": "Insurance—Property & Casualty", "marketCap": 60e9},
    "MMC":  {"pe": 25.0, "pb": 7.50, "dividend_yield": 0.014, "roe": 0.310, "debt_to_equity": 1.20,
             "sector": "Insurance Brokers", "industry": "Insurance Brokers", "marketCap": 110e9},
    # ── 周期价值：化工 ─────────────────────────────────
    "DOW":  {"pe": 18.0, "pb": 1.30, "dividend_yield": 0.072, "roe": 0.075, "debt_to_equity": 0.85,
             "sector": "Chemicals", "industry": "Chemicals", "marketCap": 30e9},
    "LYB":  {"pe": 12.0, "pb": 1.40, "dividend_yield": 0.062, "roe": 0.125, "debt_to_equity": 0.95,
             "sector": "Chemicals", "industry": "Specialty Chemicals", "marketCap": 30e9},
    # ── 周期价值：钢铁 ─────────────────────────────────
    "NUE":  {"pe": 11.5, "pb": 1.65, "dividend_yield": 0.018, "roe": 0.155, "debt_to_equity": 0.30,
             "sector": "Steel", "industry": "Steel", "marketCap": 30e9},
    "STLD": {"pe": 10.5, "pb": 1.85, "dividend_yield": 0.016, "roe": 0.185, "debt_to_equity": 0.35,
             "sector": "Steel", "industry": "Steel", "marketCap": 20e9},
    # ── 周期价值：建材 ─────────────────────────────────
    "VMC":  {"pe": 30.0, "pb": 3.50, "dividend_yield": 0.008, "roe": 0.115, "debt_to_equity": 0.55,
             "sector": "Building Materials", "industry": "Building Materials", "marketCap": 35e9},
    "MLM":  {"pe": 28.0, "pb": 3.40, "dividend_yield": 0.007, "roe": 0.125, "debt_to_equity": 0.50,
             "sector": "Building Materials", "industry": "Building Materials", "marketCap": 35e9},
    # ── 消费稳健：饮料 ─────────────────────────────────
    "KO":   {"pe": 25.0, "pb": 9.5, "dividend_yield": 0.029, "roe": 0.470, "debt_to_equity": 1.85,
             "sector": "Beverages—Non-Alcoholic", "industry": "Beverages—Non-Alcoholic", "marketCap": 270e9},
    "PEP":  {"pe": 24.0, "pb": 11.5, "dividend_yield": 0.030, "roe": 0.460, "debt_to_equity": 1.98,
             "sector": "Beverages—Non-Alcoholic", "industry": "Beverages—Non-Alcoholic", "marketCap": 230e9},
    # ── 消费稳健：日用 ─────────────────────────────────
    "PG":   {"pe": 26.5, "pb": 8.0, "dividend_yield": 0.025, "roe": 0.300, "debt_to_equity": 0.62,
             "sector": "Household & Personal Products", "industry": "Household & Personal Products", "marketCap": 380e9},
    "CL":   {"pe": 28.0, "pb": 80.0, "dividend_yield": 0.022, "roe": 1.150, "debt_to_equity": 9.50,
             "sector": "Household & Personal Products", "industry": "Household & Personal Products", "marketCap": 75e9},
    "KMB":  {"pe": 20.0, "pb": 30.0, "dividend_yield": 0.035, "roe": 1.450, "debt_to_equity": 5.50,
             "sector": "Household & Personal Products", "industry": "Household & Personal Products", "marketCap": 45e9},
    # ── 消费稳健：食品 ─────────────────────────────────
    "WMT":  {"pe": 33.0, "pb": 7.5, "dividend_yield": 0.012, "roe": 0.225, "debt_to_equity": 0.85,
             "sector": "Discount Stores", "industry": "Discount Stores", "marketCap": 720e9},
    "COST": {"pe": 50.0, "pb": 15.0, "dividend_yield": 0.005, "roe": 0.305, "debt_to_equity": 0.50,
             "sector": "Discount Stores", "industry": "Discount Stores", "marketCap": 400e9},
    "KHC":  {"pe": 13.5, "pb": 0.80, "dividend_yield": 0.052, "roe": 0.055, "debt_to_equity": 0.50,
             "sector": "Packaged Foods", "industry": "Packaged Foods", "marketCap": 38e9},
    "GIS":  {"pe": 14.0, "pb": 4.50, "dividend_yield": 0.046, "roe": 0.315, "debt_to_equity": 1.20,
             "sector": "Packaged Foods", "industry": "Packaged Foods", "marketCap": 36e9},
    "K":    {"pe": 22.0, "pb": 8.5, "dividend_yield": 0.038, "roe": 0.385, "debt_to_equity": 2.20,
             "sector": "Packaged Foods", "industry": "Packaged Foods", "marketCap": 28e9},
    # ── 消费稳健：医药（防御性）────────────────────────
    "JNJ":  {"pe": 22.0, "pb": 5.5, "dividend_yield": 0.030, "roe": 0.260, "debt_to_equity": 0.50,
             "sector": "Drug Manufacturers—General", "industry": "Drug Manufacturers—General", "marketCap": 380e9},
    "PFE":  {"pe": 16.0, "pb": 1.95, "dividend_yield": 0.058, "roe": 0.115, "debt_to_equity": 0.65,
             "sector": "Drug Manufacturers—General", "industry": "Drug Manufacturers—General", "marketCap": 165e9},
    "MRK":  {"pe": 14.5, "pb": 6.5, "dividend_yield": 0.034, "roe": 0.405, "debt_to_equity": 0.85,
             "sector": "Drug Manufacturers—General", "industry": "Drug Manufacturers—General", "marketCap": 270e9},
    "ABBV": {"pe": 18.0, "pb": 25.0, "dividend_yield": 0.034, "roe": 0.910, "debt_to_equity": 4.20,
             "sector": "Drug Manufacturers—General", "industry": "Drug Manufacturers—General", "marketCap": 310e9},
    # ── 工业（PE 通常偏中等，部分高 ROE）──────────────
    "CAT":  {"pe": 16.5, "pb": 8.5, "dividend_yield": 0.018, "roe": 0.510, "debt_to_equity": 2.10,
             "sector": "Farm & Heavy Construction Machinery", "industry": "Farm & Heavy Construction Machinery", "marketCap": 180e9},
    "DE":   {"pe": 14.0, "pb": 5.5, "dividend_yield": 0.015, "roe": 0.395, "debt_to_equity": 2.00,
             "sector": "Farm & Heavy Construction Machinery", "industry": "Farm & Heavy Construction Machinery", "marketCap": 110e9},
    "UNP":  {"pe": 20.5, "pb": 7.0, "dividend_yield": 0.022, "roe": 0.340, "debt_to_equity": 1.65,
             "sector": "Railroads", "industry": "Railroads", "marketCap": 150e9},
    "HON":  {"pe": 21.0, "pb": 7.5, "dividend_yield": 0.020, "roe": 0.360, "debt_to_equity": 1.30,
             "sector": "Conglomerates", "industry": "Conglomerates", "marketCap": 145e9},
    # ── 成长股对照（不命中价值赛道，PE 高确认筛选会剔除）──
    "NVDA": {"pe": 65.0, "pb": 45.0, "dividend_yield": 0.0003, "roe": 1.15, "debt_to_equity": 0.18},
    "TSLA": {"pe": 70.0, "pb": 12.0, "dividend_yield": 0.0,   "roe": 0.180, "debt_to_equity": 0.10},
    "AAPL": {"pe": 34.0, "pb": 50.0, "dividend_yield": 0.004, "roe": 1.450, "debt_to_equity": 1.50},
    "MSFT": {"pe": 36.0, "pb": 11.0, "dividend_yield": 0.007, "roe": 0.355, "debt_to_equity": 0.30},
    "GOOG": {"pe": 24.0, "pb": 7.5,  "dividend_yield": 0.002, "roe": 0.295, "debt_to_equity": 0.10},
}

# ──────────────────────────────────────────────────────────────────
# CN — 35 只
# ──────────────────────────────────────────────────────────────────
CN_PATCHES = {
    # ── 高股息蓝筹：银行 ───────────────────────────────
    "600036.SH": {"pe": 6.5, "pb": 1.05, "dividend_yield": 0.058, "roe": 0.160, "debt_to_equity": 0.90},  # 招商银行
    "601398.SH": {"pe": 5.8, "pb": 0.55, "dividend_yield": 0.072, "roe": 0.105, "debt_to_equity": 1.10},  # 工商银行
    "601288.SH": {"pe": 5.5, "pb": 0.58, "dividend_yield": 0.070, "roe": 0.108, "debt_to_equity": 1.05},  # 农业银行
    "601988.SH": {"pe": 5.6, "pb": 0.56, "dividend_yield": 0.073, "roe": 0.100, "debt_to_equity": 1.15},  # 中国银行
    "601939.SH": {"pe": 5.7, "pb": 0.56, "dividend_yield": 0.074, "roe": 0.110, "debt_to_equity": 1.10},  # 建设银行
    "601166.SH": {"pe": 5.5, "pb": 0.55, "dividend_yield": 0.062, "roe": 0.115, "debt_to_equity": 1.05},  # 兴业银行
    "600000.SH": {"pe": 5.8, "pb": 0.42, "dividend_yield": 0.054, "roe": 0.080, "debt_to_equity": 1.10},  # 浦发银行
    # ── 高股息蓝筹：保险 ───────────────────────────────
    "601318.SH": {"pe": 8.5,  "pb": 0.95, "dividend_yield": 0.044, "roe": 0.115, "debt_to_equity": 0.55},  # 中国平安
    "601628.SH": {"pe": 9.0,  "pb": 1.45, "dividend_yield": 0.030, "roe": 0.110, "debt_to_equity": 0.60},  # 中国人寿
    "601601.SH": {"pe": 9.5,  "pb": 1.20, "dividend_yield": 0.044, "roe": 0.105, "debt_to_equity": 0.40},  # 中国太保
    # ── 高股息蓝筹：能源 ───────────────────────────────
    "600028.SH": {"pe": 7.2,  "pb": 0.65, "dividend_yield": 0.060, "roe": 0.080, "debt_to_equity": 0.45},  # 中国石化
    "601857.SH": {"pe": 6.8,  "pb": 0.70, "dividend_yield": 0.062, "roe": 0.095, "debt_to_equity": 0.30},  # 中国石油
    "600938.SH": {"pe": 8.0,  "pb": 1.65, "dividend_yield": 0.050, "roe": 0.205, "debt_to_equity": 0.20},  # 中海油（A 股）
    "601088.SH": {"pe": 10.5, "pb": 1.70, "dividend_yield": 0.080, "roe": 0.190, "debt_to_equity": 0.20},  # 中国神华
    "600188.SH": {"pe": 7.0,  "pb": 1.15, "dividend_yield": 0.072, "roe": 0.160, "debt_to_equity": 0.55},  # 兖矿能源
    # ── 高股息蓝筹：电信 ───────────────────────────────
    "600941.SH": {"pe": 11.0, "pb": 1.25, "dividend_yield": 0.052, "roe": 0.115, "debt_to_equity": 0.10},  # 中国移动
    "601728.SH": {"pe": 14.5, "pb": 1.30, "dividend_yield": 0.046, "roe": 0.090, "debt_to_equity": 0.15},  # 中国电信
    "600050.SH": {"pe": 16.0, "pb": 1.15, "dividend_yield": 0.026, "roe": 0.072, "debt_to_equity": 0.20},  # 中国联通
    # ── 高股息蓝筹：公用事业 ────────────────────────────
    "600900.SH": {"pe": 19.0, "pb": 2.85, "dividend_yield": 0.038, "roe": 0.150, "debt_to_equity": 1.10},  # 长江电力
    "600025.SH": {"pe": 14.0, "pb": 1.80, "dividend_yield": 0.045, "roe": 0.130, "debt_to_equity": 1.30},  # 华能水电
    # ── 周期价值：化工 / 钢铁 / 有色 / 建材 ─────────────
    "600309.SH": {"pe": 12.0, "pb": 2.10, "dividend_yield": 0.030, "roe": 0.175, "debt_to_equity": 0.75},  # 万华化学
    "600019.SH": {"pe": 9.5,  "pb": 0.70, "dividend_yield": 0.038, "roe": 0.075, "debt_to_equity": 0.55},  # 宝钢股份
    "601600.SH": {"pe": 11.0, "pb": 1.30, "dividend_yield": 0.035, "roe": 0.115, "debt_to_equity": 0.85},  # 中国铝业
    "600585.SH": {"pe": 12.5, "pb": 1.00, "dividend_yield": 0.042, "roe": 0.085, "debt_to_equity": 0.20},  # 海螺水泥
    # ── 消费稳健：白酒 ─────────────────────────────────
    "600519.SH": {"pe": 24.0, "pb": 8.5, "dividend_yield": 0.020, "roe": 0.340, "debt_to_equity": 0.08},  # 贵州茅台
    "000858.SZ": {"pe": 18.0, "pb": 4.5, "dividend_yield": 0.030, "roe": 0.250, "debt_to_equity": 0.12},  # 五粮液
    "002304.SZ": {"pe": 14.0, "pb": 2.80, "dividend_yield": 0.045, "roe": 0.205, "debt_to_equity": 0.10},  # 洋河股份
    "000568.SZ": {"pe": 22.0, "pb": 6.0, "dividend_yield": 0.025, "roe": 0.295, "debt_to_equity": 0.20},  # 泸州老窖
    # ── 消费稳健：食品 / 日用 ─────────────────────────
    "603288.SH": {"pe": 35.0, "pb": 9.0, "dividend_yield": 0.015, "roe": 0.270, "debt_to_equity": 0.18},  # 海天味业
    "600887.SH": {"pe": 16.0, "pb": 3.50, "dividend_yield": 0.045, "roe": 0.220, "debt_to_equity": 0.60},  # 伊利股份
    "000895.SZ": {"pe": 18.0, "pb": 4.50, "dividend_yield": 0.030, "roe": 0.255, "debt_to_equity": 0.30},  # 双汇发展
    # ── 消费稳健：家电 ─────────────────────────────────
    "000333.SZ": {"pe": 14.0, "pb": 3.10, "dividend_yield": 0.045, "roe": 0.225, "debt_to_equity": 0.45},  # 美的集团
    "000651.SZ": {"pe": 9.5,  "pb": 1.95, "dividend_yield": 0.075, "roe": 0.205, "debt_to_equity": 0.30},  # 格力电器
    # ── 成长股对照 ─────────────────────────────────────
    "300750.SZ": {"pe": 22.0, "pb": 4.5, "dividend_yield": 0.012, "roe": 0.230, "debt_to_equity": 0.65},  # 宁德时代
    "002594.SZ": {"pe": 25.0, "pb": 4.0, "dividend_yield": 0.010, "roe": 0.165, "debt_to_equity": 0.95},  # 比亚迪
}

# ──────────────────────────────────────────────────────────────────
# HK — 25 只
# ──────────────────────────────────────────────────────────────────
HK_PATCHES = {
    # ── 高股息蓝筹：银行 ───────────────────────────────
    "00005.HK": {"pe": 7.5,  "pb": 0.95, "dividend_yield": 0.066, "roe": 0.130, "debt_to_equity": 0.65},  # 汇丰控股
    "00011.HK": {"pe": 11.0, "pb": 1.05, "dividend_yield": 0.062, "roe": 0.095, "debt_to_equity": 0.55},  # 恒生银行
    "00939.HK": {"pe": 4.2,  "pb": 0.45, "dividend_yield": 0.075, "roe": 0.106, "debt_to_equity": 1.00},  # 建设银行 H
    "01398.HK": {"pe": 4.0,  "pb": 0.42, "dividend_yield": 0.078, "roe": 0.105, "debt_to_equity": 1.05},  # 工商银行 H
    "03988.HK": {"pe": 4.5,  "pb": 0.40, "dividend_yield": 0.075, "roe": 0.090, "debt_to_equity": 1.15},  # 中国银行 H
    "02388.HK": {"pe": 8.5,  "pb": 0.85, "dividend_yield": 0.075, "roe": 0.100, "debt_to_equity": 0.70},  # 中银香港
    "00388.HK": {"pe": 30.0, "pb": 8.5, "dividend_yield": 0.022, "roe": 0.255, "debt_to_equity": 0.50},   # 港交所
    # ── 高股息蓝筹：保险 ───────────────────────────────
    "01299.HK": {"pe": 15.5, "pb": 1.75, "dividend_yield": 0.024, "roe": 0.115, "debt_to_equity": 0.30},  # 友邦保险
    "02318.HK": {"pe": 7.5,  "pb": 0.85, "dividend_yield": 0.050, "roe": 0.118, "debt_to_equity": 0.55},  # 中国平安 H
    # ── 高股息蓝筹：能源 ───────────────────────────────
    "00857.HK": {"pe": 5.5,  "pb": 0.55, "dividend_yield": 0.075, "roe": 0.105, "debt_to_equity": 0.28},  # 中国石油 H
    "00386.HK": {"pe": 6.0,  "pb": 0.55, "dividend_yield": 0.070, "roe": 0.090, "debt_to_equity": 0.45},  # 中国石化 H
    "00883.HK": {"pe": 6.0,  "pb": 1.15, "dividend_yield": 0.082, "roe": 0.205, "debt_to_equity": 0.20},  # 中海油（H 股）
    # ── 高股息蓝筹：电信 ───────────────────────────────
    "00941.HK": {"pe": 10.0, "pb": 1.10, "dividend_yield": 0.062, "roe": 0.115, "debt_to_equity": 0.10},  # 中国移动 H
    "00762.HK": {"pe": 12.5, "pb": 0.95, "dividend_yield": 0.038, "roe": 0.072, "debt_to_equity": 0.20},  # 中国联通 H
    # ── 高股息蓝筹：公用事业 ────────────────────────────
    "00006.HK": {"pe": 10.5, "pb": 0.90, "dividend_yield": 0.052, "roe": 0.085, "debt_to_equity": 0.70},  # 电能实业
    "00002.HK": {"pe": 12.5, "pb": 1.55, "dividend_yield": 0.062, "roe": 0.125, "debt_to_equity": 1.20},  # 中电控股
    # ── 消费稳健 ───────────────────────────────────────
    "00322.HK": {"pe": 14.0, "pb": 2.20, "dividend_yield": 0.025, "roe": 0.155, "debt_to_equity": 0.20},  # 康师傅
    "02319.HK": {"pe": 15.0, "pb": 2.05, "dividend_yield": 0.038, "roe": 0.130, "debt_to_equity": 0.45},  # 蒙牛乳业
    "00291.HK": {"pe": 19.0, "pb": 2.55, "dividend_yield": 0.030, "roe": 0.135, "debt_to_equity": 0.20},  # 华润啤酒
    # ── 周期价值 / 地产 ─────────────────────────────────
    "01113.HK": {"pe": 11.0, "pb": 1.65, "dividend_yield": 0.038, "roe": 0.150, "debt_to_equity": 0.65},  # 长实集团
    "00016.HK": {"pe": 12.0, "pb": 0.55, "dividend_yield": 0.062, "roe": 0.045, "debt_to_equity": 0.20},  # 新鸿基地产
    # ── 成长股对照 ─────────────────────────────────────
    "00700.HK": {"pe": 22.0, "pb": 5.5, "dividend_yield": 0.008, "roe": 0.255, "debt_to_equity": 0.30},   # 腾讯
    "09988.HK": {"pe": 16.0, "pb": 2.20, "dividend_yield": 0.012, "roe": 0.140, "debt_to_equity": 0.20},  # 阿里巴巴
    "09618.HK": {"pe": 11.0, "pb": 2.00, "dividend_yield": 0.025, "roe": 0.180, "debt_to_equity": 0.35},  # 京东
    "01024.HK": {"pe": 32.0, "pb": 6.5, "dividend_yield": 0.0,   "roe": 0.205, "debt_to_equity": 0.55},   # 快手
}


def patch_file(path: Path, patches: dict[str, dict]) -> int:
    """读取 universe JSON，给指定 ticker 加财务字段，写回。返回实际 patch 的票数。"""
    if not path.exists():
        print(f"[skip] 不存在: {path}")
        return 0
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    by_ticker = {it["ticker"]: it for it in data.get("items", [])}
    n_ok = 0
    n_miss = 0
    for tk, fields in patches.items():
        it = by_ticker.get(tk)
        if not it:
            print(f"  [miss] {tk}（universe 里没找到）")
            n_miss += 1
            continue
        it.update(fields)
        n_ok += 1

    # 更新 meta
    meta = data.setdefault("meta", {})
    meta["fundamentals_smoke_count"] = n_ok
    meta["fundamentals_note"] = (
        "smoke patch v3 (~110 representative tickers across 3 markets); "
        "跑 sync_*.py --enrich-fundamentals 获取全市场（Yahoo 限频严重）"
    )

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)

    print(f"  [{path.stem}] patched {n_ok}, missing {n_miss}")
    return n_ok


def main():
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "frontend" / "public" / "data" / "universe"
    print(f"Target dir: {data_dir}\n")

    print("[US]")
    n_us = patch_file(data_dir / "universe_us.json", US_PATCHES)
    print(f"\n[CN]")
    n_cn = patch_file(data_dir / "universe_cn.json", CN_PATCHES)
    print(f"\n[HK]")
    n_hk = patch_file(data_dir / "universe_hk.json", HK_PATCHES)

    print(f"\n总计 patch {n_us + n_cn + n_hk} 只价值股 smoke 数据（US {n_us} / CN {n_cn} / HK {n_hk}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
