"""
value — 价值型 X 倍股策略子包
================================

数据流：
  fetcher.fetch_value_metrics(ticker) → 12+ 个原始字段
       ↓
  industry_peers.find_peers(ticker) → 同 industry top 20 + 各自原始字段
       ↓
  score.compute_value_score(metrics, peer_metrics, weights) → 5 维加权 + 总分
       ↓
  alerts / 前端展示
"""
from .fetcher import fetch_value_metrics  # noqa: F401
from .industry_peers import find_peers, industry_pctile  # noqa: F401
from .score import (  # noqa: F401
    compute_value_score,
    dcf_value,
    WEIGHT_PRESETS,
    DEFAULT_WEIGHTS,
)
from .whitelist import BUFFETT_WHITELIST, get_whitelist, is_whitelisted, whitelist_thesis  # noqa: F401
from .backtest import run_backtest  # noqa: F401
