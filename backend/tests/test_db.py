"""db 模块测试 — 跨源覆盖优先级、增量同步水位、LLM 缓存。

零外部依赖（不连远程），用临时 sqlite 文件。
"""
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """每个测试用独立 db 文件，避免与生产 backend/data/quantedge.db 干扰。"""
    import db as db_mod
    # 重定向 db 路径到临时目录 + 清掉线程本地连接
    monkeypatch.setattr(db_mod, "DB_DIR", tmp_path)
    monkeypatch.setattr(db_mod, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_local", type(db_mod._local)())
    db_mod.init_db()
    return db_mod


# ── normalize_ticker ──────────────────────────────────────
def test_normalize_ticker_us_unchanged(fresh_db):
    assert fresh_db.normalize_ticker({"yf_symbol": "NVDA", "market": "US"}) == "NVDA"


def test_normalize_ticker_hk_pads_to_5(fresh_db):
    """yfinance 4 位港股 → DB 5 位"""
    assert fresh_db.normalize_ticker({"yf_symbol": "0700.HK", "market": "HK"}) == "00700.HK"
    assert fresh_db.normalize_ticker({"yf_symbol": "5.HK", "market": "HK"}) == "00005.HK"


def test_normalize_ticker_explicit_wins(fresh_db):
    """显式 ticker 字段优先于自动推导"""
    cfg = {"ticker": "00700.HK", "yf_symbol": "0700.HK", "market": "HK"}
    assert fresh_db.normalize_ticker(cfg) == "00700.HK"


def test_normalize_ticker_a_share(fresh_db):
    assert fresh_db.normalize_ticker({"yf_symbol": "600519.SS", "market": "SH"}) == "600519.SS"


# ── upsert_bars 跨源优先级 ────────────────────────────────
# ── 数据 sanity (新加防御) ────────────────────────────────
def test_upsert_bars_rejects_negative_close(fresh_db):
    """yfinance dividend-adjusted close 偶尔产生负值 — 必须拒绝"""
    rows = [
        {"trade_date": "2026-01-02", "close": 100.0},
        {"trade_date": "2026-01-03", "close": -50.5},  # 异常负值
        {"trade_date": "2026-01-04", "close": 102.0},
    ]
    fresh_db.upsert_bars("TEST", rows, "yfinance")
    bars = fresh_db.get_bars("TEST")
    assert len(bars) == 2  # 负值 row 被过滤
    assert all(b["close"] > 0 for b in bars)


def test_upsert_bars_rejects_zero_close(fresh_db):
    rows = [{"trade_date": "2026-01-02", "close": 0.0}]
    fresh_db.upsert_bars("TEST", rows, "yfinance")
    assert fresh_db.get_bars("TEST") == []


def test_upsert_bars_rejects_nan_close(fresh_db):
    rows = [{"trade_date": "2026-01-02", "close": float("nan")}]
    fresh_db.upsert_bars("TEST", rows, "yfinance")
    assert fresh_db.get_bars("TEST") == []


def test_upsert_bars_rejects_inf_close(fresh_db):
    rows = [{"trade_date": "2026-01-02", "close": float("inf")}]
    fresh_db.upsert_bars("TEST", rows, "yfinance")
    assert fresh_db.get_bars("TEST") == []


def test_upsert_bars_all_insane_returns_zero(fresh_db):
    """全部 row 都异常时返回 0，不应抛异常"""
    rows = [
        {"trade_date": "2026-01-02", "close": -1.0},
        {"trade_date": "2026-01-03", "close": 0.0},
    ]
    n = fresh_db.upsert_bars("TEST", rows, "yfinance")
    assert n == 0
    assert fresh_db.get_bars("TEST") == []


def test_is_sane_bar_helper(fresh_db):
    """直接测 helper（保证与 upsert 一致）"""
    assert fresh_db._is_sane_bar({"close": 100.0}) is True
    assert fresh_db._is_sane_bar({"close": 0.01}) is True
    assert fresh_db._is_sane_bar({"close": 0.0}) is False
    assert fresh_db._is_sane_bar({"close": -1.0}) is False
    assert fresh_db._is_sane_bar({"close": float("nan")}) is False
    assert fresh_db._is_sane_bar({"close": float("inf")}) is False
    assert fresh_db._is_sane_bar({"close": None}) is False
    assert fresh_db._is_sane_bar({}) is False
    assert fresh_db._is_sane_bar({"close": "abc"}) is False  # 非数字字符串


def test_upsert_bars_inserts_new(fresh_db):
    rows = [
        {"trade_date": "2026-01-02", "close": 100.0, "open": 99, "high": 101, "low": 98},
        {"trade_date": "2026-01-03", "close": 102.0, "open": 100, "high": 103, "low": 99},
    ]
    n = fresh_db.upsert_bars("NVDA", rows, "yfinance")
    assert n == 2
    bars = fresh_db.get_bars("NVDA")
    assert len(bars) == 2
    assert bars[0]["close"] == 100.0
    assert bars[1]["close"] == 102.0
    assert all(b["source"] == "yfinance" for b in bars)


def test_upsert_bars_higher_priority_overrides(fresh_db):
    """tushare(4) > yfinance(1) — 同一日 tushare 来后应覆盖 yfinance"""
    fresh_db.upsert_bars("NVDA", [
        {"trade_date": "2026-01-02", "close": 100.0}
    ], "yfinance")
    fresh_db.upsert_bars("NVDA", [
        {"trade_date": "2026-01-02", "close": 99.5}  # tushare 来更准的值
    ], "tushare")
    bars = fresh_db.get_bars("NVDA")
    assert len(bars) == 1
    assert bars[0]["close"] == 99.5
    assert bars[0]["source"] == "tushare"


def test_upsert_bars_lower_priority_skipped(fresh_db):
    """tushare(4) 已存在时 yfinance(1) 来不应覆盖"""
    fresh_db.upsert_bars("NVDA", [
        {"trade_date": "2026-01-02", "close": 99.5}
    ], "tushare")
    fresh_db.upsert_bars("NVDA", [
        {"trade_date": "2026-01-02", "close": 100.0}  # yfinance 想覆盖
    ], "yfinance")
    bars = fresh_db.get_bars("NVDA")
    assert bars[0]["close"] == 99.5  # tushare 值保留
    assert bars[0]["source"] == "tushare"


def test_upsert_bars_same_priority_overrides(fresh_db):
    """同一源后写覆盖前写（用于纠错或修订）"""
    fresh_db.upsert_bars("NVDA", [{"trade_date": "2026-01-02", "close": 100.0}], "yfinance")
    fresh_db.upsert_bars("NVDA", [{"trade_date": "2026-01-02", "close": 100.5}], "yfinance")
    assert fresh_db.get_bars("NVDA")[0]["close"] == 100.5


# ── sync_state ────────────────────────────────────────────
def test_get_latest_bar_date_none_when_empty(fresh_db):
    assert fresh_db.get_latest_bar_date("NVDA") is None


def test_get_latest_bar_date_after_upsert(fresh_db):
    fresh_db.upsert_bars("NVDA", [
        {"trade_date": "2026-01-02", "close": 100},
        {"trade_date": "2026-01-05", "close": 102},
        {"trade_date": "2026-01-03", "close": 101},  # 乱序
    ], "yfinance")
    # 应取最大日期
    assert fresh_db.get_latest_bar_date("NVDA") == "2026-01-05"


def test_mark_sync_failure_increments(fresh_db):
    fresh_db.mark_sync_failure("NVDA", "router", "rate limited")
    fresh_db.mark_sync_failure("NVDA", "router", "rate limited again")
    conn = fresh_db._get_conn()
    row = conn.execute("SELECT consec_fails, last_error FROM sync_state WHERE ticker=?",
                       ("NVDA",)).fetchone()
    assert row["consec_fails"] == 2
    assert "rate limited" in row["last_error"]


def test_successful_upsert_resets_fails(fresh_db):
    fresh_db.mark_sync_failure("NVDA", "router", "fail")
    fresh_db.upsert_bars("NVDA", [{"trade_date": "2026-01-02", "close": 100}], "yfinance")
    conn = fresh_db._get_conn()
    row = conn.execute("SELECT consec_fails, last_error FROM sync_state WHERE ticker=?",
                       ("NVDA",)).fetchone()
    assert row["consec_fails"] == 0
    assert row["last_error"] is None


# ── upsert_ticker_meta ────────────────────────────────────
def test_upsert_ticker_meta_inserts(fresh_db):
    cfg = {"name": "NVIDIA", "yf_symbol": "NVDA", "market": "US",
           "type": "stock", "currency": "USD", "sector": "Tech"}
    fresh_db.upsert_ticker_meta("NVDA", cfg, is_builtin=True)
    conn = fresh_db._get_conn()
    row = conn.execute("SELECT * FROM tickers WHERE ticker=?", ("NVDA",)).fetchone()
    assert row["name"] == "NVIDIA"
    assert row["is_builtin"] == 1


def test_upsert_ticker_meta_updates_on_conflict(fresh_db):
    cfg1 = {"name": "Old Name", "yf_symbol": "NVDA", "market": "US"}
    cfg2 = {"name": "New Name", "yf_symbol": "NVDA", "market": "US", "sector": "AI"}
    fresh_db.upsert_ticker_meta("NVDA", cfg1, is_builtin=True)
    fresh_db.upsert_ticker_meta("NVDA", cfg2, is_builtin=False)
    conn = fresh_db._get_conn()
    row = conn.execute("SELECT name, sector, is_builtin FROM tickers WHERE ticker=?",
                       ("NVDA",)).fetchone()
    assert row["name"] == "New Name"
    assert row["sector"] == "AI"
    # is_builtin 不在 ON CONFLICT 的 update set 里 — 保留原值
    assert row["is_builtin"] == 1


# ── llm_cache ─────────────────────────────────────────────
def test_llm_cache_miss_returns_none(fresh_db):
    key = fresh_db.llm_cache_key("summary", "deepseek-chat", "ping")
    assert fresh_db.llm_cache_get(key) is None


def test_llm_cache_put_then_get(fresh_db):
    key = fresh_db.llm_cache_key("summary", "deepseek-chat", "prompt-text")
    fresh_db.llm_cache_put(key, "summary", "deepseek-chat",
                           {"看点": "强", "风险": "贵", "估值": "贵"},
                           ticker="NVDA", prompt_tokens=100, completion_tokens=50,
                           ttl_seconds=3600)
    hit = fresh_db.llm_cache_get(key)
    assert hit is not None
    assert hit["response"]["看点"] == "强"
    assert hit["prompt_tokens"] == 100
    assert hit["completion_tokens"] == 50


def test_llm_cache_expired_returns_none(fresh_db):
    key = fresh_db.llm_cache_key("summary", "deepseek-chat", "p")
    fresh_db.llm_cache_put(key, "summary", "deepseek-chat", {"a": 1},
                           ttl_seconds=-10)  # 已过期（伪造）
    # 等等，put 内部计算 expires_at = now + ttl_seconds=-10 → 即 now-10，已过期
    assert fresh_db.llm_cache_get(key) is None


def test_llm_cache_zero_ttl_never_expires(fresh_db):
    key = fresh_db.llm_cache_key("summary", "deepseek-chat", "p")
    fresh_db.llm_cache_put(key, "summary", "deepseek-chat", {"a": 1}, ttl_seconds=0)
    assert fresh_db.llm_cache_get(key) is not None


def test_llm_cache_stats(fresh_db):
    key1 = fresh_db.llm_cache_key("summary", "deepseek-chat", "p1")
    key2 = fresh_db.llm_cache_key("explain-score", "deepseek-chat", "p2")
    fresh_db.llm_cache_put(key1, "summary", "deepseek-chat", {"a": 1}, prompt_tokens=10, completion_tokens=5)
    fresh_db.llm_cache_put(key2, "explain-score", "deepseek-chat", {"b": 2}, prompt_tokens=20, completion_tokens=8)
    fresh_db.llm_cache_get(key1)  # 命中 → hit_count++
    stats = fresh_db.llm_cache_stats()
    assert stats["total_entries"] == 2
    endpoints = {r["endpoint"]: r for r in stats["by_endpoint"]}
    assert "summary" in endpoints
    assert endpoints["summary"]["entries"] == 1
    assert endpoints["summary"]["total_hits"] >= 1
