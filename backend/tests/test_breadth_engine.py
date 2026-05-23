"""breadth_engine 模块测试 — 纯 pandas 向量化计算 + 部分 DB-mock。

覆盖：
- compute_snapshots 主流程（universe_size / advancing / declining / 200ma / 50ma / 52w 新高新低）
- universe < 300 守门（避免 yfinance 部分失败污染因子）
- 空数据 / 空成分股短路返回
- upsert_snapshots 行数返回（不写真实库，用 mock）
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import breadth_engine  # noqa: E402


# ── 辅助：合成 close matrix ─────────────────────────────
def _make_close_matrix(n_tickers: int, n_days: int, *, base: float = 100.0, trend: float = 0.0):
    """生成 (date × ticker) wide DataFrame。

    trend > 0 → 整体上涨；trend < 0 → 整体下跌；trend = 0 → 横盘 + 小噪声
    """
    dates = pd.date_range("2023-01-01", periods=n_days, freq="B")
    tickers = [f"T{i:04d}" for i in range(n_tickers)]
    rng = np.random.default_rng(42)
    # 每天每票 close = base * (1 + trend * day + 0.005 * noise)
    days = np.arange(n_days).reshape(-1, 1)
    noise = rng.standard_normal((n_days, n_tickers))
    closes = base * (1 + trend * days + 0.005 * noise)
    return pd.DataFrame(closes, index=dates, columns=tickers)


# ── 空输入短路 ────────────────────────────────────────
def test_compute_snapshots_empty_constituents():
    """无成分股 → 空 DataFrame，不抛异常。"""
    with patch.object(breadth_engine, "_load_constituents", return_value=[]):
        out = breadth_engine.compute_snapshots(index_id="EMPTY")
    assert isinstance(out, pd.DataFrame)
    assert out.empty


def test_compute_snapshots_empty_matrix():
    """有成分股但 DB 拉不到价格 → 空 DataFrame。"""
    with patch.object(breadth_engine, "_load_constituents", return_value=["AAPL"]):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=pd.DataFrame()):
            out = breadth_engine.compute_snapshots()
    assert out.empty


# ── 主流程：synthetic universe ─────────────────────────
def test_compute_snapshots_basic_shape():
    """合成 500 票 × 400 天，验证输出 schema + 关键字段非空。

    400 天足以让 200ma / 252 日新高新低窗口都填充。
    universe=500 应该通过 ≥300 守门。
    """
    matrix = _make_close_matrix(n_tickers=500, n_days=400, trend=0.0005)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(index_id="SP500", market="US", start="2024-01-01")
    # schema
    expected_cols = {
        "universe_size", "advancing", "declining",
        "pct_above_200ma", "pct_above_50ma",
        "new_highs_52w", "new_lows_52w",
        "snapshot_date", "market",
    }
    assert expected_cols.issubset(set(out.columns))
    # 非空（合成数据 universe = 500 > 300 守门）
    assert len(out) > 0
    # universe_size 都是 500（合成时所有票每天都有数据）
    assert (out["universe_size"] == 500).all()
    # market 字段固定
    assert (out["market"] == "US").all()


def test_compute_snapshots_advancing_declining_complementary():
    """每行 advancing + declining ≤ universe_size（剩下是持平）。"""
    matrix = _make_close_matrix(n_tickers=500, n_days=300)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(start="2024-01-01")
    # 第一天 pct_change 是 NaN，advancing/declining 应为 0
    # 后续每天：advancing + declining ≤ 500（不严格 = 因为可能恰好持平）
    sums = out["advancing"] + out["declining"]
    assert (sums <= out["universe_size"]).all()
    assert (sums >= 0).all()


def test_compute_snapshots_pct_above_ma_in_range():
    """pct_above_200ma / pct_above_50ma 都应在 [0, 100]。"""
    matrix = _make_close_matrix(n_tickers=500, n_days=400, trend=0.001)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(start="2024-01-01")
    # 允许 NaN（早期 rolling 窗口不够），但有值的都应在 [0, 100]
    p200 = out["pct_above_200ma"].dropna()
    p50 = out["pct_above_50ma"].dropna()
    assert (p200 >= 0).all() and (p200 <= 100).all()
    assert (p50 >= 0).all() and (p50 <= 100).all()


def test_compute_snapshots_uptrend_above_ma():
    """整体上涨趋势 → 后期 pct_above_200ma 应该 > 50（多数票位于 200ma 之上）。"""
    matrix = _make_close_matrix(n_tickers=500, n_days=400, trend=0.002)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(start="2024-01-01")
    # 取最后一行（rolling 窗口最充分）
    last_p200 = out["pct_above_200ma"].iloc[-1]
    assert last_p200 > 50, f"uptrend should put majority above 200ma, got {last_p200}"


def test_compute_snapshots_universe_size_guard():
    """universe < 300 的行应被过滤掉（避免污染因子）。"""
    # 只生成 250 票，少于守门阈值 300
    matrix = _make_close_matrix(n_tickers=250, n_days=300)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(start="2024-01-01")
    # 因为 universe = 250 < 300，全部被守门规则丢掉
    assert out.empty, "rows with universe < 300 should be dropped"


def test_compute_snapshots_start_filter():
    """out 只包含 start 及之后的日期（350 天回溯仅供 rolling 用）。"""
    matrix = _make_close_matrix(n_tickers=500, n_days=400)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            # 用合成数据的中段日期作为 start
            mid_date = matrix.index[200].strftime("%Y-%m-%d")
            out = breadth_engine.compute_snapshots(start=mid_date)
    # snapshot_date 都应 >= mid_date
    if not out.empty:
        assert (out["snapshot_date"] >= mid_date).all()


def test_compute_snapshots_new_highs_lows_present():
    """new_highs_52w / new_lows_52w 都是非负整数。"""
    matrix = _make_close_matrix(n_tickers=500, n_days=400, trend=0.001)
    with patch.object(breadth_engine, "_load_constituents", return_value=list(matrix.columns)):
        with patch.object(breadth_engine, "_load_close_matrix", return_value=matrix):
            out = breadth_engine.compute_snapshots(start="2024-01-01")
    assert (out["new_highs_52w"] >= 0).all()
    assert (out["new_lows_52w"] >= 0).all()
    # 都应该是整数类型（不是 float NaN）
    assert out["new_highs_52w"].dtype == np.int64 or out["new_highs_52w"].dtype == np.int32
    assert out["new_lows_52w"].dtype == np.int64 or out["new_lows_52w"].dtype == np.int32


# ── upsert_snapshots ────────────────────────────────────
def test_upsert_snapshots_empty_returns_zero():
    """空 DataFrame → 0 行写入，不调用 db。"""
    n = breadth_engine.upsert_snapshots(pd.DataFrame())
    assert n == 0


def test_upsert_snapshots_calls_db_with_correct_rows():
    """upsert 应该用 executemany 把每行转换为 12-tuple。"""
    df = pd.DataFrame({
        "snapshot_date":   ["2024-03-01", "2024-03-02"],
        "market":          ["US", "US"],
        "universe_size":   [500, 498],
        "advancing":       [250, 220],
        "declining":       [240, 270],
        "pct_above_200ma": [55.5, 53.2],
        "pct_above_50ma":  [60.0, 58.1],
        "new_highs_52w":   [10, 8],
        "new_lows_52w":    [5, 7],
    })
    # mock db.transaction 上下文管理器
    class _FakeConn:
        def __init__(self):
            self.executemany_calls = []
        def executemany(self, sql, rows):
            self.executemany_calls.append((sql, list(rows)))

    class _FakeCtx:
        def __init__(self, conn):
            self.conn = conn
        def __enter__(self):
            return self.conn
        def __exit__(self, *args):
            return False

    fake_conn = _FakeConn()
    with patch.object(breadth_engine.db, "transaction", return_value=_FakeCtx(fake_conn)):
        n = breadth_engine.upsert_snapshots(df)

    assert n == 2
    assert len(fake_conn.executemany_calls) == 1
    sql, rows = fake_conn.executemany_calls[0]
    assert "INSERT INTO breadth_snapshot" in sql
    assert "ON CONFLICT" in sql  # upsert 语义
    assert len(rows) == 2
    # 每行 12 字段：date / market / 7 数值 / 2 个 None / computed_at
    assert len(rows[0]) == 12
    assert rows[0][0] == "2024-03-01"
    assert rows[0][1] == "US"
    assert rows[0][2] == 500       # universe_size
    assert rows[0][3] == 250       # advancing
    assert rows[0][7] is None      # macd_diffusion (W4 后期，None)
    assert rows[0][8] is None      # mcclellan_osc (W4 后期，None)


def test_upsert_snapshots_handles_nan_pct():
    """pct_above_200ma 为 NaN 时应转为 None（SQLite NULL）。"""
    df = pd.DataFrame({
        "snapshot_date":   ["2024-03-01"],
        "market":          ["US"],
        "universe_size":   [500],
        "advancing":       [250],
        "declining":       [240],
        "pct_above_200ma": [float("nan")],
        "pct_above_50ma":  [60.0],
        "new_highs_52w":   [10],
        "new_lows_52w":    [5],
    })

    class _FakeConn:
        def __init__(self):
            self.rows = None
        def executemany(self, sql, rows):
            self.rows = list(rows)

    class _FakeCtx:
        def __init__(self, conn):
            self.conn = conn
        def __enter__(self):
            return self.conn
        def __exit__(self, *args):
            return False

    fake_conn = _FakeConn()
    with patch.object(breadth_engine.db, "transaction", return_value=_FakeCtx(fake_conn)):
        breadth_engine.upsert_snapshots(df)

    assert fake_conn.rows is not None
    assert fake_conn.rows[0][5] is None  # pct_above_200ma NaN → None
    assert fake_conn.rows[0][6] == 60.0  # pct_above_50ma 保留


# ── update_snapshots (orchestrator) ─────────────────────
def test_update_snapshots_empty_constituents_returns_zero():
    """无成分股 → orchestrator 直接返回 0。"""
    with patch.object(breadth_engine, "_load_constituents", return_value=[]):
        n = breadth_engine.update_snapshots(index_id="EMPTY")
    assert n == 0
