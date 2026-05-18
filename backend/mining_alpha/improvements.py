"""
mining_alpha.improvements — 因子改良 / 集成 / 体制感知
======================================================

在原始 Alpha191 之上叠加三类增强：

1. **vol-scaled** — 按滚动波动率归一化。
   原始因子常常被极端波动期主导，volume-scaled 等价于把 alpha 折成 信号 / 风险。

2. **IC-decay 自适应权重** — 把多个因子用最近 IC 加权合成。
   IC 越高的因子越可信；IC 通过半衰期衰减让权重跟得上市场变化。

3. **regime-aware gating** — 用 HMM 三态（牛/熊/震荡）做权重门控。
   不同 regime 下因子有效性差异巨大，分别学权重组合而非全市场单一权重。

公开接口:
  - vol_scale(factor, window=20) → 归一化因子
  - ic_decay_weights(ic_history, half_life=63) → 因子权重时间序列
  - combine_ic_weighted(factor_panel, ic_history, half_life=63) → 合成 score
  - hmm_regime_series(benchmark_close) → 日度 regime label
  - regime_split_train(X, y, group, regime, train_idx, valid_idx, ...) → 每 regime 一个 booster
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False


# ── 1. Vol-scaled ─────────────────────────────────────────────


def vol_scale(factor: pd.DataFrame, window: int = 20, min_periods: int | None = None) -> pd.DataFrame:
    """
    时序波动率归一化:  factor_t / rolling_std(factor, window)_t

    把因子折成 "信号 / 风险" 形式，抑制高波动期的离群冲击。

    Args:
      factor: dates × tickers DataFrame
      window: 滚动 std 窗口
      min_periods: 默认 window // 2

    Returns:
      同形状 DataFrame；std=0 处填 NaN。
    """
    mp = min_periods or max(window // 2, 1)
    rolling_std = factor.rolling(window, min_periods=mp).std()
    safe_std = rolling_std.where(rolling_std > 1e-12)
    return factor / safe_std


# ── 2. IC-decay 自适应权重 ────────────────────────────────────


def ic_decay_weights(
    ic_history: pd.DataFrame,
    *,
    half_life: int = 63,
    min_history: int = 20,
    use_abs: bool = False,
) -> pd.DataFrame:
    """
    根据每个因子的历史 IC 序列计算时变权重。

    每日权重 = EWMA(IC, half_life=h) / sum(|EWMA(IC, h)|) 归一化（保留方向）。
    在 |IC| 小于阈值时给 0 权重，让弱信号自动剔除。

    Args:
      ic_history: index=date, columns=alpha_N，每个 cell 是该日的横截面 IC
      half_life: EWMA 半衰期（交易日）
      min_history: 至少 N 个观测后才开始算权重
      use_abs: True 表示按 |IC| 加权（适合 long-short）；False 保留方向

    Returns:
      pd.DataFrame，index=date，columns=alpha_N，每行权重和绝对值=1（如果有有效 IC）。
    """
    alpha = np.log(2) / half_life  # EWMA decay
    ewma_ic = ic_history.ewm(alpha=alpha, adjust=False, min_periods=min_history).mean()
    if use_abs:
        signed = ewma_ic.abs()
    else:
        signed = ewma_ic
    # 归一化：每行除以本行 |sum|
    abs_sum = signed.abs().sum(axis=1)
    weights = signed.div(abs_sum.replace(0, np.nan), axis=0)
    return weights.fillna(0.0)


def combine_ic_weighted(
    factor_panel: dict[int, pd.DataFrame],
    ic_history: pd.DataFrame,
    *,
    half_life: int = 63,
    standardize_factors: bool = True,
) -> pd.DataFrame:
    """
    用 IC-decay 权重把多个因子合成一个 score panel。

    Args:
      factor_panel: {alpha_num: preprocessed_factor_df}（建议已 z-score）
      ic_history: 每个因子的日 IC 序列（来自 ic_report.daily_ic）
      half_life: IC 衰减半衰期
      standardize_factors: True 则在合成前再做一次横截面 z-score

    Returns:
      dates × tickers DataFrame，合成 alpha score。
    """
    # 把 factor_num 转成 column 名对齐 ic_history（假设 ic_history 列名是整数或字符串数字）
    ic_cols = list(ic_history.columns)
    weights = ic_decay_weights(ic_history, half_life=half_life)

    # 把每个因子按权重加权求和（每日权重不同）
    # 为效率：把 factor_panel 拼成一个 3D ndarray (n_factors, T, N)
    factor_nums = list(factor_panel.keys())
    common_index = None
    common_cols = None
    for df in factor_panel.values():
        common_index = df.index if common_index is None else common_index.intersection(df.index)
        common_cols = df.columns if common_cols is None else common_cols.intersection(df.columns)
    if common_index is None or common_cols is None or len(common_cols) == 0:
        raise RuntimeError("combine_ic_weighted: 因子之间没有共同的 date/ticker")

    def _zscore_row(df: pd.DataFrame) -> pd.DataFrame:
        m = df.mean(axis=1)
        s = df.std(axis=1).replace(0, np.nan)
        return df.sub(m, axis=0).div(s, axis=0).fillna(0.0)

    out = pd.DataFrame(0.0, index=common_index, columns=common_cols)
    for num in factor_nums:
        fdf = factor_panel[num].reindex(index=common_index, columns=common_cols)
        if standardize_factors:
            fdf = _zscore_row(fdf)
        if num in ic_cols:
            w = weights[num].reindex(common_index).fillna(0.0)
            out = out + fdf.mul(w, axis=0)
    return out


# ── 3. Regime-aware ──────────────────────────────────────────


def hmm_regime_series(
    benchmark_close: pd.Series, *, seed: int = 42,
) -> pd.DataFrame:
    """
    用 backend/regime/hmm_states.py 的 HMM，把基准 close 转成 daily regime 概率 + label。

    Returns:
      pd.DataFrame, index=date, columns=['bull_prob','neutral_prob','bear_prob','label']
      label ∈ {'bull','neutral','bear'} (argmax 后的硬分类)
    """
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).resolve().parent.parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    from regime.hmm_states import fit_hmm_3state_cached  # noqa: E402

    fit = fit_hmm_3state_cached(benchmark_close, seed=seed)
    probs = fit["probs"].copy()
    probs.columns = [c if c.endswith("_prob") else c + "_prob" for c in probs.columns]
    probs["label"] = probs[["bull_prob", "neutral_prob", "bear_prob"]].idxmax(axis=1).str.replace("_prob", "", regex=False)
    return probs


def regime_aware_combine(
    factor_panel: dict[int, pd.DataFrame],
    ic_history: pd.DataFrame,
    regime: pd.DataFrame,
    *,
    half_life: int = 63,
) -> pd.DataFrame:
    """
    用 regime hard-label 把因子分别加权再合成。
    每个 regime 独立计算 IC-decay 权重（用该 regime 历史日的 IC 训练）。

    Args:
      factor_panel: {alpha_num: factor_df}
      ic_history: 日 IC 序列
      regime: 含 'label' 列的 DataFrame（regime 标签）
      half_life: IC 衰减半衰期

    Returns:
      dates × tickers 合成 score。当前 regime 的权重根据该 regime 内历史 IC 算出。
    """
    out_parts: list[pd.DataFrame] = []
    common_idx = ic_history.index.intersection(regime.index)
    if common_idx.empty:
        raise RuntimeError("regime_aware_combine: ic_history 与 regime 没有日期交集")

    regime_aligned = regime.reindex(common_idx)
    ic_aligned = ic_history.reindex(common_idx)

    # 对每个 regime 切片 IC，单独算权重，再 reindex 回原日期
    weights_by_regime: dict[str, pd.DataFrame] = {}
    for label in ["bull", "neutral", "bear"]:
        mask = regime_aligned["label"] == label
        if mask.sum() < 20:
            continue
        ic_subset = ic_aligned.loc[mask]
        w = ic_decay_weights(ic_subset, half_life=half_life)
        weights_by_regime[label] = w

    # 对每天，按当日 regime label 选 weights，把因子加权
    combined = pd.DataFrame(
        0.0, index=common_idx,
        columns=next(iter(factor_panel.values())).columns,
    )
    for label, w_df in weights_by_regime.items():
        regime_mask = regime_aligned["label"] == label
        days = common_idx[regime_mask]
        if len(days) == 0:
            continue
        for num in factor_panel.keys():
            if num not in w_df.columns:
                continue
            fdf = factor_panel[num].reindex(index=days, columns=combined.columns)
            # 用最新权重（取该 regime 内最后一日的权重作为该 regime 的稳定权重）
            w_val = float(w_df[num].dropna().iloc[-1]) if not w_df[num].dropna().empty else 0.0
            combined.loc[days] = combined.loc[days].add(fdf * w_val, fill_value=0.0)

    return combined


# ── 体制条件 ML：每 regime 一个 booster ───────────────────────


@dataclass
class RegimeBoosters:
    """三个 booster + regime 概率序列，供 predict 时按当日 regime 加权融合。"""
    boosters: dict[str, object]  # {'bull': booster, 'neutral': ..., 'bear': ...}
    regime_probs: pd.DataFrame   # dates × {bull_prob, neutral_prob, bear_prob}
    feature_names: list[str]


def train_regime_aware_lgb(
    X: pd.DataFrame, y: pd.Series, group: pd.Series,
    regime: pd.DataFrame,
    *,
    params: dict | None = None,
    num_boost_round: int = 300,
) -> RegimeBoosters:
    """
    每个 regime 训一个 LightGBM ranker，预测时按当日 regime 概率加权融合。

    Args:
      X, y, group: 来自 model.prepare_xy 的训练数据
      regime: 含 bull_prob/neutral_prob/bear_prob + label 的 DataFrame（来自
              hmm_regime_series）
      params: lightgbm 参数；None 用 model.DEFAULT_LGB_PARAMS

    Returns:
      RegimeBoosters dataclass。
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装")
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).resolve().parent.parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    from mining_alpha.model import DEFAULT_LGB_PARAMS  # noqa: E402

    p = {**DEFAULT_LGB_PARAMS, **(params or {})}
    dates = X.index.get_level_values(0)
    regime_aligned = regime.reindex(dates.unique())
    boosters: dict[str, object] = {}

    for label in ["bull", "neutral", "bear"]:
        regime_dates = regime_aligned.index[regime_aligned["label"] == label]
        date_mask = dates.isin(regime_dates)
        if date_mask.sum() < 100:
            print(f"  [skip] regime={label} 训练点不足 {date_mask.sum()}")
            continue
        X_r = X[date_mask]
        y_r = y[date_mask]
        # 按 regime 内日期重算 group
        g_r = X_r.index.get_level_values(0).value_counts().sort_index().tolist()
        train_set = lgb.Dataset(X_r.values, label=y_r.values, group=g_r,
                                feature_name=list(X.columns))
        booster = lgb.train(p, train_set, num_boost_round=num_boost_round,
                            callbacks=[lgb.log_evaluation(period=0)])
        boosters[label] = booster
        print(f"  [regime={label}] 训完 {date_mask.sum()} 行")

    return RegimeBoosters(boosters=boosters, regime_probs=regime,
                          feature_names=list(X.columns))


def predict_regime_aware(
    rb: RegimeBoosters,
    factor_panel: dict[int, pd.DataFrame],
    *,
    dates=None,
) -> pd.DataFrame:
    """
    用 RegimeBoosters 做预测：当日预测 = sum_regime(prob × booster_pred)。

    Args:
      rb: RegimeBoosters
      factor_panel: {alpha_num: factor_df}
      dates: 限定预测日期

    Returns:
      dates × tickers 预测 score panel。
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装")
    # 拼 X
    longs = []
    for fname in rb.feature_names:
        num = int(fname.replace("alpha_", ""))
        df = factor_panel[num]
        if dates is not None:
            df = df.reindex(index=pd.DatetimeIndex(dates))
        longs.append(df.stack().rename(fname))
    X = pd.concat(longs, axis=1).dropna()
    if X.empty:
        sample = next(iter(factor_panel.values()))
        return pd.DataFrame(index=sample.index, columns=sample.columns, dtype=float)

    # 每个 regime 用对应 booster 做预测
    pred_by_regime: dict[str, pd.Series] = {}
    for label, b in rb.boosters.items():
        raw = b.predict(X.values)
        pred_by_regime[label] = pd.Series(raw, index=X.index)

    # 按当日 regime 概率加权融合
    final = pd.Series(0.0, index=X.index)
    weight_sum = pd.Series(0.0, index=X.index)
    rp_aligned = rb.regime_probs.reindex(X.index.get_level_values(0))
    for label, pred in pred_by_regime.items():
        prob_col = f"{label}_prob"
        if prob_col not in rp_aligned.columns:
            continue
        prob_vals = rp_aligned[prob_col].fillna(0.0).values
        final += pred * prob_vals
        weight_sum += prob_vals
    # 归一化（应该接近 1，因为三个概率和 = 1）
    final = final / weight_sum.replace(0, np.nan)
    return final.unstack(level=1)
