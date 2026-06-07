"""
sector_gics — 行业字符串 → GICS 11 大类归一化
================================================
为「横截面分位」评分提供一致的同行业分组（跨美股/A股/港股）。

输入来源三类（都能吃）：
  1. data.js 现有 sector（美股，中文前缀式，如 "科技/Semiconductors" / "消费/必需品/Beverages"）
  2. yfinance .info sector/industry（A股/港股回补，英文，如 "Consumer Defensive" / "Banks - Diversified"）
  3. 主题/配置标签（如 "白酒/消费" / "航天/国防" / "半导体/HBM"）

输出：11 个 GICS 大类之一（中文名），无法判定 → "其他"。

用法：
  >>> classify_gics("科技/Semiconductors")
  '信息技术'
  >>> classify_gics("Consumer Defensive", "Beverages - Wineries & Distilleries")
  '必需消费'
  >>> classify_gics("恒生指数")          # 指数标签无行业信息
  '其他'
"""
from __future__ import annotations

# GICS 11 大类（中文名，与前端中文展示一致）+ 兜底
IT = "信息技术"
COMM = "通信服务"
DISC = "可选消费"
STAPLES = "必需消费"
HEALTH = "医疗保健"
FIN = "金融"
INDU = "工业"
ENERGY = "能源"
MAT = "材料"
UTIL = "公用事业"
RE = "房地产"
OTHER = "其他"

GICS_SECTORS = [IT, COMM, DISC, STAPLES, HEALTH, FIN, INDU, ENERGY, MAT, UTIL, RE]

# data.js 美股 sector 的中文一级前缀 → GICS（"消费" 需看二级，单独处理）
_CN_PREFIX = {
    "科技": IT,
    "通信服务": COMM,
    "医疗健康": HEALTH,
    "医疗": HEALTH,
    "公用事业": UTIL,
    "工业": INDU,
    "金融": FIN,
    "能源": ENERGY,
    "基础材料": MAT,
    "房地产": RE,
}

# yfinance 英文 sector（Yahoo 11 类）→ GICS
_YF_SECTOR = {
    "technology": IT,
    "financial services": FIN,
    "healthcare": HEALTH,
    "consumer cyclical": DISC,
    "consumer defensive": STAPLES,
    "communication services": COMM,
    "industrials": INDU,
    "energy": ENERGY,
    "basic materials": MAT,
    "utilities": UTIL,
    "real estate": RE,
}

# 关键词兜底（细类/主题）。按优先级从上到下，命中即返回。
# 每条 (GICS, [关键词])：关键词在「全文小写」里子串匹配（中英混排）。
_KEYWORDS: list[tuple[str, list[str]]] = [
    (IT, ["semiconductor", "software", "hardware", "computer", "electronic",
          "information technology", "memory", "optical", "photonic", "solar",
          "半导体", "存储", "软件", "芯片", "集成电路", "元器件", "光通信",
          "硅光", "电子", "消费电子", "光模块"]),
    (COMM, ["internet content", "telecom", "media", "entertainment",
            "advertising", "gaming", "interactive", "publishing", "social",
            "传媒", "游戏", "广告", "电信", "社交", "互联网内容"]),
    (HEALTH, ["drug", "pharma", "biotech", "medical", "health", "diagnostic",
              "life sciences", "医疗", "医药", "生物", "制药"]),
    (FIN, ["bank", "insurance", "financial", "capital markets", "asset management",
           "credit services", "exchange", "brokerage",
           "银行", "保险", "证券", "金融", "券商"]),
    # 注：不放裸"能源"——会误吞"新能源(动力电池/光伏)"，那些属工业/可选消费。
    # 美股"能源/X"由中文前缀处理；英文 energy/oil/gas 足够覆盖 yfinance。
    (ENERGY, ["oil", "gas", "coal", "petroleum", "energy",
              "石油", "天然气", "煤炭", "油气", "炼油"]),
    (UTIL, ["utilit", "electric", "power producer", "water",
            "电力", "公用事业", "燃气", "供水"]),
    (RE, ["real estate", "reit", "property",
          "房地产", "地产", "物业"]),
    (MAT, ["chemical", "metal", "mining", "steel", "material", "aluminum", "copper",
           "化工", "有色", "钢", "材料", "金属", "采矿"]),
    (INDU, ["aerospace", "defense", "machinery", "industrial", "railroad",
            "trucking", "construction", "airline", "logistics", "distribution",
            "conglomerate", "manufactur",
            "航天", "国防", "机械", "工业", "交运", "铁路", "建筑", "物流",
            "新能源", "动力电池"]),
    (STAPLES, ["beverage", "food", "grocery", "household", "tobacco",
               "confection", "staple", "discount store", "packaged",
               "白酒", "食品", "饮料", "必需"]),
    (DISC, ["retail", "apparel", "auto", "restaurant", "travel", "lodging",
            "hotel", "luxury", "leisure", "e-commerce", "internet retail",
            "汽车", "家电", "电商", "零售", "餐饮", "旅游", "可选", "周期"]),
]


def classify_gics(*texts: str | None) -> str:
    """把一组行业字符串归一到 GICS 11 大类（中文名），无法判定返回 "其他"。

    判定顺序：① data.js 中文一级前缀 ② yfinance 英文 sector 精确名 ③ 关键词兜底。
    """
    parts = [str(t).strip() for t in texts if t]
    if not parts:
        return OTHER
    full = " / ".join(parts)
    low = full.lower()

    # ① 中文一级前缀（美股 data.js）。"消费" 需看二级。
    head = parts[0].split("/")[0].strip()
    if head in _CN_PREFIX:
        return _CN_PREFIX[head]
    if head == "消费" or "消费" in parts[0]:
        if "必需" in full:
            return STAPLES
        if "周期" in full:
            return DISC
        # 仅 "消费" 无二级 → 按关键词进一步判，落不到再 DISC
    # 银行/白酒/航天 等中文主题词直挂（前缀不在表里时）
    if head in ("银行",):
        return FIN
    if head in ("白酒",):
        return STAPLES
    if head in ("航天", "国防"):
        return INDU

    # ② yfinance 英文 sector 精确匹配
    for p in parts:
        key = p.lower().strip()
        if key in _YF_SECTOR:
            return _YF_SECTOR[key]

    # ③ 关键词兜底
    for gics, kws in _KEYWORDS:
        for kw in kws:
            if kw in low:
                return gics

    # "消费" 有前缀但没判出二级 → 默认可选消费
    if "消费" in full:
        return DISC
    return OTHER
