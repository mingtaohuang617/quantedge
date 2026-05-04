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
from .loader import load_universe, universe_stats  # noqa: F401
