"""
AKShare 数据源
===============
免费开源金融数据接口，数据来自东方财富等。
当前用途：股票关键词搜索（search_stocks）+ 健康检查。

注：港股财务基本面曾用本模块兜底，但 eastmoney push2 对 **非浏览器 TLS 指纹**
反爬（直接 curl HTTP 200，但 Python requests/urllib/甚至 curl_cffi 都被 RST，
"Connection closed abruptly"）。已改由 yfinance .info 提供港股 pe/roe/营收增长/
利润率（见 data_sources/yfinance_source.fetch_hk_fundamentals）。A 股行情的
akshare 降级备援另见 mining_alpha/data_loader.py。

pip install akshare
"""
from __future__ import annotations

import akshare as ak
import pandas as pd


class AKShareError(RuntimeError):
    pass


def search_stocks(keyword: str, market: str = "HK") -> pd.DataFrame:
    """
    按关键词搜索股票。
    market: "HK" / "US" / "A"（A股）
    返回 DataFrame [代码, 名称, 最新价, 涨跌幅, ...]
    """
    try:
        if market.upper() == "HK":
            df = ak.stock_hk_spot_em()
        elif market.upper() == "US":
            df = ak.stock_us_spot_em()
        else:
            df = ak.stock_zh_a_spot_em()

        if df is None or df.empty:
            return pd.DataFrame()

        # 按名称或代码模糊匹配
        mask = (
            df["名称"].str.contains(keyword, case=False, na=False) |
            df["代码"].str.contains(keyword, case=False, na=False)
        )
        return df[mask].head(20)
    except Exception as e:
        raise AKShareError(f"AKShare 搜索失败: {e}") from e


def health_check() -> tuple[bool, str]:
    """检查 AKShare 是否可用。"""
    try:
        df = ak.stock_hk_spot_em()
        if df is not None and not df.empty:
            return True, f"AKShare 正常 (港股 {len(df)} 只)"
        return False, "AKShare 返回空数据"
    except Exception as e:
        return False, f"AKShare 异常: {e}"
