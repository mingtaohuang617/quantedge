"""
value.industry_peers — 同行业对照标的查找 + 分位计算
=========================================================
给定 ticker，从 universe 池中找同 industry 的 top N 标的（按市值）作为 peers，
然后用 peers 的指标算分位数（用于护城河 / 估值评分时的"行业分位"）。

接口：
  find_peers(ticker, n=20) → list[dict] universe 元数据
  industry_pctile(value, peer_values) → 0-100 分位
"""
from __future__ import annotations

from universe import load_universe


def _normalize_industry(s: str | None) -> str:
    """归一化 industry 字符串用于匹配。"""
    if not s:
        return ""
    return s.strip().lower()


def find_peers(ticker: str, n: int = 20, markets=("US", "HK")) -> list[dict]:
    """
    在 universe 池中找与 ticker 同 industry 的 top n 标的（按 marketCap 降序）。
    自动排除 ticker 自身。
    """
    uni = load_universe(markets)
    # 先找 ticker 自身
    self_item = next((it for it in uni if it["ticker"].upper() == ticker.strip().upper()), None)
    if self_item is None:
        return []

    target_ind = _normalize_industry(self_item.get("industry") or self_item.get("sector"))
    if not target_ind:
        return []

    same = [
        it for it in uni
        if it["ticker"].upper() != ticker.strip().upper()
        and _normalize_industry(it.get("industry") or it.get("sector")) == target_ind
        and it.get("marketCap")
    ]
    same.sort(key=lambda x: x.get("marketCap") or 0, reverse=True)
    return same[:n]


def industry_pctile(value: float | None, peer_values: list[float | None], higher_is_better: bool = True) -> float | None:
    """
    把 value 在 peer_values 中的位置映射为 0-100 分位。
    higher_is_better=True 时 value 越大分位越高（如毛利率、ROE）。
    higher_is_better=False 时反过来（如 PE、负债率）。
    返回 None 当 value 或 peers 不足。
    """
    if value is None:
        return None
    clean = [v for v in peer_values if v is not None]
    if len(clean) < 3:
        return None
    n = len(clean)
    if higher_is_better:
        rank = sum(1 for v in clean if v < value) + 0.5 * sum(1 for v in clean if v == value)
    else:
        rank = sum(1 for v in clean if v > value) + 0.5 * sum(1 for v in clean if v == value)
    pct = (rank + 0.5) / n * 100
    return max(0.0, min(100.0, pct))
