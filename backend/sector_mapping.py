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
# strategy: "growth" | "value"，决定前端按 tab 过滤
SUPERTRENDS: dict[str, dict] = {
    "ai_compute": {
        "name": "AI 算力",
        "strategy": "growth",
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
        "strategy": "growth",
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
        "strategy": "growth",
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
        "strategy": "growth",
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
    # ── 价值型 SUPERTRENDS（v2.0 新增）──────────────────────
    # 价值型选龙头 / 高股息 / 稳健消费，与成长型小市值卡位风格相反
    "value_div": {
        "name": "高股息蓝筹",
        "strategy": "value",
        "note": "公用事业 / 银行龙头 / 能源 / 电信（股息率 > 4%）",
        "keywords_strict_zh": [
            "电信运营", "石油", "天然气", "煤炭",
        ],
        "keywords_strict_en": [
            "Banks—Diversified", "Oil & Gas Integrated",
            "Telecom Services", "Utilities—Regulated Electric",
            "Utilities - Regulated Gas",
        ],
        # broad: 复用现有 datacenter 的公共事业关键词覆盖（命中也无所谓，价值/成长前端按 tab 过滤）
        "keywords_broad_zh": ["公共事业"],
        "keywords_broad_en": ["Utilities - Diversified"],
    },
    "value_cyclical": {
        "name": "周期价值",
        "strategy": "value",
        "note": "银行 / 保险 / 化工 / 钢铁（低 PB 入场）",
        "keywords_strict_zh": [
            "银行", "保险", "化工", "钢铁", "有色金属", "建材",
        ],
        "keywords_strict_en": [
            "Banks - Regional", "Banks—Regional",
            "Insurance—Property & Casualty", "Insurance—Life",
            "Chemicals", "Specialty Chemicals",
            "Steel", "Aluminum",
            "Building Materials",
        ],
        "keywords_broad_zh": [],
        "keywords_broad_en": [],
    },
    "value_consumer": {
        "name": "消费稳健",
        "strategy": "value",
        "note": "食品饮料 / 必需消费（穿越周期 ROE）",
        "keywords_strict_zh": [
            "食品", "饮料", "白酒", "乳制品", "调味品",
        ],
        "keywords_strict_en": [
            "Beverages—Non-Alcoholic", "Beverages - Non-Alcoholic",
            "Beverages—Wineries & Distilleries",
            "Packaged Foods", "Confectioners",
            "Tobacco",
            "Household & Personal Products",
        ],
        "keywords_broad_zh": [],
        "keywords_broad_en": [],
    },
}


def list_supertrends_meta(strategy: str | None = None) -> list[dict]:
    """返回前端用的赛道元数据列表。

    strategy 过滤：
      - None（默认）：返回全部赛道
      - "growth" / "value"：仅返回该策略的赛道
    老数据没有 strategy 字段时按 "growth" 处理（向后兼容）。
    """
    out = []
    for tid, spec in SUPERTRENDS.items():
        spec_strategy = spec.get("strategy", "growth")
        if strategy is not None and spec_strategy != strategy:
            continue
        out.append({
            "id": tid,
            "name": spec["name"],
            "note": spec.get("note", ""),
            "strategy": spec_strategy,
        })
    return out


def _kw_for_mode(spec: dict, mode: str) -> tuple[list[str], list[str]]:
    """根据 mode 返回 (中文关键词列表, 英文关键词列表)。"""
    zh = list(spec.get("keywords_strict_zh", []))
    en = list(spec.get("keywords_strict_en", []))
    if mode == "broad":
        zh += spec.get("keywords_broad_zh", [])
        en += spec.get("keywords_broad_en", [])
    return zh, en


def classify_sector_with_reasons(
    raw_sector: str | None,
    mode: str = "broad",
    extra_user_trends: list[dict] | None = None,
) -> tuple[set[str], dict[str, list[str]]]:
    """同 classify_sector，额外返回每个命中赛道触发的关键词列表。

    返回 (matched_set, reasons)；reasons[trend_id] = [kw1, kw2, ...] 按出现顺序去重。
    给前端"为啥这只票算半导体了"展示用。

    与 classify_sector 行为完全等价（matched 部分），只是不 short-circuit ——
    会遍历完所有关键词收集 reasons。性能差异可忽略（每 trend ≤ 10 关键词）。
    """
    if mode not in ("strict", "broad"):
        raise ValueError(f"mode must be 'strict' or 'broad', got {mode!r}")
    matched: set[str] = set()
    reasons: dict[str, list[str]] = {}
    if not raw_sector:
        return matched, reasons
    s = str(raw_sector).strip()
    if not s:
        return matched, reasons
    s_lower = s.lower()

    def _collect(tid: str, kws_zh: list[str], kws_en: list[str]) -> None:
        hits: list[str] = []
        for kw in kws_zh:
            if kw and kw in s and kw not in hits:
                hits.append(kw)
        for kw in kws_en:
            if kw and kw.lower() in s_lower and kw not in hits:
                hits.append(kw)
        if hits:
            matched.add(tid)
            reasons.setdefault(tid, []).extend(hits)

    for tid, spec in SUPERTRENDS.items():
        kws_zh, kws_en = _kw_for_mode(spec, mode)
        _collect(tid, kws_zh, kws_en)

    # 用户自定义赛道
    for ut in extra_user_trends or []:
        tid = ut.get("id")
        if not tid:
            continue
        _collect(tid, ut.get("keywords_zh") or [], ut.get("keywords_en") or [])

    return matched, reasons


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

    需要命中关键词诊断时用 classify_sector_with_reasons。
    """
    matched, _ = classify_sector_with_reasons(raw_sector, mode, extra_user_trends)
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


def name_matches_strict_with_reasons(
    name: str | None,
    supertrend_ids: list[str] | set[str],
    extra_user_trends: list[dict] | None = None,
) -> tuple[bool, dict[str, list[str]]]:
    """同 name_matches_strict，但返回 (是否命中, 各赛道命中的关键词)。

    reasons[trend_id] = [kw1, kw2, ...]（按 strict_zh + strict_en 顺序去重）。
    用户赛道按其 keywords_zh + keywords_en 收集。
    """
    reasons: dict[str, list[str]] = {}
    if not name:
        return False, reasons
    n = str(name)
    n_lower = n.lower()
    wanted = set(supertrend_ids)

    def _kw_hits(n_str: str, n_lower_str: str, kws: list[str]) -> list[str]:
        hits: list[str] = []
        for kw in kws:
            if not kw:
                continue
            # 中文（含 ASCII 大写如 "AI"、"HBM" 也走这个分支，原样匹配）
            if any(0x4e00 <= ord(c) <= 0x9fff for c in kw) or kw.isupper():
                if kw in n_str and kw not in hits:
                    hits.append(kw)
            elif kw.lower() in n_lower_str and kw not in hits:
                hits.append(kw)
        return hits

    # builtin 按 trend 分组收集
    for tid in wanted:
        spec = SUPERTRENDS.get(tid)
        if not spec:
            continue
        kws = list(spec.get("keywords_strict_zh", [])) + list(spec.get("keywords_strict_en", []))
        hits = _kw_hits(n, n_lower, kws)
        if hits:
            reasons[tid] = hits

    # user trend 关键词
    for ut in extra_user_trends or []:
        tid = ut.get("id")
        if tid not in wanted:
            continue
        kws = list(ut.get("keywords_zh") or []) + list(ut.get("keywords_en") or [])
        hits = _kw_hits(n, n_lower, kws)
        if hits:
            reasons.setdefault(tid, [])
            for kw in hits:
                if kw not in reasons[tid]:
                    reasons[tid].append(kw)

    return bool(reasons), reasons


def name_matches_strict(
    name: str | None,
    supertrend_ids: list[str] | set[str],
    extra_user_trends: list[dict] | None = None,
) -> bool:
    """名称含任意 strict 关键词 → True。中文直接 substring；英文 lower-case。

    extra_user_trends: 用户自定义赛道列表（仅匹配 id 在 supertrend_ids 内的）；
    其关键词无 strict/broad 之分，全部参与名称匹配。

    需要命中关键词诊断时用 name_matches_strict_with_reasons。
    """
    ok, _ = name_matches_strict_with_reasons(name, supertrend_ids, extra_user_trends)
    return ok


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
