"""
regime — 市场状态机械标注（牛/熊/震荡）

Phase 1 用 Lunde-Timmermann (2004) 二元标注（牛/熊），阈值默认 20%。
后续 Phase 2 上 HMM 三态后，本模块作为 ground truth 比对参考。
"""
from .bull_bear import label_bull_bear, regime_segments  # noqa: F401
from .alerts import compute_alerts  # noqa: F401
