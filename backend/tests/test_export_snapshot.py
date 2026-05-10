"""export_macro_snapshot._validate 单测.

验证 snapshot 完整性校验函数能正确识别空 / 缺数据 / 错误等异常。
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from export_macro_snapshot import _validate  # noqa: E402


def test_validate_empty_dict():
    """完全空的 snapshot 应触发多个 warn."""
    warns = _validate({})
    assert "factors 为空" in warns
    assert "composite.market_temperature 为 None" in warns
    assert "composite_history.dates 为空" in warns


def test_validate_complete_snapshot_no_warns():
    """完整 snapshot — 0 个 warning."""
    snap = {
        "factors": [{"factor_id": "F1", "latest": {"value_date": "2026-05-09", "raw_value": 1.0}}],
        "composite": {
            "market_temperature": 50.0,
            "hmm": {"current": {"bull": 0.5, "neutral": 0.3, "bear": 0.2}},
            "survival": {"current_regime": "bull", "current_duration_days": 100},
        },
        "composite_history": {"dates": ["2026-05-08", "2026-05-09"]},
    }
    assert _validate(snap) == []


def test_validate_factors_missing_latest():
    """有些因子 latest=null → warn 计数."""
    snap = {
        "factors": [
            {"factor_id": "F1", "latest": {"raw_value": 1.0}},
            {"factor_id": "F2", "latest": None},
            {"factor_id": "F3"},
        ],
        "composite": {"market_temperature": 50.0},
        "composite_history": {"dates": ["2026-05-09"]},
    }
    warns = _validate(snap)
    assert any("2 个因子缺 latest" in w for w in warns)


def test_validate_hmm_error_surfaces():
    snap = {
        "factors": [{"factor_id": "F1", "latest": {}}],
        "composite": {
            "market_temperature": 50.0,
            "hmm": {"error": "training failed"},
        },
        "composite_history": {"dates": ["2026-05-09"]},
    }
    warns = _validate(snap)
    assert any("hmm.error" in w for w in warns)


def test_validate_survival_error_surfaces():
    snap = {
        "factors": [{"factor_id": "F1", "latest": {}}],
        "composite": {
            "market_temperature": 50.0,
            "survival": {"error": "insufficient history"},
        },
        "composite_history": {"dates": ["2026-05-09"]},
    }
    warns = _validate(snap)
    assert any("survival.error" in w for w in warns)


def test_validate_temperature_none():
    """market_temperature 为 None → warn."""
    snap = {
        "factors": [{"factor_id": "F1", "latest": {}}],
        "composite": {"market_temperature": None},
        "composite_history": {"dates": ["2026-05-09"]},
    }
    warns = _validate(snap)
    assert "composite.market_temperature 为 None" in warns
