"""
watchlist_10x — 10x 猎手观察列表业务模块
==========================================
持久化：backend/watchlist_10x.json
  {
    "version": 1,
    "user_supertrends": [...],      # 用户自定义赛道（与 sector_mapping.SUPERTRENDS 合并）
    "items": [...]                  # 已加入观察的标的
  }

Item schema:
  {
    "ticker": str,
    "added_at": "YYYY-MM-DD",
    "strategy": "growth" | "value",
    "supertrend_id": str,           # 必须存在于 list_supertrends() 返回的 id
    "bottleneck_layer": 1 | 2,      # 1=共识 / 2=深度认知
    "bottleneck_tag": str,
    "moat_score": int,              # 1-5
    "thesis": str,
    "target_price": float | None,
    "stop_loss": float | None,
    "tags": list[str],
    "llm_thesis_cached_at": str | None
  }
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Iterable

import sector_mapping as _sm
from universe import load_universe

WATCHLIST_PATH = Path(__file__).resolve().parent / "watchlist_10x.json"

ALLOWED_STRATEGIES = {"growth", "value"}


# ── 文件 IO ─────────────────────────────────────────────
def load_watchlist() -> dict:
    """加载 watchlist 文件；不存在则返回默认结构。"""
    if not WATCHLIST_PATH.exists():
        return {"version": 1, "user_supertrends": [], "items": []}
    try:
        with open(WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        # 容错：缺字段补默认
        data.setdefault("version", 1)
        data.setdefault("user_supertrends", [])
        data.setdefault("items", [])
        return data
    except Exception:
        return {"version": 1, "user_supertrends": [], "items": []}


def save_watchlist(data: dict) -> None:
    """原子写。"""
    WATCHLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = WATCHLIST_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(WATCHLIST_PATH)


# ── 赛道（supertrends）管理 ──────────────────────────────
def list_supertrends() -> list[dict]:
    """
    合并内置（来自 sector_mapping）和用户自定义赛道。
    每项 {id, name, note, strategy, source: 'builtin' | 'user'}

    strategy 字段：
      - builtin 由 sector_mapping.SUPERTRENDS[*]["strategy"] 决定（"growth"/"value"）
      - user 由 add_supertrend(strategy=...) 指定；老数据默认 "growth"
    """
    builtin = [
        {**meta, "source": "builtin"}
        for meta in _sm.list_supertrends_meta()
    ]
    user = [
        {**s, "source": "user", "strategy": s.get("strategy", "growth")}
        for s in load_watchlist().get("user_supertrends", [])
    ]
    # 用户赛道 id 与内置冲突时跳过用户的（不让覆盖内置语义）
    builtin_ids = {b["id"] for b in builtin}
    user = [u for u in user if u.get("id") not in builtin_ids]
    return builtin + user


def add_supertrend(
    supertrend_id: str,
    name: str,
    note: str = "",
    keywords_zh: list[str] | None = None,
    keywords_en: list[str] | None = None,
    strategy: str = "growth",
) -> dict:
    """新增用户自定义赛道。返回新增项。

    keywords_zh / keywords_en：参与 screen_candidates 时的 sector/industry/名称匹配。
    用户赛道关键词无 strict/broad 之分，两种 mode 下都生效。
    缺关键词的赛道仍然可以加，但筛选时永远命中 0 只股。

    strategy: "growth" | "value"，决定该赛道在前端按 tab 过滤时归属哪一边。
    """
    sid = supertrend_id.strip()
    if not sid:
        raise ValueError("supertrend_id 不能为空")
    if strategy not in ("growth", "value"):
        raise ValueError(f"strategy must be 'growth' or 'value', got {strategy!r}")
    builtin_ids = {m["id"] for m in _sm.list_supertrends_meta()}
    if sid in builtin_ids:
        raise ValueError(f"赛道 id '{sid}' 与内置冲突")
    data = load_watchlist()
    for s in data["user_supertrends"]:
        if s["id"] == sid:
            raise ValueError(f"赛道 id '{sid}' 已存在")
    new_item = {
        "id": sid,
        "name": name.strip() or sid,
        "note": note,
        "strategy": strategy,
        "keywords_zh": [k.strip() for k in (keywords_zh or []) if k and k.strip()],
        "keywords_en": [k.strip() for k in (keywords_en or []) if k and k.strip()],
    }
    data["user_supertrends"].append(new_item)
    save_watchlist(data)
    return new_item


# ── Item CRUD ───────────────────────────────────────────
_VALID_FIELDS = {
    "strategy", "supertrend_id", "bottleneck_layer", "bottleneck_tag",
    "moat_score", "thesis", "target_price", "stop_loss", "tags",
    "llm_thesis_cached_at",
}


def _validate_supertrend(sid: str | None) -> None:
    if sid is None:
        return
    valid_ids = {s["id"] for s in list_supertrends()}
    if sid not in valid_ids:
        raise ValueError(f"unknown supertrend_id: {sid}")


def _validate_strategy(s: str | None) -> None:
    if s is not None and s not in ALLOWED_STRATEGIES:
        raise ValueError(f"strategy must be one of {ALLOWED_STRATEGIES}")


def add_item(ticker: str, **fields) -> dict:
    """添加观察项。已存在则报错。"""
    tk = ticker.strip().upper()
    if not tk:
        raise ValueError("ticker 不能为空")
    _validate_strategy(fields.get("strategy"))
    _validate_supertrend(fields.get("supertrend_id"))

    data = load_watchlist()
    if any(it["ticker"] == tk for it in data["items"]):
        raise ValueError(f"{tk} 已在观察列表")

    item = {
        "ticker": tk,
        "added_at": date.today().isoformat(),
        "strategy": fields.get("strategy", "growth"),
        "supertrend_id": fields.get("supertrend_id"),
        "bottleneck_layer": fields.get("bottleneck_layer"),
        "bottleneck_tag": fields.get("bottleneck_tag", ""),
        "moat_score": fields.get("moat_score"),
        "thesis": fields.get("thesis", ""),
        "target_price": fields.get("target_price"),
        "stop_loss": fields.get("stop_loss"),
        "tags": list(fields.get("tags") or []),
        "llm_thesis_cached_at": None,
    }
    data["items"].append(item)
    save_watchlist(data)
    return item


def update_item(ticker: str, **fields) -> dict:
    """编辑观察项。返回更新后的 item。"""
    tk = ticker.strip().upper()
    _validate_strategy(fields.get("strategy"))
    _validate_supertrend(fields.get("supertrend_id"))

    data = load_watchlist()
    for it in data["items"]:
        if it["ticker"] == tk:
            for k, v in fields.items():
                if k in _VALID_FIELDS:
                    it[k] = v
            save_watchlist(data)
            return it
    raise KeyError(f"{tk} not found")


def remove_item(ticker: str) -> bool:
    """删除观察项。返回是否真的删了。"""
    tk = ticker.strip().upper()
    data = load_watchlist()
    n0 = len(data["items"])
    data["items"] = [it for it in data["items"] if it["ticker"] != tk]
    if len(data["items"]) < n0:
        save_watchlist(data)
        return True
    return False


def list_items() -> list[dict]:
    return load_watchlist().get("items", [])


# ── 候选筛选 ─────────────────────────────────────────────
def screen_candidates(
    supertrend_ids: Iterable[str],
    *,
    markets: Iterable[str] = ("US", "HK", "CN"),
    max_market_cap_b: float | None = None,   # billion (USD/RMB 视市场)
    min_market_cap_b: float | None = None,
    include_etf: bool = False,
    exclude_in_watchlist: bool = True,
    limit: int = 200,
    precise: bool = False,
    include_no_mcap: bool = True,
    # 价值型 5 维筛选（v2.0 新增）：
    max_pe: float | None = None,
    max_pb: float | None = None,
    min_roe: float | None = None,                # 0~1 小数（如 0.15 = 15%）
    min_dividend_yield: float | None = None,     # 0~1 小数（如 0.04 = 4%）
    max_debt_to_equity: float | None = None,     # 小数（如 1.5 = 1.5 倍）
    include_no_fundamentals: bool = True,
) -> list[dict]:
    """
    从 universe 池里按赛道 + 市值 + 价值 5 维过滤，返回候选股列表。

    precise=True 时使用 sector_mapping 的 strict 模式（仅核心关键词），
    候选范围窄但精度高；precise=False 默认 broad 模式（含扩展词），
    候选范围广但有噪音。

    include_no_mcap (默认 True)：marketCap 缺失的标的是否纳入。
      默认保留 —— 否则用户一旦设了 max/min 就会静默丢掉所有缺数据的标的
      （A 股池受影响最严重）。需要旧行为时显式传 False。

    价值型 5 维（max_pe / max_pb / min_roe / min_dividend_yield / max_debt_to_equity）：
      只在用户传非 None 时启用。每个独立判断（AND 关系）。
      include_no_fundamentals=True（默认）：缺该字段的标的视作"通过"，与 mcap 同模式
      避免 universe 未 enrich 时静默丢标的；明确 False 才严格剔除。

    用户自定义赛道：自动从 watchlist 文件读 user_supertrends 中带关键词的项，
    与 builtin 赛道并行参与匹配。

    返回 item: 包含 universe 原字段 + matched_supertrends（命中的赛道集合，list 形式）
    + match_reasons（dict[trend_id, list[{field, value, keywords}]]，
      诊断"为啥这只票算这个赛道"用，前端候选卡片展示）
    排序：market cap 升序（小市值优先 — 策略中"小市值卡位公司"原则）；缺市值的排最后。
    """
    wanted = set(supertrend_ids or [])
    universe = load_universe(markets)

    # 用户自定义赛道（仅取带关键词的，否则匹配不上反而拖慢循环）
    user_trends_all = load_watchlist().get("user_supertrends", [])
    user_trends = [
        ut for ut in user_trends_all
        if (ut.get("keywords_zh") or ut.get("keywords_en"))
    ]

    # 1) 行业过滤
    # broad 模式：sector/industry 命中赛道（含扩展词如"通讯设备"）
    # precise 模式：sector/industry strict 命中 OR 公司名含 strict 关键词
    #               — universe 里 sector 多是大类（"通讯设备"）没有"光通信"细分，
    #                 靠名称匹配捞出 IPGP / 长飞光纤 / Optical Cable 等纯种
    if wanted:
        filtered = []
        mode = "strict" if precise else "broad"
        for it in universe:
            sector_val = it.get("sector")
            industry_val = it.get("industry")
            name_val = it.get("name")

            sec_matched, sec_kw = _sm.classify_sector_with_reasons(
                sector_val, mode=mode, extra_user_trends=user_trends,
            )
            ind_matched, ind_kw = _sm.classify_sector_with_reasons(
                industry_val, mode=mode, extra_user_trends=user_trends,
            )
            sec_matched &= wanted
            ind_matched &= wanted

            # precise 模式 fallback：sec/ind 都不命中时再查名称（保持原有 OR 逻辑）
            name_reasons: dict[str, list[str]] = {}
            if precise and not (sec_matched or ind_matched):
                _, name_reasons = _sm.name_matches_strict_with_reasons(
                    name_val, wanted, extra_user_trends=user_trends,
                )

            matched_set = sec_matched | ind_matched | set(name_reasons.keys())
            if not matched_set:
                continue

            # 构建 match_reasons：trend_id → list of {field, value, keywords}
            reasons: dict[str, list[dict]] = {}
            for tid in sec_matched:
                reasons.setdefault(tid, []).append({
                    "field": "sector",
                    "value": sector_val,
                    "keywords": sec_kw.get(tid, []),
                })
            for tid in ind_matched:
                # A 股池 sector==industry 常见；避免重复展示
                if any(r["field"] == "sector" and r["value"] == industry_val
                       for r in reasons.get(tid, [])):
                    continue
                reasons.setdefault(tid, []).append({
                    "field": "industry",
                    "value": industry_val,
                    "keywords": ind_kw.get(tid, []),
                })
            for tid, kws in name_reasons.items():
                reasons.setdefault(tid, []).append({
                    "field": "name",
                    "value": name_val,
                    "keywords": kws,
                })

            it_out = dict(it)
            it_out["matched_supertrends"] = sorted(matched_set)
            it_out["match_reasons"] = reasons
            filtered.append(it_out)
    else:
        filtered = [
            dict(it, matched_supertrends=[], match_reasons={}) for it in universe
        ]

    # 2) ETF 过滤
    if not include_etf:
        filtered = [it for it in filtered if not it.get("is_etf")]

    # 3) 市值过滤
    def _mc_ok(mc):
        if mc is None:
            return include_no_mcap
        b = mc / 1e9
        if max_market_cap_b is not None and b > max_market_cap_b:
            return False
        if min_market_cap_b is not None and b < min_market_cap_b:
            return False
        return True

    filtered = [it for it in filtered if _mc_ok(it.get("marketCap"))]

    # 3.5) 价值型 5 维过滤（任一字段被设了上限/下限才启用）
    def _fund_ok(it):
        # 上限类（pe / pb / debt_to_equity）：缺字段时按 include_no_fundamentals 决定
        if max_pe is not None:
            v = it.get("pe")
            if v is None:
                if not include_no_fundamentals:
                    return False
            elif v > max_pe or v <= 0:  # PE<=0 公司亏损，价值型一律剔除
                return False
        if max_pb is not None:
            v = it.get("pb")
            if v is None:
                if not include_no_fundamentals:
                    return False
            elif v > max_pb or v <= 0:
                return False
        if max_debt_to_equity is not None:
            v = it.get("debt_to_equity")
            if v is None:
                if not include_no_fundamentals:
                    return False
            elif v > max_debt_to_equity:
                return False
        # 下限类（roe / dividend_yield）：缺字段时按 include_no_fundamentals
        if min_roe is not None:
            v = it.get("roe")
            if v is None:
                if not include_no_fundamentals:
                    return False
            elif v < min_roe:
                return False
        if min_dividend_yield is not None:
            v = it.get("dividend_yield")
            if v is None:
                if not include_no_fundamentals:
                    return False
            elif v < min_dividend_yield:
                return False
        return True

    if any(p is not None for p in (max_pe, max_pb, min_roe,
                                    min_dividend_yield, max_debt_to_equity)):
        filtered = [it for it in filtered if _fund_ok(it)]

    # 4) 排除已在 watchlist 的
    if exclude_in_watchlist:
        in_wl = {it["ticker"] for it in list_items()}
        filtered = [it for it in filtered if it["ticker"] not in in_wl]

    # 5) 排序：缺市值放最后；其余按市值升序
    def _key(it):
        mc = it.get("marketCap")
        return (mc is None, mc if mc is not None else 0)

    filtered.sort(key=_key)

    return filtered[:limit]
