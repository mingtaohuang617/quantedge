"""db.py 模块测试 — 补 transactions / positions / db_stats / get_bars 范围查询。

补漏给 test_db.py（原 25 个用例只覆盖 normalize_ticker / upsert_bars / llm_cache）。
零外部依赖（用临时 sqlite 文件 + fresh_db fixture）。
"""
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """复用 test_db.py 的 fixture 模式：临时 db 文件 + 重置线程本地连接。"""
    import db as db_mod
    monkeypatch.setattr(db_mod, "DB_DIR", tmp_path)
    monkeypatch.setattr(db_mod, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_local", type(db_mod._local)())
    db_mod.init_db()
    return db_mod


# ── get_bars 范围查询 ──────────────────────────────────
def _seed_bars(db_mod, ticker="TEST", days=10):
    """种 N 个连续交易日的 bars。"""
    rows = [
        {"trade_date": f"2026-01-{d:02d}", "close": 100.0 + d}
        for d in range(1, days + 1)
    ]
    db_mod.upsert_bars(ticker, rows, "yfinance")
    return rows


def test_get_bars_no_filter_returns_all(fresh_db):
    _seed_bars(fresh_db, days=5)
    bars = fresh_db.get_bars("TEST")
    assert len(bars) == 5
    # 升序排列
    dates = [b["trade_date"] for b in bars]
    assert dates == sorted(dates)


def test_get_bars_start_only_filters(fresh_db):
    _seed_bars(fresh_db, days=10)
    bars = fresh_db.get_bars("TEST", start="2026-01-05")
    assert len(bars) == 6  # 5..10
    assert bars[0]["trade_date"] == "2026-01-05"


def test_get_bars_start_and_end_inclusive(fresh_db):
    """BETWEEN 是双闭区间，包含起止两端。"""
    _seed_bars(fresh_db, days=10)
    bars = fresh_db.get_bars("TEST", start="2026-01-03", end="2026-01-07")
    dates = [b["trade_date"] for b in bars]
    assert dates == ["2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07"]


def test_get_bars_nonexistent_ticker_returns_empty(fresh_db):
    assert fresh_db.get_bars("NOPE") == []


# ── db_stats 摘要 ──────────────────────────────────────
def test_db_stats_empty_db(fresh_db):
    """空库 → 0 计数 + 空列表，不抛异常。"""
    stats = fresh_db.db_stats()
    assert stats["tickers"] == 0
    assert stats["daily_bars"] == 0
    assert stats["by_source"] == {}
    assert stats["last_synced"] == []
    assert stats["coverage"] == []


def test_db_stats_after_upsert_counts_correct(fresh_db):
    _seed_bars(fresh_db, ticker="NVDA", days=5)
    _seed_bars(fresh_db, ticker="AAPL", days=3)
    stats = fresh_db.db_stats()
    assert stats["daily_bars"] == 8  # 5 + 3
    # by_source 应包含 yfinance
    assert "yfinance" in stats["by_source"]
    assert stats["by_source"]["yfinance"] == 8
    # coverage 应有 2 行
    cov_tickers = {c["ticker"] for c in stats["coverage"]}
    assert cov_tickers == {"NVDA", "AAPL"}
    # 按 bars 降序：NVDA(5) 应在 AAPL(3) 之前
    assert stats["coverage"][0]["ticker"] == "NVDA"
    assert stats["coverage"][0]["bars"] == 5


def test_db_stats_db_size_positive_after_data(fresh_db):
    _seed_bars(fresh_db, days=5)
    stats = fresh_db.db_stats()
    assert stats["db_size_mb"] >= 0  # 至少非负


# ── insert_transaction ────────────────────────────────
def test_insert_transaction_returns_id(fresh_db):
    tx_id = fresh_db.insert_transaction("NVDA", "buy", qty=10, price=500.0)
    assert isinstance(tx_id, int)
    assert tx_id >= 1


def test_insert_transaction_validates_side(fresh_db):
    with pytest.raises(ValueError, match="side"):
        fresh_db.insert_transaction("NVDA", "hodl", qty=10, price=500.0)


def test_insert_transaction_validates_qty_price_positive(fresh_db):
    with pytest.raises(ValueError, match="qty / price"):
        fresh_db.insert_transaction("NVDA", "buy", qty=0, price=500.0)
    with pytest.raises(ValueError, match="qty / price"):
        fresh_db.insert_transaction("NVDA", "buy", qty=10, price=-1.0)


def test_insert_transaction_defaults_traded_at_today(fresh_db):
    """traded_at 缺省取今天。"""
    from datetime import date
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=500.0)
    txs = fresh_db.list_transactions("NVDA")
    assert txs[0]["traded_at"] == date.today().isoformat()


def test_insert_transaction_with_fee_and_notes(fresh_db):
    fresh_db.insert_transaction(
        "NVDA", "buy", qty=10, price=500.0,
        fee=1.5, notes="initial position",
    )
    txs = fresh_db.list_transactions("NVDA")
    assert txs[0]["fee"] == 1.5
    assert txs[0]["notes"] == "initial position"


# ── list_transactions ──────────────────────────────────
def test_list_transactions_filters_by_ticker(fresh_db):
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=500)
    fresh_db.insert_transaction("AAPL", "buy", qty=20, price=180)
    fresh_db.insert_transaction("NVDA", "sell", qty=5, price=550)
    only_nvda = fresh_db.list_transactions("NVDA")
    assert len(only_nvda) == 2
    assert all(t["ticker"] == "NVDA" for t in only_nvda)


def test_list_transactions_no_filter_returns_all(fresh_db):
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=500)
    fresh_db.insert_transaction("AAPL", "buy", qty=20, price=180)
    all_txs = fresh_db.list_transactions()
    assert len(all_txs) == 2


def test_list_transactions_respects_limit(fresh_db):
    for i in range(5):
        fresh_db.insert_transaction("NVDA", "buy", qty=1, price=500 + i)
    txs = fresh_db.list_transactions("NVDA", limit=3)
    assert len(txs) == 3


# ── delete_transaction ────────────────────────────────
def test_delete_transaction_existing_returns_true(fresh_db):
    tx_id = fresh_db.insert_transaction("NVDA", "buy", qty=10, price=500)
    assert fresh_db.delete_transaction(tx_id) is True
    assert fresh_db.list_transactions("NVDA") == []


def test_delete_transaction_nonexistent_returns_false(fresh_db):
    assert fresh_db.delete_transaction(99999) is False


# ── compute_positions ─────────────────────────────────
def test_compute_positions_no_transactions_empty(fresh_db):
    assert fresh_db.compute_positions() == []


def test_compute_positions_open_position_with_latest_close(fresh_db):
    """单 buy + 有 latest_close → 计算 avg_cost / unrealized_pnl。"""
    _seed_bars(fresh_db, ticker="NVDA", days=3)  # latest close = 103
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=100.0, fee=0)
    positions = fresh_db.compute_positions()
    assert len(positions) == 1
    p = positions[0]
    assert p["ticker"] == "NVDA"
    assert p["net_qty"] == 10
    assert p["avg_cost"] == 100.0
    assert p["latest_close"] == 103.0
    assert p["market_value"] == 1030.0
    assert p["unrealized_pnl"] == 30.0  # 10 * (103 - 100)
    assert p["closed"] is False


def test_compute_positions_closed_position_realized_pnl(fresh_db):
    """全部 sell 后 → closed=True，仅 realized_pnl。"""
    _seed_bars(fresh_db, ticker="NVDA", days=3)
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=100.0)
    fresh_db.insert_transaction("NVDA", "sell", qty=10, price=120.0)
    positions = fresh_db.compute_positions()
    assert len(positions) == 1
    p = positions[0]
    assert p["closed"] is True
    assert p["net_qty"] == 0
    assert p["market_value"] == 0
    assert p["unrealized_pnl"] == 0
    assert p["realized_pnl"] == 200.0  # 10 * (120 - 100)


def test_compute_positions_weighted_avg_cost(fresh_db):
    """两次 buy → 加权平均成本。"""
    _seed_bars(fresh_db, ticker="NVDA", days=1)
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=100.0)
    fresh_db.insert_transaction("NVDA", "buy", qty=20, price=110.0)
    positions = fresh_db.compute_positions()
    p = positions[0]
    # avg = (10*100 + 20*110) / 30 = (1000 + 2200) / 30 = 106.6667
    assert p["avg_cost"] == round((1000 + 2200) / 30, 4)
    assert p["net_qty"] == 30


def test_compute_positions_no_daily_bars_unrealized_is_none(fresh_db):
    """无 daily_bars → latest_close=None → unrealized 字段 None。"""
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=100.0)
    positions = fresh_db.compute_positions()
    p = positions[0]
    assert p["latest_close"] is None
    assert p["market_value"] is None
    assert p["unrealized_pnl"] is None


def test_compute_positions_partial_sell_keeps_open(fresh_db):
    """部分 sell → 仍持仓 + realized_pnl 反映已卖部分。"""
    _seed_bars(fresh_db, ticker="NVDA", days=3)  # latest 103
    fresh_db.insert_transaction("NVDA", "buy", qty=10, price=100.0)
    fresh_db.insert_transaction("NVDA", "sell", qty=3, price=120.0)
    positions = fresh_db.compute_positions()
    p = positions[0]
    assert p["closed"] is False
    assert p["net_qty"] == 7
    assert p["avg_cost"] == 100.0  # 仅 buy 计成本
    # realized = 3 * (120 - 100) = 60
    assert p["realized_pnl"] == 60.0
    # unrealized = 7 * (103 - 100) = 21
    assert p["unrealized_pnl"] == 21.0


def test_compute_positions_sorted_by_market_value(fresh_db):
    """多个持仓 → 按 market_value 降序。"""
    _seed_bars(fresh_db, ticker="NVDA", days=1)   # close 101
    _seed_bars(fresh_db, ticker="AAPL", days=1)   # close 101
    fresh_db.insert_transaction("NVDA", "buy", qty=100, price=100)  # mv = 10100
    fresh_db.insert_transaction("AAPL", "buy", qty=10, price=100)   # mv = 1010
    positions = fresh_db.compute_positions()
    assert positions[0]["ticker"] == "NVDA"
    assert positions[1]["ticker"] == "AAPL"
