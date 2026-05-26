"""
stock_gene_scheduler — Stock Gene 评分定时刷新
================================================

后台线程，每天在指定 UTC 时刻跑一次 score_all_engines（4 引擎全跑）。
默认时刻 06:00 UTC（北京时间 14:00 = 美股盘后），无人时段对 yfinance
压力小。

状态持久化到 backend/stock_gene_scheduler.json：
  {
    "enabled": true,
    "schedule": { "hour_utc": 6, "minute_utc": 0 },
    "last_run_at": "...",
    "last_summary": { ... },
    "next_run_at": "...",
    "manual_run_at": "...",
  }

线程实现：sleep until next run，每次唤醒重新读 enabled / schedule（用户改了
配置不用重启）。
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE_PATH = Path(__file__).resolve().parent / "stock_gene_scheduler.json"

DEFAULT_STATE = {
    "enabled": False,         # 默认关闭——用户主动开启
    "schedule": {"hour_utc": 6, "minute_utc": 0},
    "last_run_at": None,
    "last_summary": None,
    "next_run_at": None,
    "manual_run_at": None,
}

_lock = threading.Lock()
_thread: threading.Thread | None = None
_wake_event = threading.Event()   # 用于即时唤醒（外部改 schedule 时）
_stop_event = threading.Event()


# ── 状态 IO ───────────────────────────────────────────
def load_state() -> dict:
    if not STATE_PATH.exists():
        return DEFAULT_STATE.copy()
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        # 补默认字段
        for k, v in DEFAULT_STATE.items():
            data.setdefault(k, v)
        data.setdefault("schedule", DEFAULT_STATE["schedule"].copy())
        return data
    except Exception:
        return DEFAULT_STATE.copy()


def save_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(STATE_PATH)


# ── 调度逻辑 ──────────────────────────────────────────
def _next_run_dt(now: datetime, hour_utc: int, minute_utc: int) -> datetime:
    """返回下一次应运行的 UTC datetime（aware）。"""
    today_run = now.replace(hour=hour_utc, minute=minute_utc, second=0, microsecond=0)
    if today_run <= now:
        today_run += timedelta(days=1)
    return today_run


def get_status() -> dict:
    """对外暴露的当前状态（含 next_run_at 实时计算）。"""
    state = load_state()
    now = datetime.now(timezone.utc)
    sched = state.get("schedule") or DEFAULT_STATE["schedule"]
    nxt = _next_run_dt(now, sched.get("hour_utc", 6), sched.get("minute_utc", 0))
    state["next_run_at"] = nxt.isoformat()
    return state


def set_enabled(enabled: bool) -> dict:
    state = load_state()
    state["enabled"] = bool(enabled)
    save_state(state)
    _wake_event.set()       # 让 loop 立刻重新读 state
    return get_status()


def set_schedule(hour_utc: int, minute_utc: int) -> dict:
    hour_utc = max(0, min(23, int(hour_utc)))
    minute_utc = max(0, min(59, int(minute_utc)))
    state = load_state()
    state["schedule"] = {"hour_utc": hour_utc, "minute_utc": minute_utc}
    save_state(state)
    _wake_event.set()
    return get_status()


def run_now() -> dict:
    """同步触发一次跑全引擎，记录到 manual_run_at + last_summary。"""
    summary = _do_run()
    state = load_state()
    state["manual_run_at"] = datetime.now(timezone.utc).isoformat()
    state["last_run_at"] = state["manual_run_at"]
    state["last_summary"] = summary
    save_state(state)
    return get_status()


def _do_run() -> dict:
    """实际跑评分。隔离在函数里，便于 cron / 手动 / 测试共用。"""
    import stock_gene
    return stock_gene.score_all_engines()


def _loop() -> None:
    """后台线程主循环。每次到达 next_run_at 触发一次，然后睡到下一天。"""
    print("[scheduler] thread started")
    while not _stop_event.is_set():
        state = load_state()
        sched = state.get("schedule") or DEFAULT_STATE["schedule"]
        now = datetime.now(timezone.utc)
        target = _next_run_dt(now, sched.get("hour_utc", 6), sched.get("minute_utc", 0))
        sleep_sec = (target - now).total_seconds()
        # 上限 1 小时一次轮询，避免长 sleep 时无法响应 enable/schedule 改动
        sleep_sec = max(5, min(sleep_sec, 3600))
        _wake_event.wait(sleep_sec)
        _wake_event.clear()
        if _stop_event.is_set():
            break
        # 重新读 state（用户可能在 sleep 期间改了 enabled）
        state = load_state()
        if not state.get("enabled"):
            continue
        now2 = datetime.now(timezone.utc)
        sched2 = state.get("schedule") or DEFAULT_STATE["schedule"]
        target2 = _next_run_dt(now2, sched2.get("hour_utc", 6), sched2.get("minute_utc", 0))
        # 仅在已过当天的 target 时刻触发
        # 即：当前时刻 - target2 + 1day 应在 [0, 60s] 区间（target2 是"下一次"，所以减一天得到刚过的那次）
        diff = (now2 - (target2 - timedelta(days=1))).total_seconds()
        if 0 <= diff < 120:
            try:
                summary = _do_run()
                with _lock:
                    state = load_state()
                    state["last_run_at"] = now2.isoformat()
                    state["last_summary"] = summary
                    save_state(state)
                print(f"[scheduler] auto-run done at {now2.isoformat()}: {summary.get('engines')}")
            except Exception as e:
                print(f"[scheduler] auto-run failed: {e}")


def start_scheduler() -> None:
    """server 启动时调用：拉起后台线程（仅 enabled=True 时实际跑评分）。"""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop_event.clear()
    _wake_event.clear()
    _thread = threading.Thread(target=_loop, name="stock-gene-scheduler", daemon=True)
    _thread.start()


def stop_scheduler() -> None:
    _stop_event.set()
    _wake_event.set()
