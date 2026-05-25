"""
test_score_history — backend/score_history.py 单元测试
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import score_history as sh  # noqa: E402


# ── load_history ────────────────────────────────────────

class TestLoadHistory:
    def test_missing_file_returns_empty(self, tmp_path):
        assert sh.load_history(tmp_path / "nope.json") == {}

    def test_valid_file(self, tmp_path):
        p = tmp_path / "h.json"
        p.write_text(json.dumps({
            "NVDA": [{"date": "2026-05-19", "score": 85.0}],
        }), encoding="utf-8")
        assert sh.load_history(p) == {
            "NVDA": [{"date": "2026-05-19", "score": 85.0}],
        }

    def test_corrupt_json_returns_empty(self, tmp_path):
        p = tmp_path / "h.json"
        p.write_text("not json {", encoding="utf-8")
        assert sh.load_history(p) == {}

    def test_invalid_entries_filtered(self, tmp_path):
        p = tmp_path / "h.json"
        p.write_text(json.dumps({
            "NVDA": [
                {"date": "2026-05-19", "score": 85.0},  # ok
                {"date": 12345, "score": 80.0},          # bad date type
                {"date": "2026-05-20"},                  # missing score
                "not-a-dict",                            # bad entry
            ],
            "BAD": "not-a-list",                         # bad value type
        }), encoding="utf-8")
        out = sh.load_history(p)
        assert "BAD" not in out
        assert len(out["NVDA"]) == 1
        assert out["NVDA"][0]["date"] == "2026-05-19"


# ── save / round-trip ───────────────────────────────────

class TestSaveAndRoundTrip:
    def test_round_trip(self, tmp_path):
        data = {"NVDA": [{"date": "2026-05-19", "score": 85.0}]}
        p = tmp_path / "h.json"
        sh.save_history(data, p)
        assert sh.load_history(p) == data

    def test_creates_parent_dir(self, tmp_path):
        p = tmp_path / "nested" / "subdir" / "h.json"
        sh.save_history({}, p)
        assert p.exists()


# ── append_score ────────────────────────────────────────

class TestAppendScore:
    def test_append_new_date(self):
        series: list[dict] = []
        out = sh.append_score(series, 80.0, "2026-05-19")
        assert out == [{"date": "2026-05-19", "score": 80.0}]

    def test_dedupe_same_date_keeps_latest(self):
        series = [{"date": "2026-05-19", "score": 80.0}]
        out = sh.append_score(series, 90.0, "2026-05-19")
        assert out == [{"date": "2026-05-19", "score": 90.0}]

    def test_sorts_by_date(self):
        series = [
            {"date": "2026-05-20", "score": 81.0},
            {"date": "2026-05-18", "score": 79.0},
        ]
        out = sh.append_score(series, 82.0, "2026-05-19")
        assert [e["date"] for e in out] == ["2026-05-18", "2026-05-19", "2026-05-20"]

    def test_retention_drops_oldest(self):
        series = [{"date": f"2026-04-{i:02d}", "score": float(i)} for i in range(1, 11)]
        out = sh.append_score(series, 99.0, "2026-05-01", retention_days=5)
        assert len(out) == 5
        # 最新条目在末尾
        assert out[-1]["date"] == "2026-05-01"
        # 最早 5 个被删（保留 4/07-04/10 + 5/01）
        assert out[0]["date"] == "2026-04-07"

    def test_score_rounded(self):
        out = sh.append_score([], 80.12345, "2026-05-19")
        assert out[0]["score"] == 80.1


# ── compute_smoothed_and_delta ──────────────────────────

class TestComputeSmoothedAndDelta:
    def test_empty_returns_none_none(self):
        assert sh.compute_smoothed_and_delta([]) == (None, None)

    def test_single_entry_smoothed_only(self):
        series = [{"date": "2026-05-19", "score": 80.0}]
        smoothed, delta = sh.compute_smoothed_and_delta(series, window=5)
        assert smoothed == 80.0
        assert delta is None

    def test_less_than_window_smoothed_partial_delta_none(self):
        series = [{"date": f"2026-05-{15+i:02d}", "score": 70.0 + i}
                  for i in range(3)]  # 70, 71, 72
        smoothed, delta = sh.compute_smoothed_and_delta(series, window=5)
        # smoothed = 平均所有 3 个 = 71.0
        assert smoothed == 71.0
        # delta 需 window+1=6 条 → None
        assert delta is None

    def test_exact_window_smoothed_delta_none(self):
        """5 条刚够 smoothed，但 delta 需要 6 条。"""
        series = [{"date": f"2026-05-{15+i:02d}", "score": 70.0 + i}
                  for i in range(5)]  # 70, 71, 72, 73, 74
        smoothed, delta = sh.compute_smoothed_and_delta(series, window=5)
        assert smoothed == 72.0
        assert delta is None

    def test_six_entries_smoothed_5avg_delta_5d(self):
        # 6 条：70, 71, 72, 73, 74, 75
        series = [{"date": f"2026-05-{15+i:02d}", "score": 70.0 + i}
                  for i in range(6)]
        smoothed, delta = sh.compute_smoothed_and_delta(series, window=5)
        # 最近 5: 71/72/73/74/75 → avg 73.0
        assert smoothed == 73.0
        # delta: 75 - 70 = 5.0
        assert delta == 5.0

    def test_negative_delta(self):
        scores = [80, 78, 76, 74, 72, 70]
        series = [{"date": f"2026-05-{15+i:02d}", "score": float(s)}
                  for i, s in enumerate(scores)]
        smoothed, delta = sh.compute_smoothed_and_delta(series, window=5)
        # 最近 5: 78/76/74/72/70 → avg 74.0
        assert smoothed == 74.0
        # delta: 70 - 80 = -10.0
        assert delta == -10.0


# ── update_for_ticker（端到端便利函数）─────────────────

class TestUpdateForTicker:
    def test_creates_new_ticker_entry(self):
        history: dict = {}
        smoothed, delta = sh.update_for_ticker(
            history, "NVDA", 80.0, date_str="2026-05-19",
        )
        assert smoothed == 80.0
        assert delta is None
        assert history["NVDA"] == [{"date": "2026-05-19", "score": 80.0}]

    def test_appends_and_dedupes(self):
        history = {"NVDA": [{"date": "2026-05-19", "score": 80.0}]}
        sh.update_for_ticker(history, "NVDA", 81.0, date_str="2026-05-20")
        assert len(history["NVDA"]) == 2

        # 同日再调一次 → 覆盖
        sh.update_for_ticker(history, "NVDA", 82.0, date_str="2026-05-20")
        assert len(history["NVDA"]) == 2
        assert history["NVDA"][-1]["score"] == 82.0

    def test_returns_correct_smoothed_and_delta(self):
        history = {
            "NVDA": [
                {"date": f"2026-05-{15+i:02d}", "score": 70.0 + i} for i in range(5)
            ],
        }
        # 加第 6 条 → 应能算 delta_5d
        smoothed, delta = sh.update_for_ticker(
            history, "NVDA", 76.0, date_str="2026-05-20",
        )
        # 最近 5: 71/72/73/74/76 → avg 73.2
        assert smoothed == 73.2
        # delta: 76 - 70 = 6.0
        assert delta == 6.0


# ── date_from_price_as_of ───────────────────────────────

class TestDateFromPriceAsOf:
    @pytest.mark.parametrize("inp,expected", [
        ("2026-05-19T00:00:00", "2026-05-19"),
        ("2026-05-19T15:59:00+00:00", "2026-05-19"),
        ("2026-05-19", "2026-05-19"),
        ("2026-12-01T08:30:00", "2026-12-01"),
    ])
    def test_valid_iso(self, inp, expected):
        assert sh.date_from_price_as_of(inp) == expected

    @pytest.mark.parametrize("inp", [None, "", "garbage", 12345, "2026/05/19"])
    def test_invalid_returns_none(self, inp):
        assert sh.date_from_price_as_of(inp) is None
