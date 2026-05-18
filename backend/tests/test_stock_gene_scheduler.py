"""
stock_gene_scheduler 单测
==========================
覆盖：状态 IO / enable-disable / 调度时刻计算 / run_now（mock _do_run）。
不真启动后台线程 — 跑业务逻辑就够。
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import stock_gene_scheduler as sched  # noqa: E402


@pytest.fixture
def tmp_sched(tmp_path, monkeypatch):
    fake = tmp_path / "stock_gene_scheduler.json"
    monkeypatch.setattr(sched, "STATE_PATH", fake)
    yield fake


# ─── 状态 IO ───────────────────────────────────────────────
def test_load_empty_returns_default(tmp_sched):
    state = sched.load_state()
    assert state["enabled"] is False     # 默认关闭
    assert state["schedule"] == {"hour_utc": 6, "minute_utc": 0}
    assert state["last_run_at"] is None


def test_save_load_roundtrip(tmp_sched):
    sched.save_state({
        "enabled": True,
        "schedule": {"hour_utc": 12, "minute_utc": 30},
        "last_run_at": "2026-05-17T12:30:00+00:00",
        "last_summary": {"engines": {"trend": {"ok": 5, "fail": 0}}},
        "next_run_at": None,
        "manual_run_at": None,
    })
    state = sched.load_state()
    assert state["enabled"] is True
    assert state["schedule"]["hour_utc"] == 12
    assert state["last_summary"]["engines"]["trend"]["ok"] == 5


def test_load_with_missing_fields_fills_defaults(tmp_sched):
    """老状态文件可能缺字段 → load 时补默认"""
    import json
    tmp_sched.write_text('{"enabled": true}', encoding="utf-8")
    state = sched.load_state()
    assert state["enabled"] is True
    assert state["schedule"] == {"hour_utc": 6, "minute_utc": 0}


def test_load_corrupt_returns_default(tmp_sched):
    tmp_sched.write_text("{ not valid json", encoding="utf-8")
    state = sched.load_state()
    assert state == sched.DEFAULT_STATE


# ─── enable / disable ──────────────────────────────────────
def test_set_enabled_true(tmp_sched):
    out = sched.set_enabled(True)
    assert out["enabled"] is True
    assert sched.load_state()["enabled"] is True


def test_set_enabled_false(tmp_sched):
    sched.set_enabled(True)
    sched.set_enabled(False)
    assert sched.load_state()["enabled"] is False


def test_set_schedule(tmp_sched):
    out = sched.set_schedule(14, 30)
    assert out["schedule"] == {"hour_utc": 14, "minute_utc": 30}


def test_set_schedule_clamps_invalid(tmp_sched):
    """超范围参数被夹到合法区间"""
    out = sched.set_schedule(99, 99)
    assert out["schedule"]["hour_utc"] == 23
    assert out["schedule"]["minute_utc"] == 59


# ─── _next_run_dt ──────────────────────────────────────────
def test_next_run_today_if_time_not_passed(tmp_sched):
    """当前时刻早于今天的目标 → 今天的目标"""
    # 9:00 时，目标 12:00 → next = 今天 12:00
    now = datetime(2026, 5, 17, 9, 0, tzinfo=timezone.utc)
    nxt = sched._next_run_dt(now, 12, 0)
    assert nxt == datetime(2026, 5, 17, 12, 0, tzinfo=timezone.utc)


def test_next_run_tomorrow_if_time_passed(tmp_sched):
    """当前时刻晚于今天的目标 → 明天"""
    now = datetime(2026, 5, 17, 15, 0, tzinfo=timezone.utc)
    nxt = sched._next_run_dt(now, 12, 0)
    assert nxt == datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)


# ─── get_status ────────────────────────────────────────────
def test_get_status_computes_next_run(tmp_sched):
    sched.set_enabled(True)
    sched.set_schedule(6, 0)
    status = sched.get_status()
    assert status["enabled"] is True
    assert status["next_run_at"]   # ISO 字符串
    # 应能 parse
    nxt = datetime.fromisoformat(status["next_run_at"])
    assert nxt.hour == 6


# ─── run_now (mock _do_run) ───────────────────────────────
def test_run_now_records_summary(tmp_sched, monkeypatch):
    fake_summary = {
        "engines": {"trend": {"ok": 3, "fail": 0}, "value": {"ok": 3, "fail": 0}},
        "items_scanned": 3,
    }
    monkeypatch.setattr(sched, "_do_run", lambda: fake_summary)
    out = sched.run_now()
    assert out["last_summary"] == fake_summary
    assert out["manual_run_at"]
    assert out["last_run_at"]
