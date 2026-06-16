"""
futu_anomaly_scan 纯逻辑 + anomaly_store 单测（零网络、零 OpenD）。
Futu SDK 延迟导入,这里只测纯函数,不触发导入。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import futu_anomaly_scan as fa  # noqa: E402
import anomaly_store as store  # noqa: E402


# ── favorite_to_futu ─────────────────────────────────────
def test_us_bare():
    assert fa.favorite_to_futu("EWY") == ("US.EWY", "US")


def test_us_hyphen_to_dot():
    assert fa.favorite_to_futu("BRK-B") == ("US.BRK.B", "US")


def test_us_lowercase_upper():
    assert fa.favorite_to_futu("ewy") == ("US.EWY", "US")


def test_hk_5digit():
    assert fa.favorite_to_futu("03486.HK") == ("HK.03486", "HK")


def test_hk_pads_to_5():
    assert fa.favorite_to_futu("700.HK") == ("HK.00700", "HK")


def test_cn_sh():
    assert fa.favorite_to_futu("600519.SH") == ("SH.600519", "CN")


def test_cn_sz():
    assert fa.favorite_to_futu("000001.SZ") == ("SZ.000001", "CN")


def test_korea_skipped():
    code, market = fa.favorite_to_futu("000660.KS")
    assert code is None and market == "KS"


def test_empty_returns_none():
    assert fa.favorite_to_futu("  ") == (None, None)


# ── extract_signals ──────────────────────────────────────
def test_extract_list_of_dicts():
    sig, n = fa.extract_signals([{"desc": "MACD 死叉"}, {"title": "RSI 超买"}])
    assert n == 2
    assert "MACD 死叉" in sig and "RSI 超买" in sig


def test_extract_dedup():
    sig, n = fa.extract_signals([{"desc": "X"}, {"desc": "X"}])
    assert n == 1 and sig == ["X"]


def test_extract_empty():
    assert fa.extract_signals([]) == ([], 0)


def test_extract_nested_dict():
    sig, n = fa.extract_signals({"a": [{"desc": "s1"}], "b": [{"desc": "s2"}]})
    assert n == 2


def test_extract_scalar():
    sig, n = fa.extract_signals("just a string")
    assert n == 1 and sig == ["just a string"]


def test_extract_limit():
    sig, n = fa.extract_signals([{"desc": f"s{i}"} for i in range(20)], limit=6)
    assert len(sig) == 6 and n == 20


# ── build_snapshot ───────────────────────────────────────
def test_build_snapshot_sorts_desc():
    items = [{"ticker": "A", "anomaly_count": 1}, {"ticker": "B", "anomaly_count": 5}]
    snap = fa.build_snapshot(items, [], [], 7, scanned_at="2026-01-01T00:00:00Z")
    assert snap["items"][0]["ticker"] == "B"
    assert snap["scanned_at"] == "2026-01-01T00:00:00Z"
    assert snap["version"] == 1 and snap["time_range"] == 7


# ── anomaly_store ────────────────────────────────────────
@pytest.fixture
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ANOMALY_PATH", tmp_path / "anomaly_scan.json")


def test_store_empty(tmp_store):
    d = store.load_scan()
    assert d["items"] == [] and d["scanned_at"] is None and d["time_range"] == 7


def test_store_roundtrip(tmp_store):
    saved = store.save_scan({"items": [{"ticker": "EWY"}], "time_range": 7})
    assert saved["scanned_at"]
    assert store.load_scan()["items"][0]["ticker"] == "EWY"


def test_store_full_replace(tmp_store):
    store.save_scan({"items": [{"ticker": "A"}]})
    store.save_scan({"items": [{"ticker": "B"}]})
    assert [i["ticker"] for i in store.load_scan()["items"]] == ["B"]


def test_store_coerces_bad_lists(tmp_store):
    saved = store.save_scan({"items": "bad", "skipped": None})
    assert saved["items"] == [] and saved["skipped"] == []
