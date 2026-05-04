"""
sector_mapping — 行业字符串 → 超级赛道（supertrend）归一化
============================================================

输入来源三类：
  1. tushare industry 字段（中文，如 "半导体" / "通信设备" / "新型电力"）
  2. yfinance sector/industry 字段（英文，如 "Semiconductors" / "Utilities - Regulated Electric"）
  3. config.py 里手工定义的中文复合分类（如 "半导体/AI" / "光通信/激光"）

输出：一组 supertrend ID（可能为空 set）。一个 sector 可命中多个赛道（如 "半导体/HBM" → {semi, ai_compute}）。

使用：
  >>> from sector_mapping import classify_sector, list_supertrends_meta
  >>> classify_sector("半导体/HBM")
  {'semi', 'ai_compute'}
  >>> classify_sector("Semiconductors")
  {'semi'}

设计选择：
  - 关键词匹配（substring），不做精确匹配；未来加新行业不用改逻辑
  - conservative：宁缺勿滥（如 "通信设备" 不自动匹配 optical，避免噪音）
  - 用户在 10x 猎手里若想纳入边缘行业，可在前端手动调整 watchlist item 的 supertrend_id
"""
from __future__ import annotations


# 超级赛道定义（id → 元数据 + 命中关键词）
#
# 关键词覆盖三类来源：
#   1. 富途 OpenD owner_plate 中文板块名（"半导体"、"通讯设备"、"应用软件"、"数码解决方案服务" 等）
#   2. yfinance 英文 sector / industry（"Semiconductors"、"Software - Application" 等）
#   3. tushare 中文行业（"半导体"、"通信设备"、"软件服务"、"新型电力" 等）
#
# 注意：富途 / yfinance 没有"光通信" / "AI" / "数据中心" 这种细分板块，
# 所以 ai_compute / optical 命中的会比较宽（含一些非纯赛道公司），
# 需要用户在 watchlist item 编辑时手动校准 supertrend_id 与 thesis。
SUPERTRENDS: dict[str, dict] = {
    "ai_compute": {
        "name": "AI 算力",
        "note": "AI 软硬件 / 加速器 / HBM / AI 应用",
        # 直接关键词 + 软件/IT 服务（AI 公司常被归到这些板块）
        "keywords_zh": [
            "AI", "HBM", "算力", "智能计算", "人工智能",
            "应用软件", "软件基础设施", "软件服务",
            "数码解决方案服务",
            "信息技术服务",
            "互联网内容与信息",
        ],
        "keywords_en": [
            "Artificial Intelligence",
            "Software - Application",
            "Software - Infrastructure",
            "Information Technology Services",
            "Internet Content",
        ],
    },
    "semi": {
        "name": "半导体",
        "note": "设计、制造、设备、材料、存储",
        "keywords_zh": [
            "半导体", "存储", "MCU", "元器件", "NAND", "DRAM", "晶圆", "集成电路",
            "电子元件",  # tushare 类
        ],
        "keywords_en": ["Semiconductor", "Semiconductors", "Memory"],
    },
    "optical": {
        "name": "光通信",
        "note": "光模块、硅光、CPO、激光器、光纤、通讯设备",
        "keywords_zh": [
            "光通信", "光模块", "硅光", "光纤", "激光",
            "通讯设备", "通信设备",  # 富途/tushare 板块名（含光通信公司，但也含其他通信设备）
        ],
        "keywords_en": ["Optical", "Photonic", "Laser", "Communication Equipment"],
    },
    "datacenter": {
        "name": "算力中心",
        "note": "数据中心 / 电力 / 公共事业",
        "keywords_zh": [
            "数据中心", "新型电力", "火力发电", "水力发电",
            "公共事业",  # 富途板块
        ],
        "keywords_en": [
            "Data Center",
            "Power Producers",
            "Utilities - Regulated",
            "Utilities - Independent",
        ],
    },
}


def list_supertrends_meta() -> list[dict]:
    """返回前端用的赛道元数据列表。"""
    return [
        {"id": tid, "name": spec["name"], "note": spec.get("note", "")}
        for tid, spec in SUPERTRENDS.items()
    ]


def classify_sector(raw_sector: str | None) -> set[str]:
    """
    把任意 sector/industry 字符串归类到 supertrend ID 集合。
    None / 空字符串返回空 set。匹配规则：
      - 中文关键词：直接 substring 匹配（中文大小写无差异）
      - 英文关键词：lower-case substring 匹配
      - 一个 sector 可命中多个赛道
    """
    if not raw_sector:
        return set()
    s = str(raw_sector).strip()
    if not s:
        return set()
    s_lower = s.lower()
    matched: set[str] = set()

    for tid, spec in SUPERTRENDS.items():
        # 中文关键词
        if any(kw in s for kw in spec.get("keywords_zh", [])):
            matched.add(tid)
            continue
        # 英文关键词（lower-case）
        if any(kw.lower() in s_lower for kw in spec.get("keywords_en", [])):
            matched.add(tid)
    return matched


def filter_by_supertrends(
    items: list[dict],
    supertrend_ids: list[str] | set[str],
    sector_field: str = "sector",
    industry_field: str = "industry",
) -> list[dict]:
    """
    给定一批 universe item，按 supertrend ids 过滤（OR 关系）。
    sector 和 industry 字段都参与匹配（OR），任一命中即算命中。
    """
    wanted = set(supertrend_ids)
    if not wanted:
        return list(items)
    out = []
    for it in items:
        matched = (
            classify_sector(it.get(sector_field))
            | classify_sector(it.get(industry_field))
        )
        if matched & wanted:
            out.append(it)
    return out
