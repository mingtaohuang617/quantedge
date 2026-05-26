"""
mining_alpha.ensemble — 多模型集成 (LightGBM + XGBoost + CatBoost)
=================================================================

设计:
  - 在同一份 (X, y, group) 上分别训练三个 ranker / regressor
  - 测试集预测做 rank 平均（rank averaging — 比直接 score 平均更鲁棒）
  - 同样的 walk-forward 折叠逻辑

公开接口:
  - train_ensemble_fold(X, y, group, fold, ...) → dict[name, booster]
  - predict_ensemble(boosters, factor_panel, ...) → 三个模型的 rank-mean 预测
  - walk_forward_ensemble(...) → list[EnsembleFoldResult]
"""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable

import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    import catboost as cb
    HAS_CB = True
except ImportError:
    HAS_CB = False


# 默认超参（轻量级，跑得快）
LGB_DEFAULT = {
    "objective": "lambdarank", "metric": "ndcg", "eval_at": [50, 100],
    "learning_rate": 0.05, "num_leaves": 63, "min_data_in_leaf": 100,
    "feature_fraction": 0.85, "bagging_fraction": 0.85, "bagging_freq": 5,
    "lambda_l2": 1.0, "verbose": -1,
}

XGB_DEFAULT = {
    "objective": "rank:ndcg",      # XGBoost LambdaRank
    "eval_metric": "ndcg@50",
    "learning_rate": 0.05,
    "max_depth": 6,
    "min_child_weight": 100,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "reg_lambda": 1.0,
    "tree_method": "hist",
    "verbosity": 0,
}

CB_DEFAULT = {
    "loss_function": "YetiRank",   # CatBoost ranking 损失
    "eval_metric": "NDCG:top=50",
    "learning_rate": 0.05,
    "depth": 6,
    "l2_leaf_reg": 3.0,
    "bagging_temperature": 1.0,
    "verbose": 0,
}


# ── 训练一个 fold 的 3 个模型 ────────────────────────────────


def train_ensemble_fold(
    X: pd.DataFrame, y: pd.Series, group: pd.Series,
    train_dates_mask: np.ndarray,
    valid_dates_mask: np.ndarray,
    *,
    use_lgb: bool = True,
    use_xgb: bool = True,
    use_cb: bool = True,
    num_boost_round: int = 300,
    early_stopping: int = 30,
) -> dict[str, object]:
    """
    在单 fold 上训练 LightGBM / XGBoost / CatBoost 三个 ranker，返回 dict。

    Args:
      X, y, group: 来自 model.prepare_xy
      train_dates_mask / valid_dates_mask: 行级 bool mask（对齐 X.index）

    Returns:
      {'lgb': booster, 'xgb': booster, 'cb': model}
    """
    X_tr, y_tr = X[train_dates_mask], y[train_dates_mask]
    X_va, y_va = X[valid_dates_mask], y[valid_dates_mask]
    # group sizes per fold
    g_tr = X_tr.index.get_level_values(0).value_counts().sort_index().tolist()
    g_va = X_va.index.get_level_values(0).value_counts().sort_index().tolist()

    out: dict[str, object] = {}

    if use_lgb and HAS_LGB:
        train_set = lgb.Dataset(X_tr.values, label=y_tr.values, group=g_tr,
                                feature_name=list(X.columns))
        valid_set = lgb.Dataset(X_va.values, label=y_va.values, group=g_va,
                                reference=train_set)
        booster = lgb.train(
            LGB_DEFAULT, train_set,
            num_boost_round=num_boost_round,
            valid_sets=[valid_set],
            callbacks=[
                lgb.early_stopping(early_stopping, verbose=False),
                lgb.log_evaluation(period=0),
            ],
        )
        out["lgb"] = booster

    if use_xgb and HAS_XGB:
        # XGBoost ranking: need qid (groupid) per row
        qid_tr = np.concatenate([[i] * n for i, n in enumerate(g_tr)])
        qid_va = np.concatenate([[i] * n for i, n in enumerate(g_va)])
        dtrain = xgb.DMatrix(X_tr.values, label=y_tr.values, qid=qid_tr,
                             feature_names=list(X.columns))
        dvalid = xgb.DMatrix(X_va.values, label=y_va.values, qid=qid_va,
                             feature_names=list(X.columns))
        booster = xgb.train(
            XGB_DEFAULT, dtrain,
            num_boost_round=num_boost_round,
            evals=[(dvalid, "valid")],
            early_stopping_rounds=early_stopping,
            verbose_eval=False,
        )
        out["xgb"] = booster

    if use_cb and HAS_CB:
        # CatBoost: 用 Pool with group_id
        group_id_tr = np.concatenate([[i] * n for i, n in enumerate(g_tr)])
        group_id_va = np.concatenate([[i] * n for i, n in enumerate(g_va)])
        pool_tr = cb.Pool(X_tr.values, label=y_tr.values, group_id=group_id_tr,
                          feature_names=list(X.columns))
        pool_va = cb.Pool(X_va.values, label=y_va.values, group_id=group_id_va,
                          feature_names=list(X.columns))
        model = cb.CatBoost({**CB_DEFAULT, "iterations": num_boost_round,
                             "early_stopping_rounds": early_stopping})
        model.fit(pool_tr, eval_set=pool_va, verbose=False)
        out["cb"] = model

    return out


# ── 集成预测 ────────────────────────────────────────────────


def predict_ensemble(
    boosters: dict[str, object],
    factor_panel: dict[int, pd.DataFrame],
    feature_names: list[str],
    *,
    dates: Iterable[pd.Timestamp] | None = None,
    method: str = "rank_mean",
) -> pd.DataFrame:
    """
    用多个模型的预测做集成。

    method:
      - 'rank_mean' (默认): 把每个模型的预测做横截面 rank pct，然后取均值
      - 'mean': 直接对 raw score 平均（要求 scale 一致，不推荐）
    """
    if not boosters:
        raise ValueError("boosters dict 为空")
    # 拼 X
    longs = []
    for fname in feature_names:
        num = int(fname.replace("alpha_", ""))
        df = factor_panel[num]
        if dates is not None:
            df = df.reindex(index=pd.DatetimeIndex(dates))
        longs.append(df.stack().rename(fname))
    X = pd.concat(longs, axis=1).dropna()
    if X.empty:
        sample = next(iter(factor_panel.values()))
        return pd.DataFrame(index=sample.index, columns=sample.columns, dtype=float)

    score_panels: list[pd.DataFrame] = []
    for name, b in boosters.items():
        if name == "lgb":
            pred = b.predict(X.values)
        elif name == "xgb":
            # XGB needs DMatrix; without qid for predict is OK
            d = xgb.DMatrix(X.values, feature_names=feature_names)
            pred = b.predict(d)
        elif name == "cb":
            pred = b.predict(X.values)
        else:
            continue
        s = pd.Series(pred, index=X.index, name=name)
        panel = s.unstack(level=1)
        if method == "rank_mean":
            # 每日横截面 rank pct
            panel = panel.rank(axis=1, pct=True)
        score_panels.append(panel)

    if not score_panels:
        sample = next(iter(factor_panel.values()))
        return pd.DataFrame(index=sample.index, columns=sample.columns, dtype=float)

    # 把所有模型的 panel 平均
    avg = sum(score_panels) / len(score_panels)
    return avg


# ── Walk-forward ensemble ─────────────────────────────────────


@dataclass
class EnsembleFoldResult:
    fold_idx: int
    boosters: dict[str, object]
    test_predictions: pd.DataFrame
    test_ic_mean: float = float("nan")
    test_ic_ir: float = float("nan")


def walk_forward_ensemble(
    factor_panel: dict[int, pd.DataFrame],
    fwd_ret: pd.DataFrame,
    *,
    train_years: float = 2.0,
    valid_years: float = 0.5,
    test_years: float = 0.5,
    step_months: int = 6,
    label_buckets: int | None = None,
    num_boost_round: int = 300,
    early_stopping: int = 30,
    use_lgb: bool = True,
    use_xgb: bool = True,
    use_cb: bool = True,
) -> list[EnsembleFoldResult]:
    """
    端到端 walk-forward 集成训练。

    Returns:
      [EnsembleFoldResult, ...] — 每个 fold 含 3 个 booster + 集成测试预测 + IC。
    """
    from .model import build_walk_forward_folds, prepare_xy

    X, y, group = prepare_xy(factor_panel, fwd_ret, label_buckets=label_buckets)
    all_dates = pd.DatetimeIndex(sorted(set(X.index.get_level_values(0))))
    folds = build_walk_forward_folds(
        all_dates, train_years=train_years, valid_years=valid_years,
        test_years=test_years, step_months=step_months,
    )
    if not folds:
        raise RuntimeError("无法构造 walk-forward fold")

    results: list[EnsembleFoldResult] = []
    feature_names = list(X.columns)
    dates_arr = X.index.get_level_values(0)

    for i, fold in enumerate(folds):
        print(f"[ensemble fold {i+1}/{len(folds)}] "
              f"train={fold.train_start.date()}..{fold.train_end.date()}, "
              f"test={fold.test_start.date()}..{fold.test_end.date()}")
        tr_mask = (dates_arr >= fold.train_start) & (dates_arr <= fold.train_end)
        va_mask = (dates_arr >= fold.valid_start) & (dates_arr <= fold.valid_end)
        boosters = train_ensemble_fold(
            X, y, group, tr_mask, va_mask,
            use_lgb=use_lgb, use_xgb=use_xgb, use_cb=use_cb,
            num_boost_round=num_boost_round, early_stopping=early_stopping,
        )
        test_dates = all_dates[(all_dates >= fold.test_start) & (all_dates <= fold.test_end)]
        preds = predict_ensemble(boosters, factor_panel, feature_names, dates=test_dates)

        # 算测试集 IC
        test_ic_mean = float("nan")
        test_ic_ir = float("nan")
        try:
            fwd_aligned = fwd_ret.reindex(index=preds.index, columns=preds.columns)
            ics = []
            for t in preds.index:
                p = preds.loc[t]; r = fwd_aligned.loc[t]
                m = p.notna() & r.notna()
                if m.sum() >= 10:
                    ics.append(p[m].rank().corr(r[m].rank()))
            if ics:
                ic_s = pd.Series(ics).dropna()
                if len(ic_s) > 0:
                    test_ic_mean = float(ic_s.mean())
                    if ic_s.std() > 0:
                        test_ic_ir = float(ic_s.mean() / ic_s.std() * (252 ** 0.5))
        except Exception:
            pass

        print(f"  ensemble test IC mean={test_ic_mean:.4f}, IR={test_ic_ir:.2f}")
        results.append(EnsembleFoldResult(
            fold_idx=i, boosters=boosters, test_predictions=preds,
            test_ic_mean=test_ic_mean, test_ic_ir=test_ic_ir,
        ))
    return results
