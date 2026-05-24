"""
评分历史持久化（P1）
====================
为每个 ticker 维护一份按日评分历史，用于：
  - score_smoothed: 最近 N 天评分的平均（默认 N=5）
  - score_delta_5d: 今 - 5 日前

为什么独立模块：pipeline.py 已经很大，持久化逻辑单独成层方便测试和后续切到 DB。

文件：backend/output/score_history.json
格式：{ticker: [{"date": "2026-05-20", "score": 82.5}, ...]}

去重：同 date 只保留最新一条（跨周末多次运行不会污染平均）。
保留窗口：每个 ticker 最多 RETENTION_DAYS=90 天，超出删旧。
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
HISTORY_PATH = OUTPUT_DIR / "score_history.json"

# 每个 ticker 最多保留的天数（够算 N=5 平滑 + 短期趋势观察，
# 同时控制文件体积：300 标的 × 90 天 ≈ 8MB JSON）
RETENTION_DAYS = 90


def load_history(path: Path | None = None) -> dict[str, list[dict]]:
    """读历史评分。文件不存在或损坏 → 返回空 dict。"""
    p = path or HISTORY_PATH
    if not p.exists():
        return {}
    try:
        raw = p.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {}
        # 健壮性：丢掉非 list 的 value、非 dict 的 entry
        out: dict[str, list[dict]] = {}
        for k, v in data.items():
            if not isinstance(v, list):
                continue
            valid = [
                e for e in v
                if isinstance(e, dict)
                and isinstance(e.get("date"), str)
                and isinstance(e.get("score"), (int, float))
            ]
            if valid:
                out[k] = valid
        return out
    except (json.JSONDecodeError, OSError):
        return {}


def save_history(history: dict[str, list[dict]], path: Path | None = None) -> None:
    """落盘。父目录不存在时创建。"""
    p = path or HISTORY_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def append_score(
    series: list[dict],
    score: float | int,
    date_str: str,
    retention_days: int = RETENTION_DAYS,
) -> list[dict]:
    """把今日评分追加到序列。

    - 同 date_str 已存在 → 用新值覆盖（pipeline 一天跑多次只留最后一次）
    - 按 date 升序排序
    - 超出 retention_days 个条目时丢最早的
    """
    other = [e for e in series if e.get("date") != date_str]
    other.append({"date": date_str, "score": round(float(score), 1)})
    other.sort(key=lambda e: e["date"])
    if len(other) > retention_days:
        other = other[-retention_days:]
    return other


def compute_smoothed_and_delta(
    series: list[dict],
    window: int = 5,
) -> tuple[float | None, float | None]:
    """从已排好序的评分序列计算 (smoothed_avg, delta_5d)。

    - smoothed_avg: 最近 window 天的算术平均（不足 window 时算手头的全部）。
                    序列空 → None。
    - delta_5d: 最新一条 - (window 天前的一条)。条目数 < window+1 → None。
                例：window=5 需要至少 6 条才能算 5 日 delta。
    """
    if not series:
        return None, None
    scores = [float(e["score"]) for e in series if "score" in e]
    if not scores:
        return None, None
    n = min(window, len(scores))
    smoothed = round(sum(scores[-n:]) / n, 1)
    if len(scores) < window + 1:
        return smoothed, None
    delta = round(scores[-1] - scores[-window - 1], 1)
    return smoothed, delta


def update_for_ticker(
    history: dict[str, list[dict]],
    ticker: str,
    score: float | int,
    date_str: str | None = None,
    window: int = 5,
    retention_days: int = RETENTION_DAYS,
) -> tuple[float | None, float | None]:
    """便利函数：原地更新 history[ticker] 并返回 (smoothed, delta)。

    date_str 默认今天 UTC date。
    """
    if date_str is None:
        date_str = date.today().isoformat()
    series = history.get(ticker, [])
    series = append_score(series, score, date_str, retention_days=retention_days)
    history[ticker] = series
    return compute_smoothed_and_delta(series, window=window)


def date_from_price_as_of(price_as_of: str | None) -> str | None:
    """priceAsOf 形如 '2026-05-19T00:00:00' / '2026-05-19+00:00' / '2026-05-19'。

    取前 10 字符作为 date_str。失败返回 None。
    """
    if not price_as_of or not isinstance(price_as_of, str):
        return None
    s = price_as_of[:10]
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return s
    except ValueError:
        return None
