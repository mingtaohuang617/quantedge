"""
yfinance 数据源
================
用于美股等富途无权限的市场。延迟约 15 分钟，但免费且覆盖全。
"""
import pandas as pd
import yfinance as yf


class YFinanceError(RuntimeError):
    pass


def fetch_history(cfg: dict, days: int = 120) -> pd.DataFrame:
    """
    拉取日 K 线，返回标准化 DataFrame：
    列：Open / High / Low / Close / Volume
    索引：DatetimeIndex
    """
    symbol = cfg["yf_symbol"]
    period = "6mo" if days > 90 else "3mo"
    tk = yf.Ticker(symbol)
    df = tk.history(period=period)
    if df is None or df.empty:
        df = tk.history(period="1mo")
        if df is None or df.empty:
            raise YFinanceError(f"yfinance 无法获取 {symbol} 行情数据")
    return df[["Open", "High", "Low", "Close", "Volume"]]
