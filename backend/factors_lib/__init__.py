"""
factors_lib — 市场层面（非个股）因子库脚手架
============================================
Phase 1 W1-2 范围：注册装饰器 + PIT 读写 + 分位数标准化共用工具。
具体因子（valuation/liquidity/breadth/sentiment/cn_macro）按 sprint 分批添加。

约定：
  - 所有外部时间序列（M2/PE/VIX/...）落 series_observations，按 (series_id,
    value_date, vintage) 唯一。回测查询用 publish_date <= as_of 切快照。
  - 所有因子用 @register_factor 注册到 _REGISTRY；运行 sync_factor_meta()
    把元数据 upsert 到 factor_meta 表。
  - 因子计算函数签名: (as_of: date) -> float | None。返回 None 表示数据不足。

依赖 backend/db.py 的 transaction() / _get_conn()。
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date as Date

import pandas as pd

import db as _db


# ── 因子注册 ─────────────────────────────────────────────
# 因子函数契约：
#   def calc_xxx(as_of: Date | None = None) -> pd.Series
#   - 返回该因子的历史值序列（index=value_date 字符串，按时间升序）
#   - PIT-aware：as_of=None 表示"现在"，给具体日期表示历史切片
#   - 数据不足时返回空 Series（不抛异常）
#   - 由 orchestrator 取末值作为 raw_value、to_percentile() 算分位
FactorFunc = Callable[..., pd.Series]


@dataclass
class FactorSpec:
    factor_id: str
    func: FactorFunc
    name: str
    category: str                              # valuation/liquidity/breadth/sentiment/macro/technical
    markets: list[str]
    freq: str                                  # daily/weekly/monthly
    description: str = ""
    rolling_window_days: int = 2520            # 10Y
    formula_ref: str = ""


_REGISTRY: dict[str, FactorSpec] = {}


def register_factor(
    factor_id: str,
    *,
    category: str,
    markets: list[str],
    freq: str = "daily",
    name: str | None = None,
    description: str = "",
    rolling_window_days: int = 2520,
):
    """
    因子注册装饰器。导入时填充内存 _REGISTRY；DB 落库由 sync_factor_meta() 触发。

    用法:
        @register_factor("US_ERP", category="valuation", markets=["US"],
                         freq="daily", description="股权风险溢价")
        def calc_us_erp(as_of: Date) -> float | None:
            ...
    """
    def deco(func: Callable[[Date], float | None]) -> Callable[[Date], float | None]:
        _REGISTRY[factor_id] = FactorSpec(
            factor_id=factor_id,
            func=func,
            name=name or factor_id,
            category=category,
            markets=list(markets),
            freq=freq,
            description=description,
            rolling_window_days=rolling_window_days,
            formula_ref=f"{func.__module__}.{func.__name__}",
        )
        return func
    return deco


def list_factors() -> list[FactorSpec]:
    return list(_REGISTRY.values())


def get_factor(factor_id: str) -> FactorSpec | None:
    return _REGISTRY.get(factor_id)


def sync_factor_meta() -> int:
    """把 _REGISTRY 内全部因子元数据 upsert 到 factor_meta。返回写入条数。"""
    if not _REGISTRY:
        return 0
    now_ms = int(time.time() * 1000)
    rows = [
        (
            spec.factor_id,
            spec.name,
            spec.category,
            ",".join(spec.markets),
            spec.formula_ref,
            spec.freq,
            spec.description,
            spec.rolling_window_days,
            1,
            now_ms,
            now_ms,
        )
        for spec in _REGISTRY.values()
    ]
    with _db.transaction() as conn:
        conn.executemany(
            """
            INSERT INTO factor_meta
              (factor_id, name, category, applicable_markets, formula_ref, freq,
               description, rolling_window_days, is_active, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(factor_id) DO UPDATE SET
              name                = excluded.name,
              category            = excluded.category,
              applicable_markets  = excluded.applicable_markets,
              formula_ref         = excluded.formula_ref,
              freq                = excluded.freq,
              description         = excluded.description,
              rolling_window_days = excluded.rolling_window_days,
              updated_at          = excluded.updated_at
            """,
            rows,
        )
    return len(rows)


# ── 时间序列 PIT 读写 ────────────────────────────────────
def upsert_series_meta(
    series_id: str,
    *,
    name: str,
    source: str,
    source_id: str,
    frequency: str,
    unit: str | None = None,
    market: str | None = None,
    description: str | None = None,
    publish_lag_days: int | None = None,
    is_revised: bool = False,
) -> None:
    """登记/更新一条时间序列的元数据。"""
    now_ms = int(time.time() * 1000)
    with _db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO series_meta
              (series_id, name, source, source_id, frequency, unit, market,
               description, publish_lag_days, is_revised, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(series_id) DO UPDATE SET
              name             = excluded.name,
              source           = excluded.source,
              source_id        = excluded.source_id,
              frequency        = excluded.frequency,
              unit             = excluded.unit,
              market           = excluded.market,
              description      = excluded.description,
              publish_lag_days = excluded.publish_lag_days,
              is_revised       = excluded.is_revised,
              updated_at       = excluded.updated_at
            """,
            (series_id, name, source, source_id, frequency, unit, market,
             description, publish_lag_days, 1 if is_revised else 0, now_ms),
        )


def upsert_observations(
    series_id: str, rows: list[dict], source: str,
) -> int:
    """
    rows: [{value_date, publish_date?, value, vintage?}, ...]
    publish_date 缺省 = value_date（适用于实时类，如收盘价）。
    冲突 (series_id, value_date, vintage)：覆盖。
    """
    if not rows:
        return 0
    now_ms = int(time.time() * 1000)
    params = [
        (
            series_id,
            r["value_date"],
            r.get("publish_date") or r["value_date"],
            float(r["value"]),
            int(r.get("vintage", 0)),
            source,
            now_ms,
        )
        for r in rows
    ]
    with _db.transaction() as conn:
        conn.executemany(
            """
            INSERT INTO series_observations
              (series_id, value_date, publish_date, value, vintage, source, ingested_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(series_id, value_date, vintage) DO UPDATE SET
              publish_date = excluded.publish_date,
              value        = excluded.value,
              source       = excluded.source,
              ingested_at  = excluded.ingested_at
            """,
            params,
        )
    return len(rows)


def _as_iso(d: str | Date | None) -> str | None:
    if d is None:
        return None
    if hasattr(d, "isoformat"):
        return d.isoformat()
    return str(d)


def read_series(series_id: str, as_of: str | Date | None = None) -> float | None:
    """
    PIT 读取：series_id 在 as_of 时刻的最新可见值。
    - as_of=None: 读"现在"最新值（不限 publish_date）
    - 同 value_date 多 vintage 取最新发布的
    """
    conn = _db._get_conn()
    if as_of is None:
        row = conn.execute(
            """
            SELECT value FROM series_observations
            WHERE series_id = ?
            ORDER BY value_date DESC, vintage DESC
            LIMIT 1
            """,
            (series_id,),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT value FROM series_observations
            WHERE series_id = ? AND publish_date <= ?
            ORDER BY value_date DESC, vintage DESC
            LIMIT 1
            """,
            (series_id, _as_iso(as_of)),
        ).fetchone()
    return row["value"] if row else None


def read_series_history(
    series_id: str, as_of: str | Date | None = None,
) -> pd.Series:
    """
    PIT 历史曲线：每个 value_date 取最新（满足 publish_date<=as_of 的）vintage。
    Index = value_date (str)，value = float。空时返回空 Series。
    """
    conn = _db._get_conn()
    if as_of is None:
        rows = conn.execute(
            """
            SELECT value_date, value FROM series_observations o1
            WHERE series_id = ?
              AND vintage = (
                SELECT MAX(vintage) FROM series_observations o2
                WHERE o2.series_id = o1.series_id
                  AND o2.value_date = o1.value_date
              )
            ORDER BY value_date
            """,
            (series_id,),
        ).fetchall()
    else:
        as_of_str = _as_iso(as_of)
        rows = conn.execute(
            """
            SELECT value_date, value FROM series_observations o1
            WHERE series_id = ? AND publish_date <= ?
              AND vintage = (
                SELECT MAX(vintage) FROM series_observations o2
                WHERE o2.series_id = o1.series_id
                  AND o2.value_date = o1.value_date
                  AND o2.publish_date <= ?
              )
            ORDER BY value_date
            """,
            (series_id, as_of_str, as_of_str),
        ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    return pd.Series(
        [r["value"] for r in rows],
        index=[r["value_date"] for r in rows],
        dtype=float,
    )


def upsert_factor_value(
    factor_id: str,
    market: str,
    value_date: str | Date,
    *,
    raw_value: float | None,
    percentile: float | None,
    calc_version: str = "v1",
) -> None:
    """写一条因子值（市场层面）。同 (factor_id, market, value_date, calc_version) 覆盖。"""
    if hasattr(value_date, "isoformat"):
        value_date = value_date.isoformat()
    now_ms = int(time.time() * 1000)
    with _db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO factor_values
              (factor_id, market, value_date, raw_value, percentile, calc_version, computed_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(factor_id, market, value_date, calc_version) DO UPDATE SET
              raw_value   = excluded.raw_value,
              percentile  = excluded.percentile,
              computed_at = excluded.computed_at
            """,
            (factor_id, market, value_date, raw_value, percentile, calc_version, now_ms),
        )


# ── 分位数标准化 ─────────────────────────────────────────
def to_percentile(
    series: pd.Series,
    window: int | None = None,
    min_periods: int = 252,
) -> float | None:
    """
    把 series 最后一个值映射到滚动历史分位（0-100）。

    window=None 用全样本；否则用最近 window 个观测做基准窗口。
    样本不足 min_periods 返回 None。
    分位定义: rank = (#less + 0.5*#equal + 0.5) / n，避免边界 0/100。
    """
    if series is None or series.empty:
        return None
    s = series.dropna()
    if len(s) < min_periods:
        return None
    if window is not None:
        s = s.iloc[-window:]
        if len(s) < min_periods:
            return None
    last = s.iloc[-1]
    n = len(s)
    rank = float((s < last).sum() + 0.5 * (s == last).sum() + 0.5)
    pct = rank / n * 100
    return max(0.0, min(100.0, pct))
