"""factors_lib 脚手架测试 — 临时 DB，零网络。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# 让 smoke test 能直接读 backend/.env（FRED_API_KEY 等）
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except ImportError:
    pass


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """每测试一份隔离 SQLite。"""
    import db as _db

    db_path = tmp_path / "test.db"
    monkeypatch.setattr(_db, "DB_DIR", tmp_path)
    monkeypatch.setattr(_db, "DB_PATH", db_path)

    # 上一测试可能留下指向真实 DB 的线程本地 conn — 清掉
    if hasattr(_db._local, "conn"):
        try:
            _db._local.conn.close()
        finally:
            del _db._local.conn

    _db.init_db()
    yield _db

    if hasattr(_db._local, "conn"):
        try:
            _db._local.conn.close()
        finally:
            del _db._local.conn


@pytest.fixture
def clean_registry():
    """隔离 _REGISTRY，避免测试相互污染。"""
    import factors_lib as fl

    saved = dict(fl._REGISTRY)
    fl._REGISTRY.clear()
    yield fl
    fl._REGISTRY.clear()
    fl._REGISTRY.update(saved)


# ── schema 落地 ────────────────────────────────────────
def test_init_db_creates_phase1_tables(tmp_db):
    conn = tmp_db._get_conn()
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    names = {r["name"] for r in rows}
    expected = {
        "series_observations", "series_meta",
        "factor_values", "factor_meta", "breadth_snapshot",
    }
    assert expected.issubset(names), f"missing: {expected - names}"


def test_init_db_creates_pit_indexes(tmp_db):
    conn = tmp_db._get_conn()
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    ).fetchall()
    names = {r["name"] for r in rows}
    assert {"idx_series_obs_publish", "idx_series_obs_value"}.issubset(names)


# ── 因子注册 ───────────────────────────────────────────
def test_register_factor_populates_registry(clean_registry):
    fl = clean_registry

    @fl.register_factor(
        "TEST_X", category="valuation", markets=["US"], freq="daily",
        description="测试因子",
    )
    def calc_x(as_of):
        return 1.0

    spec = fl.get_factor("TEST_X")
    assert spec is not None
    assert spec.category == "valuation"
    assert spec.markets == ["US"]
    assert spec.formula_ref.endswith("calc_x")
    # 装饰器不破坏函数本身
    assert calc_x.__name__ == "calc_x"
    assert calc_x("2024-01-01") == 1.0


def test_sync_factor_meta_upserts(tmp_db, clean_registry):
    fl = clean_registry

    @fl.register_factor(
        "TEST_Y", category="liquidity", markets=["US", "CN"],
        freq="weekly", description="另一测试",
    )
    def calc_y(as_of):
        return None

    assert fl.sync_factor_meta() == 1
    row = tmp_db._get_conn().execute(
        "SELECT applicable_markets, freq, description, is_active "
        "FROM factor_meta WHERE factor_id=?",
        ("TEST_Y",),
    ).fetchone()
    assert row is not None
    assert row["applicable_markets"] == "US,CN"
    assert row["freq"] == "weekly"
    assert row["description"] == "另一测试"
    assert row["is_active"] == 1

    # 第二次 sync 同 factor_id 应 UPDATE 而非 INSERT
    fl.sync_factor_meta()
    cnt = tmp_db._get_conn().execute(
        "SELECT COUNT(*) c FROM factor_meta WHERE factor_id=?",
        ("TEST_Y",),
    ).fetchone()["c"]
    assert cnt == 1


# ── series PIT 读写 ────────────────────────────────────
def test_upsert_and_read_series_latest(tmp_db):
    import factors_lib as fl

    n = fl.upsert_observations(
        "US_M2_TEST",
        [
            {"value_date": "2024-01-01", "publish_date": "2024-01-15", "value": 100.0},
            {"value_date": "2024-02-01", "publish_date": "2024-02-15", "value": 110.0},
            {"value_date": "2024-03-01", "publish_date": "2024-03-15", "value": 120.0},
        ],
        source="test",
    )
    assert n == 3
    assert fl.read_series("US_M2_TEST") == 120.0


def test_read_series_pit_respects_publish_date(tmp_db):
    import factors_lib as fl

    fl.upsert_observations(
        "US_PMI_TEST",
        [
            {"value_date": "2024-01-01", "publish_date": "2024-02-01", "value": 50.0},
            {"value_date": "2024-02-01", "publish_date": "2024-03-01", "value": 51.0},
            {"value_date": "2024-03-01", "publish_date": "2024-04-01", "value": 52.0},
        ],
        source="test",
    )
    # 第二次发布前 → 只见首期值
    assert fl.read_series("US_PMI_TEST", "2024-02-15") == 50.0
    # 第二次发布后 → 见次期值
    assert fl.read_series("US_PMI_TEST", "2024-03-15") == 51.0
    # 远未来 → 见最新
    assert fl.read_series("US_PMI_TEST", "2030-01-01") == 52.0
    # 任何发布日之前 → None
    assert fl.read_series("US_PMI_TEST", "2024-01-01") is None


def test_read_series_pit_handles_revision_vintage(tmp_db):
    import factors_lib as fl

    fl.upsert_observations(
        "US_GDP_TEST",
        [
            {"value_date": "2024-Q1", "publish_date": "2024-04-30",
             "value": 2.5, "vintage": 0},
            {"value_date": "2024-Q1", "publish_date": "2024-05-30",
             "value": 2.7, "vintage": 1},
        ],
        source="test",
    )
    # 修订前 → 初值
    assert fl.read_series("US_GDP_TEST", "2024-05-15") == 2.5
    # 修订后 → 修订值
    assert fl.read_series("US_GDP_TEST", "2024-06-01") == 2.7


def test_read_series_missing_returns_none(tmp_db):
    import factors_lib as fl
    assert fl.read_series("DOES_NOT_EXIST") is None
    assert fl.read_series("DOES_NOT_EXIST", "2024-01-01") is None


# ── to_percentile ──────────────────────────────────────
def test_to_percentile_max_value():
    import factors_lib as fl
    s = pd.Series(list(range(300)) + [999])
    pct = fl.to_percentile(s, min_periods=100)
    assert pct is not None and pct > 99


def test_to_percentile_min_value():
    import factors_lib as fl
    s = pd.Series(list(range(1, 301)) + [0])
    pct = fl.to_percentile(s, min_periods=100)
    assert pct is not None and pct < 1


def test_to_percentile_median_ish():
    import factors_lib as fl
    # 0..199 加一个 100 在末尾，期望分位在中位附近
    s = pd.Series(list(range(0, 200)) + [100])
    pct = fl.to_percentile(s, min_periods=50)
    assert pct is not None
    assert 40 < pct < 60


def test_to_percentile_insufficient_returns_none():
    import factors_lib as fl
    s = pd.Series([1.0, 2.0, 3.0])
    assert fl.to_percentile(s, min_periods=10) is None


def test_to_percentile_window_truncates_baseline():
    import factors_lib as fl
    # 前 900 全 0，后 100 是 1..100；window=100 只看后段
    vals = [0.0] * 900 + list(range(1, 101))
    s = pd.Series(vals)
    pct_win = fl.to_percentile(s, window=100, min_periods=50)
    assert pct_win is not None and pct_win > 99


# ── series_meta / read_series_history / factor_value writer ──
def test_upsert_series_meta_round_trip(tmp_db):
    import factors_lib as fl
    fl.upsert_series_meta(
        series_id="TEST_S1",
        name="测试序列",
        source="fred",
        source_id="TEST",
        frequency="daily",
        market="US",
        description="x",
    )
    row = tmp_db._get_conn().execute(
        "SELECT name, source, source_id, frequency, market FROM series_meta WHERE series_id=?",
        ("TEST_S1",),
    ).fetchone()
    assert row is not None
    assert row["name"] == "测试序列"
    assert row["source"] == "fred"
    assert row["frequency"] == "daily"


def test_read_series_history_returns_sorted_series(tmp_db):
    import factors_lib as fl
    fl.upsert_observations("S2", [
        {"value_date": "2024-03-01", "publish_date": "2024-03-01", "value": 3.0},
        {"value_date": "2024-01-01", "publish_date": "2024-01-01", "value": 1.0},
        {"value_date": "2024-02-01", "publish_date": "2024-02-01", "value": 2.0},
    ], source="test")
    s = fl.read_series_history("S2")
    assert list(s.index) == ["2024-01-01", "2024-02-01", "2024-03-01"]
    assert list(s.values) == [1.0, 2.0, 3.0]


def test_read_series_history_pit_filters_by_publish_date(tmp_db):
    import factors_lib as fl
    fl.upsert_observations("S3", [
        {"value_date": "2024-01-01", "publish_date": "2024-02-01", "value": 1.0},
        {"value_date": "2024-02-01", "publish_date": "2024-03-01", "value": 2.0},
        {"value_date": "2024-03-01", "publish_date": "2024-04-01", "value": 3.0},
    ], source="test")
    s_mid = fl.read_series_history("S3", "2024-03-15")
    assert list(s_mid.values) == [1.0, 2.0]
    s_full = fl.read_series_history("S3", "2030-01-01")
    assert list(s_full.values) == [1.0, 2.0, 3.0]
    s_empty = fl.read_series_history("S3", "2024-01-01")
    assert s_empty.empty


def test_upsert_factor_value_round_trip(tmp_db):
    import factors_lib as fl
    fl.upsert_factor_value(
        "F1", "US", "2024-05-01",
        raw_value=12.34, percentile=66.6, calc_version="v1",
    )
    row = tmp_db._get_conn().execute(
        "SELECT raw_value, percentile, calc_version FROM factor_values "
        "WHERE factor_id=? AND market=? AND value_date=?",
        ("F1", "US", "2024-05-01"),
    ).fetchone()
    assert row["raw_value"] == 12.34
    assert row["percentile"] == 66.6
    # 重写：覆盖
    fl.upsert_factor_value("F1", "US", "2024-05-01",
                           raw_value=99.9, percentile=10.0)
    row2 = tmp_db._get_conn().execute(
        "SELECT raw_value, percentile FROM factor_values "
        "WHERE factor_id=? AND market=? AND value_date=?",
        ("F1", "US", "2024-05-01"),
    ).fetchone()
    assert row2["raw_value"] == 99.9


# ── FRED smoke test（需要 FRED_API_KEY 环境变量）─────────
@pytest.mark.skipif(
    not os.environ.get("FRED_API_KEY"),
    reason="FRED_API_KEY 未设置，跳过网络 smoke test",
)
def test_fred_fetch_observations_smoke():
    """轻量级 smoke test：确认 FRED API 可达且返回正常格式。"""
    from data_sources import fred_source
    rows = fred_source.fetch_observations("T10Y2Y", start="2024-01-01")
    assert len(rows) > 100  # 2024 年至今每日 ≥100 个观测
    sample = rows[0]
    assert "value_date" in sample and "publish_date" in sample and "value" in sample
    assert isinstance(sample["value"], float)
