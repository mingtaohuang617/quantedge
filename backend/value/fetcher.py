"""
value.fetcher — yfinance 价值型原始指标统一拉取
==================================================
美股（AAPL）和港股（0700.HK）共用一套接口，按需拉取财务三表 + dividends + info。

主接口：fetch_value_metrics(ticker) → dict
返回字段：
  market_cap, pe_ttm, pb, ps_ttm,
  roe_ttm, roa, roic_5y_avg,
  gross_margin, operating_margin, profit_margin,
  debt_to_equity,
  fcf_ttm, fcf_5y_cagr,
  revenue_5y_cagr, profit_5y_cagr,
  dividend_yield, dividend_streak_years, dividend_5y_growth,
  buyback_5y_total,           # 累计回购金额（负值，cashflow 报表口径）
  shares_change_5y_pct,       # 流通股 5 年变化（负=回购净流出股）
  industry, sector,           # 行业归类（给 industry_peers 用）
  longBusinessSummary,        # 给 LLM 用的业务描述
  ttm_period_end,             # 数据基准日期
  data_quality                # 'good'/'partial'/'poor' 字段完整度

设计：
  - 容错：每个字段独立 try/except，单字段失败不影响其他
  - 不缓存：上层（server.py）用 LLM cache 或自定义 TTL
  - 港股 ticker 自动转换："00700.HK" → "0700.HK"（yfinance 港股 4 位）
"""
from __future__ import annotations

import logging
import math
from typing import Any

import pandas as pd

try:
    import yfinance as yf
except ImportError:
    yf = None  # type: ignore

log = logging.getLogger(__name__)


def _yf_symbol(ticker: str) -> str:
    """规范化为 yfinance 接受的格式。
    yfinance 港股惯用 4 位代码（00700.HK 也行 / 0700.HK 也行 / 700.HK 不行）。
    我们统一规整成 4 位前补零：00700.HK → 0700.HK；0005.HK → 0005.HK。
    """
    t = ticker.strip().upper()
    if t.endswith(".HK"):
        base = t[:-3].lstrip("0").zfill(4)
        return f"{base}.HK"
    if t.endswith(".SS") or t.endswith(".SZ"):
        return t  # A 股 yfinance 直接用
    return t


def _safe_float(v: Any) -> float | None:
    """转 float；None / NaN / Inf 返回 None。"""
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _cagr(first: float | None, last: float | None, years: int) -> float | None:
    """复合年增长率。first/last 同号且 first > 0 才有意义。"""
    if first is None or last is None or years <= 0:
        return None
    if first <= 0 or last <= 0:
        return None
    try:
        return (last / first) ** (1.0 / years) - 1.0
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def _series_from_financials(df: pd.DataFrame, *candidates: str) -> pd.Series | None:
    """从 financials/cashflow/balance_sheet DataFrame 找第一个匹配的 row。
    返回的 Series index 是日期，按日期降序（最新在前）。"""
    if df is None or df.empty:
        return None
    for name in candidates:
        if name in df.index:
            row = df.loc[name]
            # yfinance 返回的 columns 通常已是 Timestamp，最新在前
            try:
                row = row.sort_index(ascending=False)
            except Exception:
                pass
            return row
    return None


def _dividend_streak(divs: pd.Series, ref_year: int | None = None) -> int:
    """连续分红年数（从 ref_year 往前数）。"""
    if divs is None or divs.empty:
        return 0
    try:
        annual = divs.groupby(divs.index.year).sum()
    except Exception:
        return 0
    if annual.empty:
        return 0
    annual = annual.sort_index(ascending=False)
    if ref_year is None:
        ref_year = int(annual.index.max())
    streak = 0
    y = ref_year
    while y in annual.index and annual.loc[y] > 0:
        streak += 1
        y -= 1
    return streak


def _dividend_5y_growth(divs: pd.Series) -> float | None:
    """近 5 年总额年化增长率。"""
    if divs is None or divs.empty:
        return None
    try:
        annual = divs.groupby(divs.index.year).sum().sort_index()
    except Exception:
        return None
    if len(annual) < 2:
        return None
    # 最多取最近 6 年（first..last 跨 5 年）
    annual = annual.tail(6)
    years = len(annual) - 1
    return _cagr(float(annual.iloc[0]), float(annual.iloc[-1]), years)


def fetch_value_metrics(ticker: str) -> dict:
    """
    拉取 ticker 的全部价值型原始指标。
    yfinance 单次 API 调用约 1-2s（含 financials/cashflow/balance_sheet）。
    返回 dict（字段缺失为 None，不抛异常）。
    """
    if yf is None:
        return {"ticker": ticker, "data_quality": "yfinance_not_installed", "error": "yfinance 未安装"}

    sym = _yf_symbol(ticker)
    out: dict[str, Any] = {"ticker": ticker, "yf_symbol": sym}

    try:
        tk = yf.Ticker(sym)
        info = tk.info or {}
    except Exception as e:
        return {"ticker": ticker, "yf_symbol": sym, "data_quality": "fetch_failed", "error": str(e)}

    # ── 1. info 快照字段 ──────────────────────────────────
    out["market_cap"] = _safe_float(info.get("marketCap"))
    out["pe_ttm"] = _safe_float(info.get("trailingPE"))
    out["pb"] = _safe_float(info.get("priceToBook"))
    out["ps_ttm"] = _safe_float(info.get("priceToSalesTrailing12Months"))
    out["roe_ttm"] = _safe_float(info.get("returnOnEquity"))   # 小数 0.20=20%
    out["roa"] = _safe_float(info.get("returnOnAssets"))
    out["debt_to_equity"] = _safe_float(info.get("debtToEquity"))  # yfinance 给百分比 32.7=32.7%
    out["gross_margin"] = _safe_float(info.get("grossMargins"))    # 小数 0.56
    out["operating_margin"] = _safe_float(info.get("operatingMargins"))
    out["profit_margin"] = _safe_float(info.get("profitMargins"))
    out["dividend_yield"] = _safe_float(info.get("dividendYield"))  # 百分比 1.12=1.12%（yfinance 历史对此字段口径不一）
    out["dividend_rate"] = _safe_float(info.get("dividendRate"))
    out["fcf_ttm"] = _safe_float(info.get("freeCashflow"))
    out["operating_cashflow"] = _safe_float(info.get("operatingCashflow"))
    out["total_revenue"] = _safe_float(info.get("totalRevenue"))
    out["shares_outstanding"] = _safe_float(info.get("sharesOutstanding"))
    out["revenue_growth_yoy"] = _safe_float(info.get("revenueGrowth"))
    out["earnings_growth_yoy"] = _safe_float(info.get("earningsGrowth"))
    out["industry"] = info.get("industry")
    out["sector"] = info.get("sector")
    out["business_summary"] = (info.get("longBusinessSummary") or "")[:500]
    out["currency"] = info.get("currency")
    out["country"] = info.get("country")

    # ── 2. financials（5 年净利润 / 营收 CAGR）────────────
    try:
        fin = tk.financials
        net_income = _series_from_financials(fin, "Net Income", "Net Income Common Stockholders")
        revenue = _series_from_financials(fin, "Total Revenue", "Operating Revenue")
        if net_income is not None and len(net_income) >= 2:
            ni = net_income.dropna()
            yrs = len(ni) - 1
            out["profit_5y_cagr"] = _cagr(_safe_float(ni.iloc[-1]), _safe_float(ni.iloc[0]), yrs)
            out["profit_5y_history"] = [_safe_float(v) for v in ni.tolist()]
        if revenue is not None and len(revenue) >= 2:
            rv = revenue.dropna()
            yrs = len(rv) - 1
            out["revenue_5y_cagr"] = _cagr(_safe_float(rv.iloc[-1]), _safe_float(rv.iloc[0]), yrs)
    except Exception as e:
        log.warning(f"[fetcher] financials parse failed for {sym}: {e}")

    # ── 3. cashflow（FCF 5y CAGR + 回购）──────────────────
    try:
        cf = tk.cashflow
        fcf = _series_from_financials(cf, "Free Cash Flow")
        if fcf is not None and len(fcf) >= 2:
            f = fcf.dropna()
            yrs = len(f) - 1
            out["fcf_5y_cagr"] = _cagr(_safe_float(f.iloc[-1]), _safe_float(f.iloc[0]), yrs)
            out["fcf_5y_history"] = [_safe_float(v) for v in f.tolist()]

        buyback = _series_from_financials(cf, "Repurchase Of Capital Stock", "Repurchase Of Stock")
        if buyback is not None:
            bb = buyback.dropna()
            # cashflow 口径回购为负值 → 累加得到 5 年总回购（负值）
            out["buyback_5y_total"] = _safe_float(bb.head(5).sum())
        else:
            out["buyback_5y_total"] = None
    except Exception as e:
        log.warning(f"[fetcher] cashflow parse failed for {sym}: {e}")

    # ── 4. balance_sheet（流通股变化）──────────────────────
    try:
        bs = tk.balance_sheet
        shares_row = _series_from_financials(bs, "Ordinary Shares Number", "Share Issued", "Common Stock Equity")
        if shares_row is not None and len(shares_row) >= 2:
            s = shares_row.dropna()
            if len(s) >= 2:
                first = _safe_float(s.iloc[-1])
                last = _safe_float(s.iloc[0])
                if first and last and first > 0:
                    out["shares_change_5y_pct"] = (last / first - 1.0)
    except Exception as e:
        log.warning(f"[fetcher] balance_sheet parse failed for {sym}: {e}")

    # ── 5. dividends（连续年数 + 5 年增长）─────────────────
    try:
        divs = tk.dividends
        if divs is not None and not divs.empty:
            out["dividend_streak_years"] = _dividend_streak(divs)
            out["dividend_5y_growth"] = _dividend_5y_growth(divs)
        else:
            out["dividend_streak_years"] = 0
            out["dividend_5y_growth"] = None
    except Exception as e:
        log.warning(f"[fetcher] dividends parse failed for {sym}: {e}")
        out["dividend_streak_years"] = 0

    # ── 6. ROIC 自算（5 年均值近似）───────────────────────
    # ROIC ≈ NOPAT / (Equity + LongTermDebt - Cash)
    # 简化：用 ROE * (1 - 财务杠杆贡献) 不严谨；这里用 ROA 作近似上限，
    # 若 yfinance info.returnOnEquity 存在则用 ROE 作 fallback（弱化版 ROIC）
    out["roic_proxy"] = out.get("roe_ttm")  # v1 简化：用 ROE 代理

    # ── 7. 数据质量评估 ────────────────────────────────────
    critical_fields = ["market_cap", "pe_ttm", "roe_ttm", "fcf_ttm", "industry"]
    n_present = sum(1 for k in critical_fields if out.get(k) is not None)
    if n_present == len(critical_fields):
        out["data_quality"] = "good"
    elif n_present >= 3:
        out["data_quality"] = "partial"
    else:
        out["data_quality"] = "poor"

    return out
