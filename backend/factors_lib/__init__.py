"""
factors_lib — 市场层面（非个股）因子库

模块组织：
  - core.py       注册装饰器 / PIT 读写 / 分位标准化 / 共享常量
  - composite.py  compute_composite + compute_composite_history（L3/L5 计算）
  - {liquidity,sentiment,breadth,valuation,cn_macro}.py  具体因子定义

本 __init__ 仅 re-export 公开 API 保持向后兼容（之前写法 `import factors_lib as fl;
fl.compute_composite()` / `fl.read_series(...)` 等仍然有效）。
"""
from __future__ import annotations

from .core import (
    # 类型 + 注册
    FactorFunc,
    FactorSpec,
    register_factor,
    list_factors,
    get_factor,
    sync_factor_meta,
    _REGISTRY,
    # PIT 读写
    upsert_series_meta,
    upsert_observations,
    read_series,
    read_series_history,
    upsert_factor_value,
    # L3/L5 共享常量 + 工具
    COMPOSITE_WEIGHTS,
    directional_score,
    to_percentile,
    to_percentile_series,
)

from .composite import (
    compute_composite,
    compute_composite_history,
)

__all__ = [
    "FactorFunc", "FactorSpec",
    "register_factor", "list_factors", "get_factor", "sync_factor_meta",
    "upsert_series_meta", "upsert_observations",
    "read_series", "read_series_history", "upsert_factor_value",
    "COMPOSITE_WEIGHTS", "directional_score",
    "to_percentile", "to_percentile_series",
    "compute_composite", "compute_composite_history",
]
