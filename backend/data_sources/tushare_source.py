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


# ── 价值型基本面字段（A 股全市场批量）─────────────────
def fetch_fundamentals_cn(retries: int = 5) -> dict[str, dict]:
    """单次拉全 A 股基本面字段，返回 {ts_code: {pe, pb, dividend_yield, roe, debt_to_equity}}。

    数据来源：
      - pro.daily_basic(trade_date)：pe / pb / dv_ttm（股息率%，转小数）
      - pro.fina_indicator(period)：roe / debt_to_assets（百分比，需转小数）
    若 daily_basic 当天空（非交易日），回滚最多 retries 天找有数据的交易日（参考 sync_cn 的 enrich_market_cap_tushare 同模式）。

    fina_indicator 用最近的财报期（按当前年月推）— 上游缓存月级即可，不强求最新季报。
    """
    if not HAS_TUSHARE:
        raise TushareError("tushare 未安装")
    pro = _get_pro()
    today = datetime.now()
    daily_basic_df = None

    for offset in range(retries):
        d = today - timedelta(days=offset)
        ds = d.strftime("%Y%m%d")
        try:
            df = pro.daily_basic(trade_date=ds, fields="ts_code,pe,pb,dv_ttm")
        except Exception:
            continue
        if df is None or df.empty:
            continue
        daily_basic_df = df
        break
    if daily_basic_df is None:
        raise TushareError("daily_basic 5 天内都没拿到数据")

    out: dict[str, dict] = {}
    for _, row in daily_basic_df.iterrows():
        ts_code = str(row.get("ts_code", "")).strip()
        if not ts_code:
            continue
        dv = row.get("dv_ttm")
        out[ts_code] = {
            "pe": _to_float(row.get("pe")),
            "pb": _to_float(row.get("pb")),
            "dividend_yield": (_to_float(dv) / 100.0) if dv is not None else None,  # tushare dv_ttm 单位 %
            "roe": None,
            "debt_to_equity": None,
        }

    # fina_indicator：以最近季报期为参考。报告期以季度末计：3-31 / 6-30 / 9-30 / 12-31
    period = _last_finished_period(today)
    try:
        fi_df = pro.fina_indicator_vip(period=period,
                                       fields="ts_code,roe,debt_to_assets")
    except Exception:
        try:
            fi_df = pro.fina_indicator(period=period,
                                       fields="ts_code,roe,debt_to_assets")
        except Exception:
            fi_df = None

    if fi_df is not None and not fi_df.empty:
        for _, row in fi_df.iterrows():
            ts_code = str(row.get("ts_code", "")).strip()
            if ts_code not in out:
                continue
            roe = _to_float(row.get("roe"))
            d2a = _to_float(row.get("debt_to_assets"))
            # tushare roe / debt_to_assets 都是百分比单位（如 18.5 = 18.5%），统一转小数
            out[ts_code]["roe"] = (roe / 100.0) if roe is not None else None
            # 注：tushare 给的是 debt_to_assets（资产负债率），与 yfinance 的 debt_to_equity 不同。
            # 为统一字段名沿用 debt_to_equity，但语义实际是 D/A。前端展示文案需注意。
            # 一致性：D/A 0.6 = 资产 60% 是负债；D/E 1.5 大致对应 D/A 0.6（具体差异取决于权益）。
            out[ts_code]["debt_to_equity"] = (d2a / 100.0) if d2a is not None else None

    return out


def _to_float(v):
    """安全转 float，None / NaN / Inf 返回 None。"""
    import math as _math
    if v is None:
        return None
    try:
        f = float(v)
        if _math.isnan(f) or _math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _last_finished_period(d: datetime) -> str:
    """给定日期，返回距其最近的、已经结束的财报期 YYYYMMDD。

    Tushare 财报期为季度末（3-31/6-30/9-30/12-31），且实际披露往往晚 1-2 个月。
    保守取「上上一季报期」（最近 5 个月的，确保已披露）。
    """
    y, m = d.year, d.month
    # 简化：假设当前 m，最近"已披露"季报日：
    # m in [1, 5]   → 上一年 12-31
    # m in [6, 8]   → 当年 3-31
    # m in [9, 11]  → 当年 6-30
    # m == 12       → 当年 9-30
    if m <= 5:
        return f"{y - 1}1231"
    elif m <= 8:
        return f"{y}0331"
    elif m <= 11:
        return f"{y}0630"
    else:
        return f"{y}0930"
