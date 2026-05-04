"""
universe.loader — 合并加载多市场 universe
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

US_PATH = OUTPUT_DIR / "universe_us.json"
CN_PATH = OUTPUT_DIR / "universe_cn.json"

_PATH_BY_MARKET = {
    "US": US_PATH,
    "CN": CN_PATH,
}


def _load_one(path: Path) -> dict:
    """加载单个 universe 文件；不存在或损坏返回 {meta: {...}, items: []}。"""
    if not path.exists():
        return {"meta": {"market": path.stem.split("_")[-1].upper(), "synced_at": None, "count": 0}, "items": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"meta": {"market": path.stem.split("_")[-1].upper(), "synced_at": None, "count": 0, "error": "parse failed"}, "items": []}


def load_universe(markets: Iterable[str] = ("US", "CN")) -> list[dict]:
    """
    合并加载多市场 universe，返回 item 列表。

    每个 item 至少包含: ticker, name, market, exchange, sector, industry, marketCap (可能为 None)。
    """
    out: list[dict] = []
    for m in markets:
        path = _PATH_BY_MARKET.get(m.upper())
        if path is None:
            continue
        data = _load_one(path)
        out.extend(data.get("items", []))
    return out


def universe_stats() -> dict:
    """返回每个 market 的加载情况，给 /api/universe/stats 用。"""
    stats: dict[str, dict] = {}
    for market, path in _PATH_BY_MARKET.items():
        data = _load_one(path)
        meta = data.get("meta", {})
        stats[market] = {
            "count": len(data.get("items", [])),
            "synced_at": meta.get("synced_at"),
            "path": str(path),
            "exists": path.exists(),
        }
    return stats
