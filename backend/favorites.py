"""
favorites — 自选股（关注列表）持久化
=====================================
评分页的"星标"集合。与 watchlist_10x（含赛道/护城河/卡位等富元数据）解耦：
这里只是轻量的"我关注哪些标的"，供监控 / AI / 月度复盘读取用户关注池。

持久化：backend/favorites.json
  { "version": 1, "tickers": [...], "updated_at": "ISO-8601 | None" }

设计为"全量替换"：前端内存里本就持有完整 Set，整集 PUT → 幂等、无合并冲突。
tickers 只做去重 + 去空白 + 排序，**不改大小写**（必须与前端的 ticker key 精确往返，
否则星标在重载后对不上）。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

FAVORITES_PATH = Path(__file__).resolve().parent / "favorites.json"


def _normalize(tickers) -> list[str]:
    """去空白、丢空串、精确去重（保大小写）、排序。"""
    out: list[str] = []
    for t in tickers or []:
        tk = str(t).strip()
        if tk and tk not in out:
            out.append(tk)
    out.sort()
    return out


def load_favorites() -> dict:
    """加载自选股；文件不存在或损坏时返回空集合。"""
    if not FAVORITES_PATH.exists():
        return {"version": 1, "tickers": [], "updated_at": None}
    try:
        with open(FAVORITES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {
            "version": data.get("version", 1),
            "tickers": _normalize(data.get("tickers", [])),
            "updated_at": data.get("updated_at"),
        }
    except Exception:
        return {"version": 1, "tickers": [], "updated_at": None}


def save_favorites(tickers) -> dict:
    """全量替换并原子写，返回落盘后的规范化结构。"""
    data = {
        "version": 1,
        "tickers": _normalize(tickers),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    FAVORITES_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = FAVORITES_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(FAVORITES_PATH)
    return data
