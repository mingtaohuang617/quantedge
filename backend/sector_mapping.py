"""
sector_mapping — 行业字符串 → 超级赛道（supertrend）归一化
============================================================

输入来源三类：
  1. tushare industry 字段（中文，如 "半导体" / "通信设备" / "新型电力"）
  2. yfinance sector/industry 字段（英文，如 "Semiconductors" / "Utilities - Regulated Electric"）
  3. config.py 里手工定义的中文复合分类（如 "半导体/AI" / "光通信/激光"）

输出：一组 supertrend ID（可能为空 set）。一个 sector 可命中多个赛道（如 "半导体/HBM" → {semi, ai_compute}）。

使用：
  >>> from sector_mapping import classify_sector
  >>> classify_sector("半导体/HBM")
  {'semi', 'ai_compute'}
  >>> classify_sector("通讯设备")               # 默认 broad
  {'optical'}
  >>> classify_sector("通讯设备", mode="strict") # 精严
  set()

设计：
  - 关键词分两层：
    * strict：明确赛道关键词（"光通信"、"硅光"、"AI"、"HBM"）
    * broad：strict + 含一些噪声但能扩大覆盖（"通讯设备"、"应用软件"）
  - 默认 broad（保持 v1 行为兼容），用户在前端可切到 strict 减噪音
"""
from __future__ import annotations


# 超级赛道定义。每个赛道的 keywords 分两层：
#   keywords_strict_*：核心命中词（精严模式仅用这些）
#   keywords_broad_*：扩展词（宽泛模式额外加）
SUPERTRENDS: dict[str, dict] = {
    "ai_compute": {
        "name": "AI 算力",
        "note": "AI 软硬件 / 加速器 / HBM / AI 应用",
        "keywords_strict_zh": [
            "AI", "HBM", "算力", "智能计算", "人工智能",
        ],
        "keywords_strict_en": [
            "Artificial Intelligence",
        ],
        # broad：软件 / IT 服务（AI 公司常被归到这些板块，但也含纯软件公司）
        "keywords_broad_zh": [
            "应用软件", "软件基础设施", "软件服务",
            "数码解决方案服务",
            "信息技术服务",
            "互联网内容与信息",
        ],
        "keywords_broad_en": [
            "Software - Application",
            "Software - Infrastructure",
            "Information Technology Services",
            "Internet Content",
        ],
    },
    "semi": {
        "name": "半导体",
        "note": "设计、制造、设备、材料、存储",
        "keywords_strict_zh": [
            "半导体", "存储", "MCU", "元器件", "NAND", "DRAM", "晶圆", "集成电路",
            "电子元件",
        ],
        "keywords_strict_en": ["Semiconductor", "Semiconductors", "Memory"],
        # semi 自带就比较精准，broad 为空（没有需要"扩展但有噪声"的词）
        "keywords_broad_zh": [],
        "keywords_broad_en": [],
    },
    "optical": {
        "name": "光通信",
        "note": "光模块、硅光、CPO、激光器、光纤",
        "keywords_strict_zh": [
            "光通信", "光模块", "硅光", "光纤", "激光",
        ],
        "keywords_strict_en": ["Optical", "Photonic", "Laser"],
        # broad：富途/tushare 把光通信归到上层"通讯设备"，加上后会带中兴/烽火等噪音
        "keywords_broad_zh": ["通讯设备", "通信设备"],
        "keywords_broad_en": ["Communication Equipment"],
    },
    "datacenter": {
        "name": "算力中心",
        "note": "数据中心 / 电力 / 公共事业",
        "keywords_strict_zh": [
            "数据中心", "新型电力", "火力发电", "水力发电",
        ],
        "keywords_strict_en": [
            "Data Center",
            "Power Producers",
        ],
        # broad：泛公用事业（含非数据中心配套的水电气公司）
        "keywords_broad_zh": ["公共事业"],
        "keywords_broad_en": [
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


def _kw_for_mode(spec: dict, mode: str) -> tuple[list[str], list[str]]:
    """根据 mode 返回 (中文关键词列表, 英文关键词列表)。"""
    zh = list(spec.get("keywords_strict_zh", []))
    en = list(spec.get("keywords_strict_en", []))
    if mode == "broad":
        zh += spec.get("keywords_broad_zh", [])
        en += spec.get("keywords_broad_en", [])
    return zh, en


def classify_sector(
    raw_sector: str | None,
    mode: str = "broad",
    extra_user_trends: list[dict] | None = None,
) -> set[str]:
    """
    把任意 sector/industry 字符串归类到 supertrend ID 集合。

    mode:
      - "strict": 仅用核心关键词，命中精准但范围小
      - "broad" (默认): strict + 扩展词，覆盖广但有噪音

    extra_user_trends: 用户自定义赛道列表，每项需含
      {id, keywords_zh: list[str], keywords_en: list[str]}。
      用户赛道关键词无 strict/broad 之分（用户加的本来就是想精确匹配），
      两种 mode 下都按"原样匹配"处理。

    None / 空字符串返回空 set。
    """
    if mode not in ("strict", "broad"):
        raise ValueError(f"mode must be 'strict' or 'broad', got {mode!r}")
    if not raw_sector:
        return set()
    s = str(raw_sector).strip()
    if not s:
        return set()
    s_lower = s.lower()
    matched: set[str] = set()

    for tid, spec in SUPERTRENDS.items():
        kws_zh, kws_en = _kw_for_mode(spec, mode)
        if any(kw in s for kw in kws_zh):
            matched.add(tid)
            continue
        if any(kw.lower() in s_lower for kw in kws_en):
            matched.add(tid)

    # 用户自定义赛道
    for ut in extra_user_trends or []:
        tid = ut.get("id")
        if not tid:
            continue
        kws_zh = ut.get("keywords_zh") or []
        kws_en = ut.get("keywords_en") or []
        if any(kw and kw in s for kw in kws_zh):
            matched.add(tid)
            continue
        if any(kw and kw.lower() in s_lower for kw in kws_en):
            matched.add(tid)

    return matched


def get_strict_keywords(supertrend_ids: list[str] | set[str]) -> list[str]:
    """
    返回给定 supertrend 集合的所有 strict 关键词（中文 + 英文，原大小写）。
    给 watchlist.screen_candidates 在 precise 模式下做"名称匹配"用 ——
    universe 池里的 sector 都是大类（"通讯设备"），strict 模式靠名称含细分关键词
    （"Optical"、"光纤"）来精筛纯种公司。
    """
    out: list[str] = []
    for tid in supertrend_ids:
        spec = SUPERTRENDS.get(tid)
        if not spec:
            continue
        out.extend(spec.get("keywords_strict_zh", []))
        out.extend(spec.get("keywords_strict_en", []))
    return out


def name_matches_strict(
    name: str | None,
    supertrend_ids: list[str] | set[str],
    extra_user_trends: list[dict] | None = None,
) -> bool:
    """名称含任意 strict 关键词 → True。中文直接 substring；英文 lower-case。

    extra_user_trends: 用户自定义赛道列表（仅匹配 id 在 supertrend_ids 内的）；
    其关键词无 strict/broad 之分，全部参与名称匹配。
    """
    if not name:
        return False
    n = str(name)
    n_lower = n.lower()

    builtin_kws = get_strict_keywords(supertrend_ids)

    user_kws: list[str] = []
    wanted = set(supertrend_ids)
    for ut in extra_user_trends or []:
        if ut.get("id") in wanted:
            user_kws.extend(ut.get("keywords_zh") or [])
            user_kws.extend(ut.get("keywords_en") or [])

    for kw in builtin_kws + user_kws:
        if not kw:
            continue
        # 中文（含 ASCII 大写如 "AI"、"HBM" 也走这个分支，原样匹配）
        if any(0x4e00 <= ord(c) <= 0x9fff for c in kw) or kw.isupper():
            if kw in n:
                return True
        else:
            if kw.lower() in n_lower:
                return True
    return False


def filter_by_supertrends(
    items: list[dict],
    supertrend_ids: list[str] | set[str],
    sector_field: str = "sector",
    industry_field: str = "industry",
    mode: str = "broad",
) -> list[dict]:
    """
    给定一批 universe item，按 supertrend ids 过滤（OR 关系）。
    sector 和 industry 字段都参与匹配（OR），任一命中即算命中。

    mode 透传给 classify_sector。
    """
    wanted = set(supertrend_ids)
    if not wanted:
        return list(items)
    out = []
    for it in items:
        matched = (
            classify_sector(it.get(sector_field), mode=mode)
            | classify_sector(it.get(industry_field), mode=mode)
        )
        if matched & wanted:
            out.append(it)
    return out
