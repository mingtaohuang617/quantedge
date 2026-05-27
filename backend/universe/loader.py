"""
universe.loader — 合并加载多市场 universe

数据流（避免再踩 PR #193 那个坑）：

  backend/universe/sync_*.py
    ├── 写 → backend/output/universe_*.json  (本地, .gitignore 排除)
    └── (手动) python backend/export_universe_to_frontend.py
        └── 写 → frontend/public/data/universe/universe_*.json  (slim 版, git track)
            ├── Vercel: vercel.json includeFiles 打进 lambda bundle
            └── Render: render.yaml buildCommand `cp` 到 backend/output/

也就是说，本文件读取的 backend/output/*.json 在：
  - 本地：用户跑 sync_*.py 直接生成
  - Render production：build 时从 frontend/public/data/universe/ 拷贝过来

如果在 Render 上 count=0 / exists=false，去检查 render.yaml 的 buildCommand
是否包含那一步 `cp ../frontend/public/data/universe/*.json output/`。
"""
from __future__ import annotations

import json
from pathlib import Path
from collections.abc import Iterable

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

US_PATH = OUTPUT_DIR / "universe_us.json"
CN_PATH = OUTPUT_DIR / "universe_cn.json"
HK_PATH = OUTPUT_DIR / "universe_hk.json"

_PATH_BY_MARKET = {
    "US": US_PATH,
    "CN": CN_PATH,
    "HK": HK_PATH,
}


def _load_one(path: Path) -> dict:
    """加载单个 universe 文件；不存在或损坏返回 {meta: {...}, items: []}。"""
    if not path.exists():
        return {"meta": {"market": path.stem.split("_")[-1].upper(), "synced_at": None, "count": 0}, "items": []}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"meta": {"market": path.stem.split("_")[-1].upper(), "synced_at": None, "count": 0, "error": "parse failed"}, "items": []}


def load_universe(markets: Iterable[str] = ("US", "HK", "CN")) -> list[dict]:
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
