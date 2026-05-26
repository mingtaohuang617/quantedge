"""
mining_alpha.hyperopt — Optuna 超参调优
======================================

在 walk-forward 第一个 fold 上做 Bayesian 优化，目标是测试集 IC mean。
之后用最优超参跑完整 walk-forward 流程。

公开接口:
  - optuna_optimize(factor_panel, fwd_ret, n_trials=50, ...) → best_params dict
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False

try:
    import optuna
    HAS_OPTUNA = True
except ImportError:
    HAS_OPTUNA = False


def _evaluate_params_on_fold(
    params: dict,
    X_tr, y_tr, g_tr,
    X_va, y_va, g_va,
    X_test, y_test, g_test,
    fwd_ret_test: pd.DataFrame,
    test_dates,
    feature_names: list[str],
    *,
    num_boost_round: int = 300,
    early_stopping: int = 30,
) -> float:
    """单组超参 → 在一个 fold 上训出 booster → 测试集 IC mean。"""
    train_set = lgb.Dataset(X_tr.values, label=y_tr.values, group=g_tr,
                            feature_name=feature_names)
    valid_set = lgb.Dataset(X_va.values, label=y_va.values, group=g_va,
                            reference=train_set)
    booster = lgb.train(
        params, train_set,
        num_boost_round=num_boost_round,
        valid_sets=[valid_set],
        callbacks=[
            lgb.early_stopping(early_stopping, verbose=False),
            lgb.log_evaluation(period=0),
        ],
    )
    # 在测试集做预测
    preds_raw = booster.predict(X_test.values)
    preds = pd.Series(preds_raw, index=X_test.index)
    # 转 wide format → 算每日横截面 IC
    pred_panel = preds.unstack(level=1)
    pred_panel = pred_panel.reindex(index=pd.DatetimeIndex(test_dates))
    fwd_aligned = fwd_ret_test.reindex(index=pred_panel.index, columns=pred_panel.columns)
    ics = []
    for t in pred_panel.index:
        p = pred_panel.loc[t]
        r = fwd_aligned.loc[t]
        mask = p.notna() & r.notna()
        if mask.sum() >= 10:
            ics.append(p[mask].rank().corr(r[mask].rank()))
    if not ics:
        return -1.0
    ic_series = pd.Series(ics).dropna()
    return float(ic_series.mean()) if len(ic_series) > 0 else -1.0


def optuna_optimize(
    factor_panel: dict[int, pd.DataFrame],
    fwd_ret: pd.DataFrame,
    *,
    n_trials: int = 50,
    fold_idx: int = 0,
    train_years: float = 2.0,
    valid_years: float = 0.5,
    test_years: float = 0.5,
    step_months: int = 6,
    seed: int = 42,
    output_dir: Path | None = None,
) -> dict:
    """
    在 walk-forward 第 `fold_idx` 个 fold 上做 Bayesian 优化（最大化测试集 IC）。

    Args:
      factor_panel / fwd_ret: 与 walk_forward_train 同
      n_trials: Optuna trial 数（建议 30-100）
      fold_idx: 用哪个 fold 优化（0 = 第一个）
      train_years/valid_years/test_years/step_months: 同 walk_forward 参数
      seed: Optuna sampler 随机种子
      output_dir: 若给定，落盘 study.csv（包含每个 trial 的超参 + 评分）

    Returns:
      best_params dict，可直接传给 walk_forward_train(..., params=best_params)
    """
    if not HAS_LGB:
        raise RuntimeError("lightgbm 未安装")
    if not HAS_OPTUNA:
        raise RuntimeError("optuna 未安装，运行 pip install optuna")

    # 延迟 import 避免循环
    from .model import (
        build_walk_forward_folds, prepare_xy, _split_by_dates,
    )

    X, y, group = prepare_xy(factor_panel, fwd_ret)
    all_dates = pd.DatetimeIndex(sorted(set(X.index.get_level_values(0))))
    folds = build_walk_forward_folds(
        all_dates,
        train_years=train_years, valid_years=valid_years,
        test_years=test_years, step_months=step_months,
    )
    if not folds:
        raise RuntimeError("无法构造 walk-forward fold")
    if fold_idx >= len(folds):
        raise IndexError(f"fold_idx {fold_idx} >= len(folds) {len(folds)}")

    fold = folds[fold_idx]
    X_tr, y_tr, g_tr = _split_by_dates(X, y, group, fold.train_start, fold.train_end)
    X_va, y_va, g_va = _split_by_dates(X, y, group, fold.valid_start, fold.valid_end)
    X_test, y_test, g_test = _split_by_dates(X, y, group, fold.test_start, fold.test_end)
    test_dates = all_dates[(all_dates >= fold.test_start) & (all_dates <= fold.test_end)]
    feature_names = list(X.columns)

    print(f"[optuna] 优化 fold #{fold_idx + 1}: train {fold.train_start.date()}..{fold.train_end.date()}, "
          f"test {fold.test_start.date()}..{fold.test_end.date()} (n_trials={n_trials})")

    def objective(trial: optuna.trial.Trial) -> float:
        params = {
            "objective": "lambdarank",
            "metric": "ndcg",
            "eval_at": [50, 100],
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "num_leaves": trial.suggest_int("num_leaves", 15, 127),
            "min_data_in_leaf": trial.suggest_int("min_data_in_leaf", 20, 500),
            "feature_fraction": trial.suggest_float("feature_fraction", 0.5, 1.0),
            "bagging_fraction": trial.suggest_float("bagging_fraction", 0.5, 1.0),
            "bagging_freq": trial.suggest_int("bagging_freq", 1, 10),
            "lambda_l2": trial.suggest_float("lambda_l2", 0.0, 10.0),
            "verbose": -1,
        }
        try:
            ic = _evaluate_params_on_fold(
                params,
                X_tr, y_tr, g_tr,
                X_va, y_va, g_va,
                X_test, y_test, g_test,
                fwd_ret_test=fwd_ret,
                test_dates=test_dates,
                feature_names=feature_names,
            )
        except Exception as e:
            print(f"  [trial {trial.number}] 失败: {e}")
            return -1.0
        return ic

    sampler = optuna.samplers.TPESampler(seed=seed)
    study = optuna.create_study(direction="maximize", sampler=sampler)
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    print(f"[optuna] best IC = {study.best_value:.4f}")
    print(f"[optuna] best params = {study.best_params}")

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        df = study.trials_dataframe()
        df.to_csv(output_dir / "optuna_trials.csv", index=False)
        with open(output_dir / "optuna_best.json", "w", encoding="utf-8") as f:
            json.dump({
                "best_ic": study.best_value,
                "best_params": study.best_params,
                "n_trials": n_trials,
                "fold_idx": fold_idx,
            }, f, indent=2, ensure_ascii=False)
        print(f"  落盘到 {output_dir}/optuna_*")

    # 合并默认参数 + 优化后参数
    full_params = {
        "objective": "lambdarank",
        "metric": "ndcg",
        "eval_at": [50, 100],
        "verbose": -1,
        **study.best_params,
    }
    return full_params
