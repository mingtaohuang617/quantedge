"""
mining_alpha — Alpha 因子挖掘与策略构建框架
================================================

QuantEdge 的因子挖掘子系统。把"因子表达式 → 单因子诊断 → ML 合成 → 回测"
端到端工业化。第一批因子来源是国君 2017《基于短周期价量特征的多因子选股
体系》的 Alpha191；架构保留以便未来加 WorldQuant Alpha101 或自研因子。

模块组织:
  - operators.py            25 个 vectorized panel-data 算子（通用，不绑定某套因子）
  - alpha191_factors.py     国君 Alpha191 因子集 + 注册器
  - data_loader.py          从 SQLite + tushare 加载 CSI800 panel + PIT universe
  - preprocess.py           横截面预处理：winsorize / neutralize / zscore
  - ic_report.py            单因子 IC / ICIR / Top decile excess 诊断
  - model.py                LightGBM LambdaRank + walk-forward CV
  - backtest.py             向量化回测引擎 + 多空诊断
  - run.py                  CLI 总入口（sync-data / compute-factors / ic-report / train / backtest）

设计原则:
  1. Panel-data wide format: dates × tickers
  2. 严格无前视: 所有滚动算子 min_periods=window
  3. PIT universe: 调入调出按 index_weight 历史快照切片
  4. 工业标准: 与 WorldQuant / Qlib / Alphalens 同款 API 形态
"""
from __future__ import annotations

__version__ = "0.2.0"

from .operators import (
    # 横截面
    RANK, SIGN,
    # 时序
    DELAY, DELTA, SUM_, MEAN, STD, TSMAX, TSMIN, TSRANK,
    HIGHDAY, LOWDAY, COUNT, SUMIF, PROD, SUMAC,
    # 平滑
    SMA, WMA, DECAYLINEAR,
    # 相关 / 回归
    CORR, COVIANCE, REGBETA, SEQUENCE,
    # 元素级
    ABS, LOG, MAX, MIN, IF,
)

__all__ = [
    "RANK", "SIGN",
    "DELAY", "DELTA", "SUM_", "MEAN", "STD", "TSMAX", "TSMIN", "TSRANK",
    "HIGHDAY", "LOWDAY", "COUNT", "SUMIF", "PROD", "SUMAC",
    "SMA", "WMA", "DECAYLINEAR",
    "CORR", "COVIANCE", "REGBETA", "SEQUENCE",
    "ABS", "LOG", "MAX", "MIN", "IF",
]
