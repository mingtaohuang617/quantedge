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


@pytest.fixture
def tmp_value_watchlist(tmp_path, monkeypatch):
    """价值型测试 fixture：universe 含 PE/PB/ROE/股息率/D/E 5 维字段。"""
    fake_path = tmp_path / "watchlist_10x.json"
    monkeypatch.setattr(wl, "WATCHLIST_PATH", fake_path)

    fake_universe = [
        # 高股息蓝筹：低 PE/PB + 高股息 + 中等 ROE
        {"ticker": "VZ", "name": "Verizon", "market": "US", "exchange": "NYSE",
         "is_etf": False, "sector": "Telecom Services—Diversified", "industry": "Telecom Services",
         "marketCap": 167e9, "pe": 9.2, "pb": 1.8,
         "dividend_yield": 0.066, "roe": 0.234, "debt_to_equity": 1.62},
        # 周期价值：低 PB + 中 ROE
        {"ticker": "BAC", "name": "Bank of America", "market": "US", "exchange": "NYSE",
         "is_etf": False, "sector": "Banks - Regional", "industry": "Banks",
         "marketCap": 280e9, "pe": 11.0, "pb": 1.0,
         "dividend_yield": 0.025, "roe": 0.092, "debt_to_equity": 0.85},
        # 消费稳健：高 ROE + 低股息（不算高股息蓝筹）
        {"ticker": "KO", "name": "Coca-Cola", "market": "US", "exchange": "NYSE",
         "is_etf": False, "sector": "Beverages—Non-Alcoholic", "industry": "Beverages",
         "marketCap": 270e9, "pe": 25.0, "pb": 9.0,
         "dividend_yield": 0.029, "roe": 0.47, "debt_to_equity": 1.85},
        # 成长股估值高：高 PE/PB 不应在价值筛选里
        {"ticker": "TSLA", "name": "Tesla", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Auto Manufacturers", "industry": "Auto",
         "marketCap": 800e9, "pe": 70.0, "pb": 12.0,
         "dividend_yield": 0.0, "roe": 0.18, "debt_to_equity": 0.10},
        # 缺所有字段：A 股贵州茅台（universe 没 enrich 财务）
        {"ticker": "600519.SH", "name": "贵州茅台", "market": "CN", "exchange": "SH",
         "is_etf": False, "sector": "白酒", "industry": "白酒",
         "marketCap": 2.5e12, "pe": None, "pb": None,
         "dividend_yield": None, "roe": None, "debt_to_equity": None},
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


# ── 用户自定义赛道关键词参与筛选（P0 #1 修复） ───────────
def test_add_user_supertrend_with_keywords(tmp_watchlist, monkeypatch):
    """用户赛道带 keywords_zh / keywords_en → screen_candidates 实际命中。"""
    extra = [
        {"ticker": "FSLR", "name": "First Solar", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Solar", "industry": "Solar", "marketCap": 3e10},
        {"ticker": "JKS", "name": "晶科能源", "market": "CN", "exchange": "SH",
         "is_etf": False, "sector": "光伏发电", "industry": None, "marketCap": 5e9},
    ]
    monkeypatch.setattr(wl, "load_universe", lambda markets=("US", "CN"): list(extra))

    wl.add_supertrend(
        "renewable", "新能源", "光伏/储能",
        keywords_zh=["光伏"], keywords_en=["Solar"],
    )

    out = wl.screen_candidates(["renewable"])
    tickers = {it["ticker"] for it in out}
    assert "FSLR" in tickers   # sector="Solar" 命中英文关键词
    assert "JKS" in tickers    # sector="光伏发电" 命中中文关键词
    # matched_supertrends 标记到正确赛道
    for it in out:
        assert "renewable" in it["matched_supertrends"]


def test_user_supertrend_keywords_apply_in_precise_mode(tmp_watchlist, monkeypatch):
    """precise=True 时用户赛道关键词依然生效（用户赛道无 broad 概念）。"""
    extra = [
        {"ticker": "FSLR", "name": "First Solar", "market": "US", "exchange": "NASDAQ",
         "is_etf": False, "sector": "Solar", "industry": "Solar", "marketCap": 3e10},
    ]
    monkeypatch.setattr(wl, "load_universe", lambda markets=("US", "CN"): list(extra))

    wl.add_supertrend(
        "renewable", "新能源", "",
        keywords_zh=[], keywords_en=["Solar"],
    )

    out = wl.screen_candidates(["renewable"], precise=True)
    tickers = {it["ticker"] for it in out}
    assert "FSLR" in tickers


def test_user_supertrend_no_keywords_inert(tmp_watchlist):
    """兼容老数据：用户赛道无关键词时合法存在，但 screen 永远 0 命中（不抛错）。"""
    wl.add_supertrend("empty_trend", "空赛道", "")
    out = wl.screen_candidates(["empty_trend"])
    assert out == []


# ── include_no_mcap 行为（P0 #2 修复） ───────────────────
def test_screen_keeps_no_mcap_by_default(tmp_watchlist):
    """新默认 True：设了市值上限时，缺 marketCap 的标的仍保留（如 600171.SH）。"""
    out = wl.screen_candidates(["semi"], max_market_cap_b=100)
    tickers = {it["ticker"] for it in out}
    assert "600171.SH" in tickers   # marketCap=None，新默认行为保留
    assert "NVDA" not in tickers    # 3500B > 100B，被市值上限剔除


def test_screen_drops_no_mcap_when_disabled(tmp_watchlist):
    """include_no_mcap=False：缺市值标的被排除（旧行为）。"""
    out = wl.screen_candidates(["semi"], max_market_cap_b=100, include_no_mcap=False)
    tickers = {it["ticker"] for it in out}
    assert "600171.SH" not in tickers


# ── 价值型 5 维筛选（PR-A v2.0） ─────────────────────────
def test_screen_max_pe_filter(tmp_value_watchlist):
    """max_pe=15 应保留 VZ(9.2)/BAC(11)，剔除 KO(25)/TSLA(70)；600519.SH 缺字段保留"""
    out = wl.screen_candidates([], max_pe=15)
    tickers = {it["ticker"] for it in out}
    assert "VZ" in tickers
    assert "BAC" in tickers
    assert "KO" not in tickers
    assert "TSLA" not in tickers
    assert "600519.SH" in tickers   # 缺 PE，默认保留


def test_screen_min_dividend_yield(tmp_value_watchlist):
    """min_dividend_yield=0.04 仅保留 VZ(6.6%)；其它都太低"""
    out = wl.screen_candidates([], min_dividend_yield=0.04)
    tickers = {it["ticker"] for it in out}
    assert "VZ" in tickers
    assert "BAC" not in tickers   # 2.5%
    assert "KO" not in tickers    # 2.9%
    assert "TSLA" not in tickers  # 0%
    assert "600519.SH" in tickers   # 缺字段保留


def test_screen_min_roe(tmp_value_watchlist):
    """min_roe=0.15 保留 KO(0.47)/VZ(0.234)/TSLA(0.18)；BAC(0.092) 出局"""
    out = wl.screen_candidates([], min_roe=0.15)
    tickers = {it["ticker"] for it in out}
    assert "KO" in tickers
    assert "VZ" in tickers
    assert "TSLA" in tickers
    assert "BAC" not in tickers


def test_screen_max_debt_to_equity(tmp_value_watchlist):
    """max_debt_to_equity=1.0 仅保留 BAC(0.85)/TSLA(0.10)"""
    out = wl.screen_candidates([], max_debt_to_equity=1.0)
    tickers = {it["ticker"] for it in out}
    assert "BAC" in tickers
    assert "TSLA" in tickers
    assert "VZ" not in tickers   # 1.62
    assert "KO" not in tickers   # 1.85


def test_screen_pe_excludes_negative_or_zero(tmp_value_watchlist):
    """PE<=0（亏损公司）即使 max_pe=15 也应剔除（业务规则）"""
    # 注入一个 PE=0 的项
    fake = [{"ticker": "LOSS", "name": "Loss Co", "market": "US", "exchange": "NASDAQ",
             "is_etf": False, "sector": "Tech", "industry": None,
             "marketCap": 1e9, "pe": -5.0, "pb": 0.5,
             "dividend_yield": 0.0, "roe": -0.1, "debt_to_equity": 0.5}]
    import unittest.mock as _m
    with _m.patch.object(wl, "load_universe", lambda markets=("US", "CN"): fake):
        out = wl.screen_candidates([], max_pe=15)
        assert "LOSS" not in {it["ticker"] for it in out}


def test_screen_no_fundamentals_strict(tmp_value_watchlist):
    """include_no_fundamentals=False：缺字段标的被剔除"""
    out = wl.screen_candidates([], max_pe=15, include_no_fundamentals=False)
    tickers = {it["ticker"] for it in out}
    assert "600519.SH" not in tickers   # 缺 PE，严格模式被剔


def test_screen_value_combo(tmp_value_watchlist):
    """高股息蓝筹组合：min_dividend_yield=0.04 + max_pe=15 + max_debt_to_equity=2.0"""
    out = wl.screen_candidates([], min_dividend_yield=0.04, max_pe=15,
                                max_debt_to_equity=2.0)
    tickers = {it["ticker"] for it in out}
    # VZ: 股息 6.6%、PE 9.2、D/E 1.62 — 全过
    assert "VZ" in tickers
    # 600519.SH 三个字段都缺，但默认保留
    assert "600519.SH" in tickers


def test_add_user_supertrend_with_strategy(tmp_watchlist):
    """add_supertrend 支持 strategy 参数；存到 user_supertrends 含 strategy 字段"""
    new = wl.add_supertrend(
        "reit", "REITs", "高股息地产基金", strategy="value",
        keywords_zh=["地产投资"],
    )
    assert new["strategy"] == "value"
    sts = wl.list_supertrends()
    reit = next(s for s in sts if s["id"] == "reit")
    assert reit["strategy"] == "value"


def test_add_user_supertrend_invalid_strategy(tmp_watchlist):
    """add_supertrend 非法 strategy 抛错"""
    with pytest.raises(ValueError, match="strategy must be"):
        wl.add_supertrend("xxx", "测试", "", strategy="speculative")


def test_user_supertrend_legacy_no_strategy(tmp_watchlist):
    """老 user_supertrends 没 strategy 字段时默认 growth（向后兼容）"""
    raw = {"version": 1, "user_supertrends": [
        {"id": "legacy", "name": "老赛道", "note": "", "keywords_zh": ["xxx"]},
    ], "items": []}
    wl.save_watchlist(raw)
    sts = wl.list_supertrends()
    legacy = next(s for s in sts if s["id"] == "legacy")
    assert legacy["strategy"] == "growth"
