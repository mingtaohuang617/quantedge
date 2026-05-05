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
    每项 {id, name, note, source: 'builtin' | 'user'}
    """
    builtin = [
        {**meta, "source": "builtin"}
        for meta in _sm.list_supertrends_meta()
    ]
    user = [
        {**s, "source": "user"}
        for s in load_watchlist().get("user_supertrends", [])
    ]
    # 用户赛道 id 与内置冲突时跳过用户的（不让覆盖内置语义）
    builtin_ids = {b["id"] for b in builtin}
    user = [u for u in user if u.get("id") not in builtin_ids]
    return builtin + user


def add_supertrend(supertrend_id: str, name: str, note: str = "") -> dict:
    """新增用户自定义赛道。返回新增项。"""
    sid = supertrend_id.strip()
    if not sid:
        raise ValueError("supertrend_id 不能为空")
    builtin_ids = {m["id"] for m in _sm.list_supertrends_meta()}
    if sid in builtin_ids:
        raise ValueError(f"赛道 id '{sid}' 与内置冲突")
    data = load_watchlist()
    for s in data["user_supertrends"]:
        if s["id"] == sid:
            raise ValueError(f"赛道 id '{sid}' 已存在")
    new_item = {"id": sid, "name": name.strip() or sid, "note": note}
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
) -> list[dict]:
    """
    从 universe 池里按赛道 + 市值过滤，返回候选股列表。

    precise=True 时使用 sector_mapping 的 strict 模式（仅核心关键词），
    候选范围窄但精度高；precise=False 默认 broad 模式（含扩展词），
    候选范围广但有噪音。

    返回 item: 包含 universe 原字段 + matched_supertrends（命中的赛道集合，list 形式）
    排序：market cap 升序（小市值优先 — 策略中"小市值卡位公司"原则）；缺市值的排最后。
    """
    wanted = set(supertrend_ids or [])
    universe = load_universe(markets)

    # 1) 行业过滤
    # broad 模式：sector/industry 命中赛道（含扩展词如"通讯设备"）
    # precise 模式：sector/industry strict 命中 OR 公司名含 strict 关键词
    #               — universe 里 sector 多是大类（"通讯设备"）没有"光通信"细分，
    #                 靠名称匹配捞出 IPGP / 长飞光纤 / Optical Cable 等纯种
    if wanted:
        filtered = []
        for it in universe:
            if precise:
                sec_strict_match = (
                    _sm.classify_sector(it.get("sector"), mode="strict")
                    | _sm.classify_sector(it.get("industry"), mode="strict")
                ) & wanted
                name_match = _sm.name_matches_strict(it.get("name"), wanted)
                if not sec_strict_match and not name_match:
                    continue
                matched = sec_strict_match if sec_strict_match else set(wanted)
            else:
                matched = (
                    _sm.classify_sector(it.get("sector"), mode="broad")
                    | _sm.classify_sector(it.get("industry"), mode="broad")
                ) & wanted
                if not matched:
                    continue

            it_out = dict(it)
            it_out["matched_supertrends"] = sorted(matched)
            filtered.append(it_out)
    else:
        filtered = [dict(it, matched_supertrends=[]) for it in universe]

    # 2) ETF 过滤
    if not include_etf:
        filtered = [it for it in filtered if not it.get("is_etf")]

    # 3) 市值过滤
    def _mc_ok(mc):
        if mc is None:
            # 缺数据时 — 若设了 max/min 都 fail；不设则保留
            return max_market_cap_b is None and min_market_cap_b is None
        b = mc / 1e9
        if max_market_cap_b is not None and b > max_market_cap_b:
            return False
        if min_market_cap_b is not None and b < min_market_cap_b:
            return False
        return True

    filtered = [it for it in filtered if _mc_ok(it.get("marketCap"))]

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
