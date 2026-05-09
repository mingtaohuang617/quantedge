"""
factors_lib.composite — L3 子分 + L5 顶层市场温度计算

两个对外函数：
  - compute_composite(market) → 当前快照（含 alerts / hmm / survival）
  - compute_composite_history(market, start, end) → 历史时序（5Y window 默认）

依赖 core.py 的注册器/PIT/分位工具，以及 regime/* 模块（lazy import）。
"""
from __future__ import annotations

import pandas as pd

from .core import (
    _REGISTRY,
    COMPOSITE_WEIGHTS,
    directional_score,
    read_series_history,
    to_percentile_series,
)
import db as _db


def compute_composite_history(
    market: str = "US",
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """
    每个交易日计算 composite。start 缺省 = 5 年前（snapshot 体积考虑）。
    返回 {dates, market_temperature, by_category, benchmark, regimes, hmm_history}。
    """
    end_dt = pd.Timestamp(end) if end else pd.Timestamp.now().normalize()
    if start is None:
        start = (end_dt - pd.DateOffset(years=5)).strftime("%Y-%m-%d")
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
        mp = {"monthly": 60, "weekly": 156}.get(spec.freq, 252)
        pct_s = to_percentile_series(hist, window=spec.rolling_window_days, min_periods=mp)
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

    # 4. 基准走势：用 ^W5000 收盘做参照
    bench = pd.Series(dtype=float)
    wil_full = pd.Series(dtype=float)  # 全历史，给 regime 标注用
    try:
        wil = read_series_history("US_W5000_RAW", as_of=None)
        if not wil.empty:
            wil.index = pd.to_datetime(wil.index)
            wil = wil[~wil.index.duplicated(keep="last")].sort_index()
            wil_full = wil.copy()
            bench = wil.reindex(wil.index.union(target)).sort_index().ffill().reindex(target)
    except Exception:
        pass

    # 5. 牛熊 regime 段（Lunde-Timmermann 20% 阈值）+ 当前 regime
    regime_segs: list[dict] = []
    current_regime: str | None = None
    if not wil_full.empty:
        try:
            from regime import label_bull_bear, regime_segments
            from regime.bull_bear import annotate_returns
            labeled = label_bull_bear(wil_full, threshold=0.20)
            regime_segs = annotate_returns(wil_full, regime_segments(labeled))
            # 把段裁到 target 区间内（保留与显示窗口重叠的）
            start_str = pd.Timestamp(start).strftime("%Y-%m-%d")
            end_str = end_dt.strftime("%Y-%m-%d")
            regime_segs = [s for s in regime_segs if s["end"] >= start_str and s["start"] <= end_str]
            if not labeled.empty:
                current_regime = str(labeled["regime"].iloc[-1])
        except Exception:
            pass

    # 序列化
    dates = [d.strftime("%Y-%m-%d") for d in composite_df.index]
    out_cats = {cat: [None if pd.isna(v) else round(float(v), 1) for v in s.tolist()]
                for cat, s in sub_scores.items()}

    # 6. HMM 三态历史概率（与 target 业务日轴对齐）
    hmm_hist: dict[str, list] = {"bull": [], "neutral": [], "bear": []}
    try:
        if not wil_full.empty:
            from regime.hmm_states import fit_hmm_3state_cached
            hmm = fit_hmm_3state_cached(wil_full, seed=42)
            probs_df = hmm.get("probs")
            if probs_df is not None:
                for col_label in ["bull", "neutral", "bear"]:
                    s = probs_df[f"{col_label}_prob"]
                    aligned = s.reindex(s.index.union(target)).sort_index().ffill().reindex(target)
                    hmm_hist[col_label] = [None if pd.isna(v) else round(float(v), 3)
                                            for v in aligned.tolist()]
    except Exception:
        pass

    return {
        "market": market,
        "start": start,
        "end": end_dt.strftime("%Y-%m-%d"),
        "weights": dict(COMPOSITE_WEIGHTS),
        "dates": dates,
        "market_temperature": [None if pd.isna(v) else round(float(v), 1)
                               for v in market_temp.tolist()],
        "by_category": out_cats,
        "benchmark": {
            "series_id": "US_W5000_RAW",
            "values": [None if pd.isna(v) else round(float(v), 2)
                       for v in bench.tolist()] if not bench.empty else [],
        },
        "regimes": regime_segs,
        "current_regime": current_regime,
        "hmm_history": hmm_hist,
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

    out = {
        "market": market,
        "market_temperature": market_temp,
        "weights": dict(COMPOSITE_WEIGHTS),
        "by_category": by_cat,
    }
    # L5 顶底双重确认告警（基于本快照即席评估）
    try:
        from regime import compute_alerts
        out["alerts"] = compute_alerts(out)
    except Exception:
        out["alerts"] = []
    # L4 HMM 三态识别（牛/熊/震荡）— 价格行为视角，与 L3 温度互为对照
    try:
        from regime.hmm_states import fit_hmm_3state_cached, compute_hmm_bb_confusion
        wil = read_series_history("US_W5000_RAW", as_of=None)
        if not wil.empty:
            wil.index = pd.to_datetime(wil.index)
            hmm = fit_hmm_3state_cached(wil, seed=42)
            out["hmm"] = {
                "current": hmm["current"],
                "state_means_annual_pct": hmm["state_means_annual_pct"],
                "state_vols_annual_pct": hmm["state_vols_annual_pct"],
                "transition_matrix": hmm["transition_matrix"],
                "transition_labels": hmm["transition_labels"],
                "n_obs": hmm["n_obs"],
            }
            # HMM vs Bry-Boschan 一致性（验证 HMM 学到了对的东西）
            try:
                out["hmm"]["vs_bb"] = compute_hmm_bb_confusion(wil, seed=42)
            except Exception:
                pass
    except Exception as e:
        out["hmm"] = {"error": str(e)}

    # 持续期预测（Kaplan-Meier on Bry-Boschan 段）
    try:
        from regime import label_bull_bear, regime_segments, compute_survival_summary
        from regime.bull_bear import annotate_returns
        wil = read_series_history("US_W5000_RAW", as_of=None)
        if not wil.empty:
            wil.index = pd.to_datetime(wil.index)
            wil = wil[~wil.index.duplicated(keep="last")].sort_index()
            labeled = label_bull_bear(wil, threshold=0.20)
            segs = annotate_returns(wil, regime_segments(labeled))
            if segs:
                last = segs[-1]
                summary = compute_survival_summary(segs, last["regime"], int(last["days"]))
                out["survival"] = summary
    except Exception as e:
        out["survival"] = {"error": str(e)}

    return out
