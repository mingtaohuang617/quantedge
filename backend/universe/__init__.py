"""
universe — 候选股池（轻量元数据，与 tickers_custom.json 解耦）
==============================================================

用途：
  10x 猎手页面的"候选个股筛选"需要在数千只股票里按行业/市值过滤。
  此池仅存元数据（ticker/name/exchange/sector/industry/marketCap），
  不含日线，所以可以放心做几千只规模。

数据存放：
  backend/output/universe_us.json   — 全 NASDAQ + NYSE 上市股票
  backend/output/universe_cn.json   — 全 A 股（SH+SZ）

同步策略：手动运行 sync_us.py / sync_cn.py（避免 API 超额）。
加载使用 loader.load_universe()。
"""
import math

from .loader import load_universe, universe_stats  # noqa: F401


def sanitize_for_json(obj):
    """递归把 NaN/Infinity 替换成 None。

    Python json.dump 默认 allow_nan=True，会把 NaN 写成字面量 'NaN'。
    但 V8 (Node/Vercel lambda) 的 JSON.parse 不接受 NaN，会抛
    "Unexpected token 'N'" 直接整文件解析失败。

    sync_*.py 在写 backend/output/universe_*.json 前调一遍此函数；
    然后用 json.dump(..., allow_nan=False) 兜底确保不再漏 NaN。
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    return obj
