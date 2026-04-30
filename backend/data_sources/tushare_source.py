"""
tushare 数据源
==============
覆盖：
  - A 股 (SH/SZ): pro.daily + pro.adj_factor
  - 港股 (HK):   pro.hk_daily + pro.hk_adjfactor
  - 美股 (US):   pro.us_daily + pro.us_adjfactor

要求：
  - pip install tushare
  - 环境变量 TUSHARE_TOKEN
  - hk_daily / us_daily 需要 2000+ 积分账号；积分不够时会抛异常，由 router 降级。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

import pandas as pd

try:
    import tushare as ts
    HAS_TUSHARE = True
except ImportError:
    HAS_TUSHARE = False


class TushareError(RuntimeError):
    pass


_pro = None


def _get_pro():
    """获取 tushare pro_api 单例，缺 token 或未安装抛 TushareError。"""
    global _pro
    if _pro is not None:
        return _pro
    if not HAS_TUSHARE:
        raise TushareError("tushare 未安装，请 pip install tushare")
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    if not token:
        raise TushareError("TUSHARE_TOKEN 环境变量未设置")
    ts.set_token(token)
    _pro = ts.pro_api()
    return _pro


def to_ts_code(cfg: dict) -> tuple[str, str]:
    """
    把 cfg 转成 tushare 期望的 (ts_code, market_type)。
    market_type ∈ {'A', 'HK', 'US'} 用于选择 daily / hk_daily / us_daily。

    映射规则：
      market=HK + yf_symbol "0700.HK"   → "00700.HK", "HK"
      market=SH + yf_symbol "600519.SS" → "600519.SH", "A"
      market=SZ + yf_symbol "000001.SZ" → "000001.SZ", "A"
      market=US + yf_symbol "NVDA"      → "NVDA",     "US"
    """
    market = (cfg.get("market") or "").upper()
    yf_sym = cfg.get("yf_symbol", "")

    if market == "HK":
        # tushare 港股用 5 位
        base = yf_sym.split(".")[0].zfill(5)
        return f"{base}.HK", "HK"

    if market in ("SH", "CN"):
        # yfinance 上 SH 用 .SS，tushare 用 .SH
        base = yf_sym.split(".")[0]
        return f"{base}.SH", "A"

    if market == "SZ":
        base = yf_sym.split(".")[0]
        return f"{base}.SZ", "A"

    if market == "US":
        return yf_sym, "US"

    raise TushareError(f"tushare 不支持的市场: market={market!r}")


def _df_normalize(df: pd.DataFrame, adj: pd.DataFrame | None = None) -> pd.DataFrame:
    """把 tushare 的 long-format DataFrame 转成与 yfinance 同列的 DataFrame。"""
    if df is None or df.empty:
        return pd.DataFrame()

    df = df.rename(columns={
        "trade_date": "Date",
        "open": "Open", "high": "High", "low": "Low", "close": "Close",
        "vol": "Volume", "amount": "Amount",
    })
    df["Date"] = pd.to_datetime(df["Date"].astype(str), format="%Y%m%d")
    df = df.set_index("Date").sort_index()

    if adj is not None and not adj.empty:
        adj = adj.rename(columns={"trade_date": "Date", "adj_factor": "AdjFactor"})
        adj["Date"] = pd.to_datetime(adj["Date"].astype(str), format="%Y%m%d")
        adj = adj.set_index("Date").sort_index()
        df = df.join(adj[["AdjFactor"]], how="left")
        df["AdjFactor"] = df["AdjFactor"].ffill().fillna(1.0)
    else:
        df["AdjFactor"] = 1.0

    cols_needed = ["Open", "High", "Low", "Close", "Volume", "AdjFactor"]
    if "Amount" in df.columns:
        cols_needed.append("Amount")
    return df[cols_needed]


def fetch_history(cfg: dict, days: int = 120, *, start_date: str | None = None) -> pd.DataFrame:
    """
    返回与 yfinance 兼容的 DataFrame：
      列: Open / High / Low / Close / Volume / AdjFactor (+ 可选 Amount)
      索引: DatetimeIndex（升序）

    start_date: 'YYYYMMDD'，用于增量同步。优先于 days。
    """
    pro = _get_pro()
    ts_code, mtype = to_ts_code(cfg)

    end = datetime.now().strftime("%Y%m%d")
    if start_date:
        start = start_date.replace("-", "")
    else:
        # 多拉 30 天给周末 / 节假日留余量
        start = (datetime.now() - timedelta(days=days + 30)).strftime("%Y%m%d")

    if mtype == "A":
        df = pro.daily(ts_code=ts_code, start_date=start, end_date=end)
        try:
            adj = pro.adj_factor(ts_code=ts_code, start_date=start, end_date=end)
        except Exception:
            adj = None
    elif mtype == "HK":
        df = pro.hk_daily(ts_code=ts_code, start_date=start, end_date=end)
        try:
            adj = pro.hk_adjfactor(ts_code=ts_code, start_date=start, end_date=end)
        except Exception:
            adj = None
    else:  # US
        df = pro.us_daily(ts_code=ts_code, start_date=start, end_date=end)
        try:
            adj = pro.us_adjfactor(ts_code=ts_code, start_date=start, end_date=end)
        except Exception:
            adj = None

    if df is None or df.empty:
        raise TushareError(f"tushare 返回空: {ts_code} ({start}~{end})")

    out = _df_normalize(df, adj)
    if out.empty:
        raise TushareError(f"tushare 数据归一化后为空: {ts_code}")
    return out


def get_trade_dates(market: str, start: str, end: str) -> list[str]:
    """
    返回交易日历 ['YYYY-MM-DD', ...] 升序。
    market ∈ {'SH','SZ','CN','HK','US'}。其他市场返空列表。
    start/end 接受 'YYYY-MM-DD' 或 'YYYYMMDD'。
    """
    try:
        pro = _get_pro()
    except TushareError:
        return []

    s = start.replace("-", "")
    e = end.replace("-", "")

    market = (market or "").upper()
    try:
        if market in ("SH", "SZ", "CN"):
            df = pro.trade_cal(start_date=s, end_date=e, is_open="1")
        elif market == "HK":
            df = pro.hk_tradecal(start_date=s, end_date=e, is_open="1")
        elif market == "US":
            df = pro.us_tradecal(start_date=s, end_date=e, is_open="1")
        else:
            return []
    except Exception:
        return []

    if df is None or df.empty:
        return []
    col = "cal_date"
    return [
        f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        for d in df[col].astype(str).tolist()
    ]


def health_check() -> tuple[bool, str]:
    """tushare 连通性自检。"""
    if not HAS_TUSHARE:
        return False, "tushare 未安装"
    if not os.environ.get("TUSHARE_TOKEN", "").strip():
        return False, "TUSHARE_TOKEN 未设置"
    try:
        pro = _get_pro()
        # 拿上证指数最近几根，最便宜的探活
        df = pro.daily(ts_code="000001.SH", start_date="20240101", end_date="20240105")
        n = 0 if df is None else len(df)
        return True, f"tushare 正常 (sample {n} rows)"
    except Exception as e:
        return False, f"tushare 失败: {e}"
