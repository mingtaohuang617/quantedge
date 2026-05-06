"""
value.backtest — 历史回测工具（V5）
==========================================
给定 ticker 列表 + 权重，对每只票：
  1. 当前 fetch_value_metrics + 评分
  2. yfinance 拉过去 N 年价格（period="{N}y"）
  3. 计算 N 年总回报 + 月度收益序列
  4. 按 value_score 排序，输出：
     - top 30 表格（含评分 + 涨幅 + 5 维子分）
     - 等权 top 30 月度净值 vs S&P 500（SPY）
     - 5 档分位（quintile）平均回报，验证评分单调性
     - 维度归因（pearson 相关性：每个 sub_score vs 总回报）

注意：这是"近似回测" — yfinance financials 是历年的，但 info 是当下
快照，所以 ROE/PE/分红等用的是当前数据。严格 PIT 回测需另行接入历史
财报快照。当前版本可作为"评分模型识别过去伟大公司"的简单验证。
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from .fetcher import fetch_value_metrics, _yf_symbol
from .score import compute_value_score, DEFAULT_WEIGHTS

log = logging.getLogger(__name__)

try:
    import yfinance as yf
except ImportError:
    yf = None  # type: ignore


def _pct_change(start: float | None, end: float | None) -> float | None:
    if start is None or end is None or start <= 0:
        return None
    return end / start - 1.0


def _fetch_price_history(ticker: str, period: str = "5y") -> pd.Series | None:
    """拉收盘价时序（月度采样以减少数据量）。"""
    if yf is None:
        return None
    sym = _yf_symbol(ticker)
    try:
        hist = yf.Ticker(sym).history(period=period, interval="1mo")
    except Exception as e:
        log.warning(f"history failed for {ticker}: {e}")
        return None
    if hist is None or hist.empty:
        return None
    return hist["Close"].dropna()


def _equal_weight_navs(
    return_series_by_ticker: dict[str, pd.Series],
) -> pd.Series | None:
    """
    给定每只票的月度收益序列，按等权 + 月度再平衡构建组合净值。
    return_series 是月度净值（不是回报率）；用 pct_change 转回报。
    """
    if not return_series_by_ticker:
        return None

    # 对齐时间索引（取所有票共有的月份）
    df = pd.concat(return_series_by_ticker.values(), axis=1).dropna(how="all")
    if df.empty:
        return None
    # 转为月度收益（pct_change），第一行 NaN
    rets = df.pct_change().fillna(0)
    # 等权组合月收益 = 横向均值
    portfolio_ret = rets.mean(axis=1)
    # 净值 = 累乘
    nav = (1 + portfolio_ret).cumprod()
    return nav


def _quintile_returns(
    rows: list[dict],
    score_key: str = "value_score",
    return_key: str = "total_return",
) -> dict[str, float]:
    """把 rows 按 score_key 五等分（quintile），返回每档平均 return。"""
    valid = [r for r in rows if r.get(score_key) is not None and r.get(return_key) is not None]
    if len(valid) < 5:
        return {}
    valid.sort(key=lambda x: x[score_key])
    n = len(valid)
    q_size = n // 5
    out: dict[str, float] = {}
    for i in range(5):
        start = i * q_size
        end = (i + 1) * q_size if i < 4 else n
        bucket = valid[start:end]
        avg = sum(r[return_key] for r in bucket) / len(bucket)
        out[f"q{i+1}"] = avg
    return out


def _attribute_correlation(rows: list[dict]) -> dict[str, float | None]:
    """每个 sub_score 与 total_return 的 Pearson r。"""
    if len(rows) < 5:
        return {}
    out: dict[str, float | None] = {}
    SUBS = ["moat", "financial", "mgmt", "valuation", "compound"]
    returns = np.array([r["total_return"] for r in rows if r.get("total_return") is not None])
    if len(returns) < 5:
        return {}
    for k in SUBS:
        scores = []
        rets = []
        for r in rows:
            sub = (r.get("sub_scores") or {}).get(k)
            ret = r.get("total_return")
            if sub is not None and ret is not None:
                scores.append(sub)
                rets.append(ret)
        if len(scores) < 5:
            out[k] = None
            continue
        try:
            r = float(np.corrcoef(scores, rets)[0, 1])
            out[k] = r if not (np.isnan(r) or np.isinf(r)) else None
        except Exception:
            out[k] = None
    return out


def run_backtest(
    tickers: list[str],
    *,
    lookback_years: int = 5,
    top_n: int = 30,
    weights: dict | None = None,
    benchmark: str = "SPY",
) -> dict:
    """
    跑近似历史回测。返回：
      {
        ranked: [{ticker, name, value_score, sub_scores, total_return, ...}],
        top_n: int,
        nav: { dates: [...], strategy: [...], benchmark: [...] },
        quintile_returns: { q1: ..., q2: ..., ..., q5: ... },
        attribution: { moat: pearson_r, financial: r, ... },
        meta: { lookback_years, scanned, scored, period }
      }

    每只票 yfinance 调用 ~3 次（info + financials + cashflow + history），
    所以 tickers 列表不宜过长（30-50 只为宜，~ 1-2 分钟）。
    """
    weights = weights or DEFAULT_WEIGHTS
    period = f"{lookback_years}y"

    rows: list[dict] = []
    nav_series: dict[str, pd.Series] = {}

    for ticker in tickers:
        try:
            metrics = fetch_value_metrics(ticker)
            if metrics.get("data_quality") in ("fetch_failed", "yfinance_not_installed"):
                continue
            score = compute_value_score(metrics, peer_metrics=None, weights=weights)
            if score["value_score"] is None:
                continue

            hist = _fetch_price_history(ticker, period=period)
            if hist is None or len(hist) < 6:
                # 不到半年价格 → 跳过
                continue
            total_return = _pct_change(float(hist.iloc[0]), float(hist.iloc[-1]))
            if total_return is None:
                continue

            rows.append({
                "ticker": ticker,
                "name": metrics.get("ticker"),  # yfinance info 不返回简名 fallback
                "industry": metrics.get("industry"),
                "value_score": score["value_score"],
                "sub_scores": score["sub_scores"],
                "total_return": total_return,
                "market_cap": metrics.get("market_cap"),
                "pe_ttm": metrics.get("pe_ttm"),
                "roe_ttm": metrics.get("roe_ttm"),
                "dividend_streak_years": metrics.get("dividend_streak_years"),
            })
            nav_series[ticker] = hist
        except Exception as e:
            log.warning(f"backtest skip {ticker}: {e}")

    if not rows:
        return {
            "ranked": [],
            "top_n": top_n,
            "nav": None,
            "quintile_returns": {},
            "attribution": {},
            "meta": {"lookback_years": lookback_years, "scanned": len(tickers), "scored": 0, "period": period},
        }

    rows.sort(key=lambda r: -(r["value_score"] or 0))
    top = rows[:top_n]
    top_tickers = {r["ticker"] for r in top}

    # 等权净值曲线（top N 的）
    top_nav_series = {t: s for t, s in nav_series.items() if t in top_tickers}
    strategy_nav = _equal_weight_navs(top_nav_series)

    # 基准
    benchmark_nav = _fetch_price_history(benchmark, period=period)
    if benchmark_nav is not None and not benchmark_nav.empty:
        benchmark_nav = benchmark_nav / benchmark_nav.iloc[0]

    nav_payload = None
    if strategy_nav is not None and benchmark_nav is not None:
        # 对齐时间
        df = pd.concat({"strategy": strategy_nav, "benchmark": benchmark_nav}, axis=1).dropna()
        if not df.empty:
            nav_payload = {
                "dates": [d.strftime("%Y-%m-%d") for d in df.index],
                "strategy": [float(v) for v in df["strategy"].tolist()],
                "benchmark": [float(v) for v in df["benchmark"].tolist()],
            }

    return {
        "ranked": top,
        "top_n": top_n,
        "nav": nav_payload,
        "quintile_returns": _quintile_returns(rows),
        "attribution": _attribute_correlation(rows),
        "meta": {
            "lookback_years": lookback_years,
            "scanned": len(tickers),
            "scored": len(rows),
            "period": period,
            "benchmark": benchmark,
        },
    }
