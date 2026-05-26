"""
mining_alpha.model — LightGBM LambdaRank + walk-forward 训练
========================================================

设计:
  - Label: 横截面前瞻 N 日收益的 rank（每日 0..N-1，归一化到 [0, 1]）
       横截面 rank label 对 regime shift 鲁棒（牛/熊市绝对收益分布不同但 rank 一致）
  - Features: 通过 IC 初筛的因子（已 preprocess: winsorize+zscore）
  - Model: LightGBM LambdaRank（learning-to-rank, NDCG@50 优化）
       比 GBDT regressor 更适合"选股 Top K"任务

  - CV: walk-forward — 训练 2 年，验证 0.5 年，测试 0.5 年，每 6 个月 refit 一次
  - 不用 k-fold（横截面+时间序列，k-fold 会数据泄漏）

公开接口:
  - prepare_xy(factor_panel: dict, fwd_ret, label_horizon=5) → X, y, group
  - WalkForwardCV(train_years, valid_years, test_years, step_months) — 折叠迭代器
  - train_one_fold(X, y, group, train_idx, valid_idx, params=None) → 训好的 booster
  - predict_panel(model, factors, dates) → dates × tickers 预测分数
  - walk_forward_train(factor_panel, fwd_ret, ...) → list[(model, fold_meta)]
"""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable

import pandas as pd

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False


# ── 默认超参 ─────────────────────────────────────────────────
DEFAULT_LGB_PARAMS = {
    "objective": "lambdarank",
    "metric": "ndcg",
    "eval_at": [50, 100],
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 100,
    "feature_fraction": 0.85,
    "bagging_fraction": 0.85,
    "bagging_freq": 5,
    "lambda_l2": 1.0,
    "verbose": -1,
}

DEFAULT_NUM_BOOST_ROUND = 500
DEFAULT_EARLY_STOPPING = 50


# ── 数据准备 ──────────────────────────────────────────────────


def prepare_xy(
    factor_panel: dict[int, pd.DataFrame],
    fwd_ret: pd.DataFrame,
    *,
    label_buckets: int | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """
    把因子 panel + 前瞻收益转成 LightGBM 训练用的 long-format X / y / group。

    Args:
      factor_panel: {alpha_num: factor_df (preprocessed)}
      fwd_ret: 前瞻收益 dates × tickers
      label_buckets: 把每日 rank 分到 [0, label_buckets-1] 个等距桶。
        None = 自动用每日实际票数（即用原始 rank 0..n-1 作为 label）。
        LightGBM ranker 要求 label 是连续小整数，所以 buckets 不能太大。

    Returns:
      X: long-format DataFrame, index=MultiIndex(date, ticker), columns=alpha_N
      y: int label, 0..label_buckets-1（或 0..n_daily-1 if buckets=None）
      group: 每日票数列表（按 date 升序），LightGBM ranker 必需

    NaN 处理: 任一因子或 fwd_ret 为 NaN 的 (date, ticker) 整行剔除。
    """
    long_frames = []
    for num, df in factor_panel.items():
        s = df.stack().rename(f"alpha_{num}")
        long_frames.append(s)
    X_long = pd.concat(long_frames, axis=1)
    fwd_long = fwd_ret.stack().rename("fwd_ret")
    df = pd.concat([X_long, fwd_long], axis=1).dropna()
    if df.empty:
        raise RuntimeError("prepare_xy: 拼接后所有行都是 NaN，检查 factor / fwd_ret 对齐")

    df = df.sort_index(level=0)

    # 每日横截面 rank label：
    #   - label_buckets=None: 用 0..n_daily-1 整数（dense）
    #   - 否则: 等距分到 [0, label_buckets-1]，但只取实际存在的桶值
    def _to_bucket(group_, buckets):
        ranks = group_.rank(method="first").astype(int) - 1  # 0..n-1, 整数无并列
        if buckets is None:
            return ranks
        n = len(group_)
        scaled = (ranks / max(n - 1, 1) * (buckets - 1)).round().astype(int)
        return scaled

    y = df.groupby(level=0, group_keys=False)["fwd_ret"].apply(
        lambda g: _to_bucket(g, label_buckets)
    )
    X = df.drop(columns=["fwd_ret"])

    group_sizes = df.index.get_level_values(0).value_counts().sort_index().tolist()

    return X, y, pd.Series(group_sizes, name="group")


# ── Walk-forward 折叠 ────────────────────────────────────────


@dataclass
class FoldSpec:
    """单个 walk-forward fold 的边界（日期闭区间）。"""
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    valid_start: pd.Timestamp
    valid_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp


def build_walk_forward_folds(
    all_dates: pd.DatetimeIndex,
    *,
    train_years: float = 2.0,
    valid_years: float = 0.5,
    test_years: float = 0.5,
    step_months: int = 6,
) -> list[FoldSpec]:
    """
    在给定日期序列上构造 walk-forward folds。

    每个 fold:
      [train_start, train_end] ∥ [valid_start, valid_end] ∥ [test_start, test_end]
    依次平移 step_months。
    """
    min_required = int((train_years + valid_years + test_years) * 252) + 10
    if len(all_dates) < min_required:
        raise ValueError(
            f"日期太短: {len(all_dates)}，至少需 {min_required} 个交易日"
            f"（train+valid+test = {train_years + valid_years + test_years:.2f} 年）"
        )
    first = pd.Timestamp(all_dates.min())
    last = pd.Timestamp(all_dates.max())

    folds: list[FoldSpec] = []
    cursor = first
    delta_train = pd.Timedelta(days=int(train_years * 365.25))
    delta_valid = pd.Timedelta(days=int(valid_years * 365.25))
    delta_test = pd.Timedelta(days=int(test_years * 365.25))
    step = pd.DateOffset(months=step_months)

    while True:
        train_start = cursor
        train_end = train_start + delta_train
        valid_start = train_end + pd.Timedelta(days=1)
        valid_end = valid_start + delta_valid
        test_start = valid_end + pd.Timedelta(days=1)
        test_end = test_start + delta_test
        if test_end > last:
            break
        folds.append(FoldSpec(train_start, train_end, valid_start, valid_end,
                              test_start, test_end))
        cursor = cursor + step
    return folds


def _split_by_dates(
    X: pd.DataFrame, y: pd.Series, group: pd.Series,
    start: pd.Timestamp, end: pd.Timestamp,
) -> tuple[pd.DataFrame, pd.Series, list[int]]:
    """按日期切片，返回 X_slice / y_slice / group_sizes。"""
    dates = X.index.get_level_values(0)
    mask = (dates >= start) & (dates <= end)
    X_s = X[mask]
    y_s = y[mask]
    # group sizes by date
    g = X_s.index.get_level_values(0).value_counts().sort_index().tolist()
    return X_s, y_s, g


# ── 训练一个 fold ────────────────────────────────────────────


def train_one_fold(
    X: pd.DataFrame, y: pd.Series, group: pd.Series,
    fold: FoldSpec,
    *,
    params: dict | None = None,
    num_boost_round: int = DEFAULT_NUM_BOOST_ROUND,
    early_stopping: int = DEFAULT_EARLY_STOPPING,
):
    """
    在单 fold 上训练 LightGBM LambdaRank。

    Returns:
      booster, 训练实际轮数。
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装，运行 pip install lightgbm")

    p = {**DEFAULT_LGB_PARAMS, **(params or {})}

    X_tr, y_tr, g_tr = _split_by_dates(X, y, group, fold.train_start, fold.train_end)
    X_va, y_va, g_va = _split_by_dates(X, y, group, fold.valid_start, fold.valid_end)
    if X_tr.empty or X_va.empty:
        raise RuntimeError(f"fold 训练/验证集为空: {fold}")

    train_set = lgb.Dataset(X_tr.values, label=y_tr.values, group=g_tr,
                            feature_name=list(X.columns))
    valid_set = lgb.Dataset(X_va.values, label=y_va.values, group=g_va,
                            reference=train_set)

    booster = lgb.train(
        p,
        train_set,
        num_boost_round=num_boost_round,
        valid_sets=[valid_set],
        callbacks=[
            lgb.early_stopping(early_stopping, verbose=False),
            lgb.log_evaluation(period=0),
        ],
    )
    return booster, booster.best_iteration


# ── 预测 ─────────────────────────────────────────────────────


def predict_panel(
    booster,
    factor_panel: dict[int, pd.DataFrame],
    feature_names: list[str],
    dates: Iterable[pd.Timestamp] | None = None,
) -> pd.DataFrame:
    """
    给训好的 booster + 因子 panel，输出 dates × tickers 的预测分数。

    Args:
      booster: lightgbm Booster
      factor_panel: {alpha_num: factor_df}
      feature_names: 训练时的 feature 名称顺序（一定要和训练对齐）
      dates: 限定预测的日期；None=用 panel 全部日期

    Returns:
      pd.DataFrame, dates × tickers，分数越高排名越靠前。
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装")
    # 把 factor_panel 转 long-format，对齐 feature_names
    longs = []
    for fname in feature_names:
        num = int(fname.replace("alpha_", ""))
        df = factor_panel[num]
        if dates is not None:
            df = df.reindex(index=pd.DatetimeIndex(dates))
        longs.append(df.stack().rename(fname))
    X = pd.concat(longs, axis=1).dropna()
    if X.empty:
        # 全部 NaN，返回空 panel
        sample_df = next(iter(factor_panel.values()))
        return pd.DataFrame(index=sample_df.index, columns=sample_df.columns, dtype=float)

    preds = booster.predict(X.values)
    s = pd.Series(preds, index=X.index, name="score")
    pred_panel = s.unstack(level=1)
    return pred_panel


# ── Walk-forward 主流程 ──────────────────────────────────────


@dataclass
class FoldResult:
    fold: FoldSpec
    booster: object  # lightgbm.Booster
    best_iter: int
    test_predictions: pd.DataFrame  # dates × tickers
    feature_importance: pd.Series
    test_ic_mean: float = float("nan")   # 测试集上的横截面 IC 均值
    test_ic_ir: float = float("nan")     # 测试集上的 IC IR（年化）


def walk_forward_train(
    factor_panel: dict[int, pd.DataFrame],
    fwd_ret: pd.DataFrame,
    *,
    train_years: float = 2.0,
    valid_years: float = 0.5,
    test_years: float = 0.5,
    step_months: int = 6,
    label_buckets: int | None = None,
    params: dict | None = None,
    num_boost_round: int = DEFAULT_NUM_BOOST_ROUND,
    early_stopping: int = DEFAULT_EARLY_STOPPING,
) -> list[FoldResult]:
    """
    端到端 walk-forward 训练，返回每个 fold 的结果（含测试集预测）。

    使用方式:
      results = walk_forward_train(factors, fwd_ret)
      all_preds = pd.concat([r.test_predictions for r in results])
      # all_preds 是拼好的测试集分数 panel，可直接给 backtest 用
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装")

    X, y, group = prepare_xy(factor_panel, fwd_ret, label_buckets=label_buckets)
    all_dates = pd.DatetimeIndex(sorted(set(X.index.get_level_values(0))))
    folds = build_walk_forward_folds(
        all_dates,
        train_years=train_years,
        valid_years=valid_years,
        test_years=test_years,
        step_months=step_months,
    )
    if not folds:
        raise RuntimeError(
            f"无法构造任何 fold: 数据范围 {all_dates.min()} ~ {all_dates.max()}, "
            f"需要 train+valid+test = {train_years + valid_years + test_years:.1f} 年"
        )

    results: list[FoldResult] = []
    for i, fold in enumerate(folds):
        print(f"[fold {i+1}/{len(folds)}] train={fold.train_start.date()}..{fold.train_end.date()}, "
              f"valid={fold.valid_start.date()}..{fold.valid_end.date()}, "
              f"test={fold.test_start.date()}..{fold.test_end.date()}")
        booster, best = train_one_fold(
            X, y, group, fold,
            params=params,
            num_boost_round=num_boost_round,
            early_stopping=early_stopping,
        )
        # 拿到测试集日期
        test_dates = all_dates[(all_dates >= fold.test_start) & (all_dates <= fold.test_end)]
        preds = predict_panel(booster, factor_panel, list(X.columns), dates=test_dates)
        # 特征重要性
        fi = pd.Series(
            booster.feature_importance(importance_type="gain"),
            index=X.columns,
            name=f"fold_{i+1}",
        ).sort_values(ascending=False)
        # 测试集 IC（横截面 Spearman 平均）
        test_ic_mean = float("nan")
        test_ic_ir = float("nan")
        try:
            test_fwd_ret = fwd_ret.reindex(index=preds.index, columns=preds.columns)
            ics = []
            for t in preds.index:
                row_p = preds.loc[t]
                row_r = test_fwd_ret.loc[t]
                mask = row_p.notna() & row_r.notna()
                if mask.sum() >= 10:
                    ics.append(row_p[mask].rank().corr(row_r[mask].rank()))
            if ics:
                ic_series = pd.Series(ics).dropna()
                if len(ic_series) > 0:
                    test_ic_mean = float(ic_series.mean())
                    if ic_series.std() > 0:
                        test_ic_ir = float(ic_series.mean() / ic_series.std() * (252 ** 0.5))
        except Exception as e:
            print(f"  [warn] fold {i+1} IC 计算失败: {e}")
        print(f"  test IC mean={test_ic_mean:.4f}, IR={test_ic_ir:.2f}")
        results.append(FoldResult(
            fold=fold, booster=booster, best_iter=best,
            test_predictions=preds, feature_importance=fi,
            test_ic_mean=test_ic_mean, test_ic_ir=test_ic_ir,
        ))
    return results


def aggregate_test_predictions(results: list[FoldResult]) -> pd.DataFrame:
    """
    把所有 fold 的测试集预测拼成连续 panel。

    若 walk-forward step_months < test_years*12 导致测试期重叠，按 fold 顺序后者覆盖前者
    （新模型更可信），避免重复 index 干扰后续 backtest。
    """
    if not results:
        return pd.DataFrame()
    parts = [r.test_predictions for r in results if not r.test_predictions.empty]
    if not parts:
        return pd.DataFrame()
    concat = pd.concat(parts).sort_index()
    # 去重 — 同日期保留最后一次出现（=最新 fold）
    return concat[~concat.index.duplicated(keep="last")]


def aggregate_feature_importance(results: list[FoldResult]) -> pd.DataFrame:
    """所有 fold 的特征重要性合到一张表。"""
    return pd.concat([r.feature_importance for r in results], axis=1)
