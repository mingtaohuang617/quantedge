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
    # 分位方向解读（决定 L3 子分聚合时的方向标准化）
    #   "higher_bullish": 高分位=利好（如 ERP、Fed 扩表、200MA 占比高）
    #   "lower_bullish":  低分位=利好（如 PE、CAPE、HY 利差、VIX）
    #   "neutral":        无明确方向（如美元、货币供应同比 — 视情形）
    direction: str = "neutral"
    # 极端区（<10% 或 >90%）反向：用于 VIX/SKEW/信用利差等
    # 恐慌/贪婪指标。中间区按 direction 处理，极端区做 contrarian 翻转。
    contrarian_at_extremes: bool = False


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
    direction: str = "neutral",
    contrarian_at_extremes: bool = False,
):
    """因子注册装饰器。direction ∈ {'higher_bullish','lower_bullish','neutral'}。"""
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
            direction=direction,
            contrarian_at_extremes=contrarian_at_extremes,
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


# ── L3/L5 综合评分 ───────────────────────────────────────
# 类别权重（"周期判断"用途；短期择时另设一套权重 — Phase 2 加）
COMPOSITE_WEIGHTS: dict[str, float] = {
    "valuation": 0.30,
    "liquidity": 0.30,
    "sentiment": 0.20,
    "breadth":   0.20,
}


def directional_score(
    percentile: float | None,
    direction: str,
    contrarian_at_extremes: bool = False,
) -> float | None:
    """
    把 0-100 分位映射为方向化的牛熊分（0=极端熊, 100=极端牛）。

    基础映射:
      "lower_bullish"  → 100 - p（PE/CAPE/Buffett 这类单调因子）
      "higher_bullish" → p     （ERP/200MA 占比这类）
      "neutral"        → p
    contrarian_at_extremes:
      若 True，且 p < 10 或 p > 90，再做一次 100-x 翻转。
      用于 VIX/SKEW/信用利差等恐慌/贪婪指标——
      正常区跟趋势（lower_bullish），极端区反向（panic=买点 / complacency=卖点）。
    """
    if percentile is None:
        return None
    p = float(percentile)
    if direction == "lower_bullish":
        base = 100.0 - p
    else:
        base = p
    if contrarian_at_extremes and (p < 10 or p > 90):
        base = 100.0 - base
    return base


def to_percentile_series(
    series: pd.Series,
    window: int | None = None,
    min_periods: int = 252,
) -> pd.Series:
    """每个时点对应的滚动历史分位（0-100）。空值/样本不足处为 NaN。"""
    if series is None or series.empty:
        return pd.Series(dtype=float)
    s = series.dropna().astype(float)
    if len(s) < min_periods:
        return pd.Series(dtype=float)
    if window is None:
        # 全样本扩张分位
        return s.expanding(min_periods=min_periods).rank(pct=True) * 100
    return s.rolling(window=window, min_periods=min_periods).rank(pct=True) * 100


def compute_composite_history(
    market: str = "US",
    start: str = "2020-01-01",
    end: str | None = None,
) -> dict:
    """
    每个交易日计算 composite —— 对所有 17 因子做向量化 rolling percentile，
    再做方向化 + 类内平均 + 顶层加权。

    返回 {dates, market_temperature, by_category, benchmark}。
    monthly/quarterly 因子在日轴上 forward-fill。
    """
    end_dt = pd.Timestamp(end) if end else pd.Timestamp.now().normalize()
    target = pd.bdate_range(start=start, end=end_dt)

    # 1. 收集每个因子的方向化 rolling percentile（统一对齐到 target 业务日轴）
    cat_panels: dict[str, list[pd.Series]] = {}
    for spec in _REGISTRY.values():
        if market not in spec.markets:
            continue
        hist = spec.func()
        if hist.empty:
            continue
        hist.index = pd.to_datetime(hist.index)
        hist = hist[~hist.index.duplicated(keep="last")].sort_index()
        pct_s = to_percentile_series(hist, window=spec.rolling_window_days)
        if pct_s.empty:
            continue
        # 方向化：lower_bullish 翻转
        if spec.direction == "lower_bullish":
            base = 100.0 - pct_s
        else:
            base = pct_s.copy()
        # 极端区反向（VIX/SKEW/信用利差）：<10 或 >90 时再翻
        if spec.contrarian_at_extremes:
            extreme = (pct_s < 10) | (pct_s > 90)
            base = base.where(~extreme, 100.0 - base)
        # 对齐到 target 日轴：先 union 排序，再 ffill，再 reindex
        merged = base.reindex(base.index.union(target)).sort_index().ffill()
        pct_aligned = merged.reindex(target)
        cat_panels.setdefault(spec.category, []).append(pct_aligned.rename(spec.factor_id))

    # 2. 类内平均 → 子分时间序列
    sub_scores: dict[str, pd.Series] = {}
    for cat, lst in cat_panels.items():
        df = pd.concat(lst, axis=1)
        sub_scores[cat] = df.mean(axis=1, skipna=True)

    # 3. 顶层加权（按出现的类的权重归一化）
    composite_df = pd.DataFrame(sub_scores)
    weighted = pd.Series(0.0, index=composite_df.index)
    weight_sum = pd.Series(0.0, index=composite_df.index)
    for cat, w in COMPOSITE_WEIGHTS.items():
        if cat in composite_df.columns:
            col = composite_df[cat]
            mask = col.notna()
            weighted = weighted + col.where(mask, 0.0) * w
            weight_sum = weight_sum + mask.astype(float) * w
    market_temp = (weighted / weight_sum.where(weight_sum > 0)).round(2)

    # 4. 基准走势：用 ^W5000 收盘做参照（用户已 sync）
    bench = pd.Series(dtype=float)
    try:
        wil = read_series_history("US_W5000_RAW", as_of=None)
        if not wil.empty:
            wil.index = pd.to_datetime(wil.index)
            wil = wil[~wil.index.duplicated(keep="last")].sort_index()
            bench = wil.reindex(wil.index.union(target)).sort_index().ffill().reindex(target)
    except Exception:
        pass

    # 序列化
    dates = [d.strftime("%Y-%m-%d") for d in composite_df.index]
    out_cats = {cat: [None if pd.isna(v) else round(float(v), 2) for v in s.tolist()]
                for cat, s in sub_scores.items()}

    return {
        "market": market,
        "start": start,
        "end": end_dt.strftime("%Y-%m-%d"),
        "weights": dict(COMPOSITE_WEIGHTS),
        "dates": dates,
        "market_temperature": [None if pd.isna(v) else round(float(v), 2)
                               for v in market_temp.tolist()],
        "by_category": out_cats,
        "benchmark": {
            "series_id": "US_W5000_RAW",
            "values": [None if pd.isna(v) else round(float(v), 2)
                       for v in bench.tolist()] if not bench.empty else [],
        },
    }


def compute_composite(market: str = "US") -> dict:
    """
    L3 + L5：基于已注册因子和最近 factor_values 计算每类子分 + 顶层"市场温度"。
    """
    conn = _db._get_conn()
    by_cat: dict[str, dict] = {}

    for spec in _REGISTRY.values():
        if market not in spec.markets:
            continue
        row = conn.execute(
            "SELECT value_date, raw_value, percentile FROM factor_values "
            "WHERE factor_id=? AND market=? ORDER BY value_date DESC LIMIT 1",
            (spec.factor_id, market),
        ).fetchone()
        pct = row["percentile"] if row else None
        ds = directional_score(pct, spec.direction, spec.contrarian_at_extremes)
        cat_info = by_cat.setdefault(spec.category, {"factors": []})
        cat_info["factors"].append({
            "factor_id": spec.factor_id,
            "name": spec.name,
            "direction": spec.direction,
            "contrarian_at_extremes": spec.contrarian_at_extremes,
            "percentile": pct,
            "directional_score": ds,
            "raw_value": row["raw_value"] if row else None,
            "value_date": row["value_date"] if row else None,
        })

    # 类内平均（去 None）→ 子分
    for cat, info in by_cat.items():
        scores = [f["directional_score"] for f in info["factors"] if f["directional_score"] is not None]
        info["score"] = round(sum(scores) / len(scores), 1) if scores else None
        info["factor_count"] = len(info["factors"])

    # 顶层加权（用归一化权重，避免缺失类被低估）
    ws, ss = 0.0, 0.0
    for cat, w in COMPOSITE_WEIGHTS.items():
        info = by_cat.get(cat)
        if info and info["score"] is not None:
            ss += info["score"] * w
            ws += w
    market_temp = round(ss / ws, 1) if ws > 0 else None

    return {
        "market": market,
        "market_temperature": market_temp,
        "weights": dict(COMPOSITE_WEIGHTS),
        "by_category": by_cat,
    }


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
