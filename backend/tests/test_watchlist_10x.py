"""
watchlist_10x 单测
==================
覆盖 CRUD + screen_candidates + supertrend 管理。
所有测试用 monkeypatch 把 WATCHLIST_PATH 重定向到 tmp_path，避免污染真实数据。
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import watchlist_10x as wl  # noqa: E402


@pytest.fixture
def tmp_watchlist(tmp_path, monkeypatch):
    """每个测试用独立 tmp 文件，并 mock universe。"""
    fake_path = tmp_path / "watchlist_10x.json"
    monkeypatch.setattr(wl, "WATCHLIST_PATH", fake_path)

    # 一个固定的 mini universe
    fake_universe = [
        {"ticker": "NVDA", "name": "NVIDIA", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Semiconductors", "industry": "Semiconductors", "marketCap": 3.5e12},
        {"ticker": "AAOI", "name": "Applied Optoelectronics", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Communication Equipment", "industry": "Optical Networks",
         "marketCap": 1.2e9},
        {"ticker": "LITE", "name": "Lumentum", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "光通信/激光", "industry": None, "marketCap": 5e9},
        {"ticker": "AAPL", "name": "Apple", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Consumer Electronics", "industry": None, "marketCap": 3e12},
        {"ticker": "SOXL", "name": "Direxion Semi 3X", "market": "US", "exchange": "NYSEArca",
         "is_etf": True, "sector": "Semiconductors", "industry": None, "marketCap": 1e10},
        {"ticker": "600171.SH", "name": "上海贝岭", "market": "CN", "exchange": "SH",
         "is_etf": False, "sector": "半导体", "industry": "半导体", "marketCap": None},
    ]
    monkeypatch.setattr(wl, "load_universe", lambda markets=("US", "CN"): list(fake_universe))
    yield fake_path


# ── 持久化 ──────────────────────────────────────────────
def test_load_empty_returns_default(tmp_watchlist):
    data = wl.load_watchlist()
    assert data["version"] == 1
    assert data["items"] == []
    assert data["user_supertrends"] == []


def test_save_then_load_roundtrip(tmp_watchlist):
    wl.add_item("NVDA", strategy="growth", supertrend_id="semi", thesis="HBM 上游")
    data = wl.load_watchlist()
    assert len(data["items"]) == 1
    assert data["items"][0]["ticker"] == "NVDA"
    # 文件确实写出了
    assert tmp_watchlist.exists()
    with open(tmp_watchlist, "r", encoding="utf-8") as f:
        on_disk = json.load(f)
    assert on_disk["items"][0]["ticker"] == "NVDA"


# ── add_item ────────────────────────────────────────────
def test_add_item_basic(tmp_watchlist):
    item = wl.add_item("AAOI", strategy="growth", supertrend_id="optical",
                       bottleneck_layer=2, moat_score=4, thesis="800G 光模块")
    assert item["ticker"] == "AAOI"
    assert item["strategy"] == "growth"
    assert item["supertrend_id"] == "optical"
    assert item["bottleneck_layer"] == 2
    assert item["moat_score"] == 4
    assert item["thesis"] == "800G 光模块"
    assert item["added_at"]  # 自动填日期
    assert item["llm_thesis_cached_at"] is None


def test_add_item_uppercases_ticker(tmp_watchlist):
    item = wl.add_item("aaoi", strategy="growth", supertrend_id="optical")
    assert item["ticker"] == "AAOI"


def test_add_item_duplicate_raises(tmp_watchlist):
    wl.add_item("NVDA", supertrend_id="semi")
    with pytest.raises(ValueError, match="已在观察列表"):
        wl.add_item("NVDA", supertrend_id="semi")


def test_add_item_invalid_strategy_raises(tmp_watchlist):
    with pytest.raises(ValueError, match="strategy"):
        wl.add_item("NVDA", strategy="speculative", supertrend_id="semi")


def test_add_item_invalid_supertrend_raises(tmp_watchlist):
    with pytest.raises(ValueError, match="unknown supertrend_id"):
        wl.add_item("NVDA", supertrend_id="not_a_real_trend")


def test_add_item_empty_ticker_raises(tmp_watchlist):
    with pytest.raises(ValueError, match="ticker"):
        wl.add_item("   ", supertrend_id="semi")


# ── update_item ─────────────────────────────────────────
def test_update_item_partial(tmp_watchlist):
    wl.add_item("NVDA", supertrend_id="semi", thesis="原始")
    updated = wl.update_item("NVDA", thesis="新版本", moat_score=5)
    assert updated["thesis"] == "新版本"
    assert updated["moat_score"] == 5
    # 其他字段不变
    assert updated["supertrend_id"] == "semi"


def test_update_item_unknown_raises(tmp_watchlist):
    with pytest.raises(KeyError):
        wl.update_item("UNKNOWN", thesis="x")


def test_update_item_ignores_unknown_fields(tmp_watchlist):
    wl.add_item("NVDA", supertrend_id="semi")
    updated = wl.update_item("NVDA", thesis="ok", random_garbage="ignored")
    assert "random_garbage" not in updated


# ── remove_item ─────────────────────────────────────────
def test_remove_item(tmp_watchlist):
    wl.add_item("NVDA", supertrend_id="semi")
    assert wl.remove_item("NVDA") is True
    assert wl.list_items() == []


def test_remove_nonexistent_returns_false(tmp_watchlist):
    assert wl.remove_item("NOPE") is False


# ── supertrend ──────────────────────────────────────────
def test_list_supertrends_includes_builtin(tmp_watchlist):
    sts = wl.list_supertrends()
    ids = {s["id"] for s in sts}
    assert {"ai_compute", "semi", "optical", "datacenter"}.issubset(ids)
    # 内置标记
    assert all(s["source"] == "builtin" for s in sts if s["id"] in {"semi", "optical"})


def test_add_user_supertrend(tmp_watchlist):
    new = wl.add_supertrend("renewable", "新能源", "光伏/风电/储能")
    assert new["id"] == "renewable"
    sts = wl.list_supertrends()
    assert any(s["id"] == "renewable" and s["source"] == "user" for s in sts)


def test_add_supertrend_conflicts_with_builtin(tmp_watchlist):
    with pytest.raises(ValueError, match="与内置冲突"):
        wl.add_supertrend("semi", "重复", "")


def test_add_supertrend_duplicate_user(tmp_watchlist):
    wl.add_supertrend("renewable", "新能源", "")
    with pytest.raises(ValueError, match="已存在"):
        wl.add_supertrend("renewable", "新能源2", "")


# ── screen_candidates ───────────────────────────────────
def test_screen_by_semi(tmp_watchlist):
    out = wl.screen_candidates(["semi"])
    tickers = sorted(it["ticker"] for it in out)
    assert "NVDA" in tickers
    assert "600171.SH" in tickers
    # AAOI 主 sector 是 Communication Equipment（不命中 semi），industry 是 Optical Networks → optical
    assert "AAOI" not in tickers
    # Apple 不命中
    assert "AAPL" not in tickers


def test_screen_by_optical(tmp_watchlist):
    out = wl.screen_candidates(["optical"])
    tickers = sorted(it["ticker"] for it in out)
    # LITE: sector "光通信/激光" → optical
    assert "LITE" in tickers
    # AAOI: industry "Optical Networks" → optical（fallback 到 industry）
    assert "AAOI" in tickers


def test_screen_etf_excluded_by_default(tmp_watchlist):
    out = wl.screen_candidates(["semi"])
    assert "SOXL" not in [it["ticker"] for it in out]


def test_screen_include_etf(tmp_watchlist):
    out = wl.screen_candidates(["semi"], include_etf=True)
    assert "SOXL" in [it["ticker"] for it in out]


def test_screen_max_market_cap(tmp_watchlist):
    """max_market_cap_b=10 应只保留小市值；NVDA(3500B) 出局，AAOI(1.2B)/LITE(5B) 留"""
    out = wl.screen_candidates(["semi", "optical"], max_market_cap_b=10)
    tickers = [it["ticker"] for it in out]
    assert "NVDA" not in tickers
    assert "AAOI" in tickers
    assert "LITE" in tickers


def test_screen_excludes_in_watchlist(tmp_watchlist):
    wl.add_item("NVDA", supertrend_id="semi")
    out = wl.screen_candidates(["semi"])
    assert "NVDA" not in [it["ticker"] for it in out]


def test_screen_sorts_by_market_cap_asc(tmp_watchlist):
    """小市值优先（策略原则）"""
    out = wl.screen_candidates(["semi", "optical"])
    mcs = [it.get("marketCap") for it in out if it.get("marketCap") is not None]
    assert mcs == sorted(mcs)


def test_screen_returns_matched_supertrends(tmp_watchlist):
    out = wl.screen_candidates(["semi", "optical"])
    for it in out:
        assert "matched_supertrends" in it
        assert isinstance(it["matched_supertrends"], list)
        assert len(it["matched_supertrends"]) >= 1


def test_screen_market_cap_min(tmp_watchlist):
    """min_market_cap_b 排除超小市值"""
    out = wl.screen_candidates(["semi", "optical"], min_market_cap_b=4)
    tickers = [it["ticker"] for it in out]
    assert "AAOI" not in tickers   # 1.2B < 4B
    assert "LITE" in tickers       # 5B >= 4B
