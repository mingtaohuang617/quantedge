"""
HMM 三态市场状态识别（牛 / 熊 / 震荡）
======================================
观测变量：
  - 日 log-return（捕捉方向）
  - 20 日滚动 log-return std（捕捉波动率聚集）

模型：3-state Gaussian HMM (diag covariance)
状态语义靠"事后均值排序"标注：
  - 最高均值 → bull
  - 最低均值 → bear
  - 中间均值 → neutral（震荡）

输出：
  - 每日各状态的后验概率
  - 当前快照（牛 X% / 熊 Y% / 震荡 Z%）
  - 状态转移矩阵 + 各状态的年化均值/波动率（可解释性）
"""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    from hmmlearn.hmm import GaussianHMM
    HAS_HMM = True
except ImportError:
    HAS_HMM = False


def _features(prices: pd.Series, vol_window: int = 20) -> pd.DataFrame:
    """从价格序列构造 (log_return, vol) 特征矩阵。"""
    p = prices.dropna().astype(float).sort_index()
    log_ret = np.log(p).diff()
    vol = log_ret.rolling(vol_window, min_periods=vol_window).std()
    df = pd.DataFrame({"ret": log_ret, "vol": vol}).dropna()
    return df


# 进程级缓存：同一 W5000 数据 + seed 不重训。key 包含最后日期 + len 防止数据更新后命中旧缓存。
_HMM_CACHE: dict[tuple, dict] = {}


def fit_hmm_3state_cached(prices: pd.Series, seed: int = 42) -> dict:
    """fit_hmm_3state 的缓存包装。key=(最后日期, 数据点数, seed)。"""
    if prices is None or prices.empty:
        return fit_hmm_3state(prices, seed=seed)
    last_idx = prices.index[-1]
    key = (str(last_idx), len(prices), seed, 20)
    cached = _HMM_CACHE.get(key)
    if cached is not None:
        return cached
    fit = fit_hmm_3state(prices, seed=seed)
    _HMM_CACHE[key] = fit
    return fit


def fit_hmm_3state(prices: pd.Series, seed: int = 42) -> dict:
    """
    训练 3-state Gaussian HMM。返回 fit 结果 dict（不返回模型对象，序列化方便）。

    Output:
      label_map: {state_idx: 'bull'|'bear'|'neutral'}
      state_means_annual_pct: 各状态年化均值
      state_vols_annual_pct:  各状态年化波动率
      transition_matrix: 3x3 list
      probs: DataFrame[date, bull_prob, bear_prob, neutral_prob]
      current: dict
    """
    if not HAS_HMM:
        raise RuntimeError("hmmlearn 未安装")

    feat = _features(prices)
    if len(feat) < 252:
        raise ValueError(f"数据点不足: {len(feat)} < 252")

    X = feat[["ret", "vol"]].to_numpy()
    model = GaussianHMM(
        n_components=3,
        covariance_type="diag",
        n_iter=300,
        random_state=seed,
        tol=1e-4,
    )
    model.fit(X)

    # 后验概率（每个时点 3 个状态的概率）
    posteriors = model.predict_proba(X)  # shape (n, 3)

    # 按状态均值（return 维度）排序：最低 → bear, 最高 → bull, 中间 → neutral
    state_returns = model.means_[:, 0]  # 列 0 = ret
    sorted_idx = np.argsort(state_returns)
    label_map = {
        int(sorted_idx[0]): "bear",
        int(sorted_idx[1]): "neutral",
        int(sorted_idx[2]): "bull",
    }

    # 年化（×252）
    state_means_annual = {
        label_map[i]: round(float(state_returns[i]) * 252 * 100, 2)
        for i in range(3)
    }
    # diag covariance: model.covars_ shape (n_states, n_features, n_features) 或 (n_states, n_features)
    cov = model.covars_
    if cov.ndim == 3:
        ret_var = cov[:, 0, 0]
    else:
        ret_var = cov[:, 0]
    state_vols_annual = {
        label_map[i]: round(float(np.sqrt(ret_var[i]) * np.sqrt(252) * 100), 2)
        for i in range(3)
    }

    # 重建 daily probs DataFrame
    probs_df = pd.DataFrame(posteriors, index=feat.index, columns=["s0", "s1", "s2"])
    out_probs = pd.DataFrame(index=feat.index)
    for i in range(3):
        out_probs[f"{label_map[i]}_prob"] = probs_df[f"s{i}"]

    current = {
        "bull": round(float(out_probs["bull_prob"].iloc[-1]), 4),
        "neutral": round(float(out_probs["neutral_prob"].iloc[-1]), 4),
        "bear": round(float(out_probs["bear_prob"].iloc[-1]), 4),
    }

    # 转移矩阵：按 label_map 重排成 [bull, neutral, bear] 顺序
    label_order = ["bull", "neutral", "bear"]
    inv_label_map = {v: k for k, v in label_map.items()}
    transition = [
        [round(float(model.transmat_[inv_label_map[a], inv_label_map[b]]), 4)
         for b in label_order]
        for a in label_order
    ]

    return {
        "label_map": label_map,
        "state_means_annual_pct": state_means_annual,
        "state_vols_annual_pct": state_vols_annual,
        "transition_matrix": transition,
        "transition_labels": label_order,
        "probs": out_probs,
        "current": current,
        "n_obs": len(feat),
        "vol_window": 20,
    }


def compute_hmm_bb_confusion(
    prices: pd.Series,
    bb_threshold: float = 0.20,
    seed: int = 42,
) -> dict:
    """
    HMM 主导状态（每日 argmax）与 Bry-Boschan 牛熊标签的一致性矩阵。

    BB 是 2 类（bull/bear），HMM 是 3 类（bull/neutral/bear）。
    我们看 HMM 的 neutral 大部分时候落在 BB 的什么类——通常是 BB 转折前后的过渡期。

    返回 confusion + 三种 agreement 指标。
    """
    from regime.bull_bear import label_bull_bear

    fit = fit_hmm_3state_cached(prices, seed=seed)
    probs_df = fit["probs"]  # index = 价格日期，cols = bull_prob/neutral_prob/bear_prob

    # HMM 主导状态（argmax）
    hmm_state = probs_df.idxmax(axis=1).str.replace("_prob", "", regex=False)

    # BB 全部历史
    bb_labeled = label_bull_bear(prices, threshold=bb_threshold)
    bb_state = bb_labeled["regime"]

    # 对齐索引
    common = hmm_state.index.intersection(bb_state.index)
    hmm_a = hmm_state.loc[common]
    bb_a = bb_state.loc[common]

    # 2×3 矩阵：行=BB（bull/bear），列=HMM（bull/neutral/bear）
    confusion: dict[str, dict[str, int]] = {}
    row_pct: dict[str, dict[str, float]] = {}
    for bb_cls in ["bull", "bear"]:
        confusion[bb_cls] = {}
        row_pct[bb_cls] = {}
        bb_mask = (bb_a == bb_cls)
        bb_total = int(bb_mask.sum())
        for hmm_cls in ["bull", "neutral", "bear"]:
            cnt = int(((bb_a == bb_cls) & (hmm_a == hmm_cls)).sum())
            confusion[bb_cls][hmm_cls] = cnt
            row_pct[bb_cls][hmm_cls] = round(cnt / bb_total * 100, 1) if bb_total else 0.0

    total = len(common)
    strict = confusion["bull"]["bull"] + confusion["bear"]["bear"]
    # 宽松：neutral 视为"过渡"不算错
    loose = strict + confusion["bull"]["neutral"] + confusion["bear"]["neutral"]
    bb_bull_total = sum(confusion["bull"].values())
    bb_bear_total = sum(confusion["bear"].values())

    return {
        "total_days": total,
        "bb_threshold": bb_threshold,
        "bb_bull_total": bb_bull_total,
        "bb_bear_total": bb_bear_total,
        "confusion": confusion,
        "row_pct": row_pct,
        "strict_agreement_pct": round(strict / total * 100, 1) if total else 0.0,
        "loose_agreement_pct": round(loose / total * 100, 1) if total else 0.0,
        "bull_recall_pct": round(confusion["bull"]["bull"] / bb_bull_total * 100, 1) if bb_bull_total else 0.0,
        "bear_recall_pct": round(confusion["bear"]["bear"] / bb_bear_total * 100, 1) if bb_bear_total else 0.0,
    }


def compute_hmm_regime(prices: pd.Series, seed: int = 42) -> dict:
    """对外接口：返回带 history 的 dict（probs 转列表方便 JSON 序列化）。"""
    fit = dict(fit_hmm_3state_cached(prices, seed=seed))  # copy 防止破坏缓存
    probs_df = fit.pop("probs")
    fit["history"] = {
        "dates": [d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)
                  for d in probs_df.index],
        "bull": [round(float(v), 4) for v in probs_df["bull_prob"].tolist()],
        "neutral": [round(float(v), 4) for v in probs_df["neutral_prob"].tolist()],
        "bear": [round(float(v), 4) for v in probs_df["bear_prob"].tolist()],
    }
    return fit
