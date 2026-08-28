"""
yfinance 数据源
================
用于美股等富途无权限的市场。延迟约 15 分钟，但免费且覆盖全。

可靠性：
  - fetch_history / fetch_fundamentals 用指数退避重试（1s/2s/4s，默认 3 次）
  - fetch_history 每次调用显式传 timeout（默认 30s）防止网络 hang
  - 环境变量可调：
      YFINANCE_RETRY_MAX        默认 3
      YFINANCE_RETRY_BASE_DELAY 默认 1.0 秒
      YFINANCE_HISTORY_TIMEOUT  默认 30 秒（yfinance 内置默认 10s 偏短）
"""
import math
import os
import sys
import time
from datetime import datetime, UTC
from typing import TypeVar
from collections.abc import Callable

import pandas as pd
import yfinance as yf

from ._intervals import Interval, yfinance_period_for


class YFinanceError(RuntimeError):
    pass


# ── 重试参数（环境变量可调）────────────────────────────────
def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


YFINANCE_RETRY_MAX = _env_int("YFINANCE_RETRY_MAX", 3)
YFINANCE_RETRY_BASE_DELAY = _env_float("YFINANCE_RETRY_BASE_DELAY", 1.0)
# yfinance 内置 timeout 默认 10s（PriceHistory.history 签名），偶发短链路 hang
# 30s 给慢网/yfinance 后端高峰留余量；retries 会接力，单次超时会被快速重试
YFINANCE_HISTORY_TIMEOUT = _env_float("YFINANCE_HISTORY_TIMEOUT", 30.0)


_T = TypeVar("_T")


def _with_retry(
    fn: Callable[..., _T],
    *args,
    max_attempts: int | None = None,
    base_delay: float | None = None,
    sleep: Callable[[float], None] | None = None,
    **kwargs,
) -> _T:
    """对 fn(*args, **kwargs) 做指数退避重试：base × 2^attempt 秒。

    捕获 YFinanceError；其他异常会被 fn 调用方包装成 YFinanceError 后再重试。
    最后一次仍失败则把原异常抛出（不再 wrap），保留调用方期望的语义。

    sleep=None 时运行时回退到模块 time.sleep（允许测试 patch yfinance_source.time.sleep）。
    """
    n = max_attempts if max_attempts is not None else YFINANCE_RETRY_MAX
    base = base_delay if base_delay is not None else YFINANCE_RETRY_BASE_DELAY
    n = max(n, 1)
    if sleep is None:
        sleep = time.sleep
    fn_name = getattr(fn, "__name__", repr(fn))
    last_exc: BaseException | None = None
    for attempt in range(n):
        try:
            return fn(*args, **kwargs)
        except YFinanceError as e:
            last_exc = e
            if attempt == n - 1:
                print(
                    f"[yfinance] {fn_name} 重试 {n} 次后放弃: {e}",
                    file=sys.stderr,
                )
                raise
            delay = base * (2 ** attempt)
            print(
                f"[yfinance] {fn_name} 第 {attempt + 1}/{n} 次失败: {e}，"
                f"{delay:.1f}s 后重试",
                file=sys.stderr,
            )
            sleep(delay)
    # 理论不可达（n>=1 保证至少 return 或 raise）
    assert last_exc is not None
    raise last_exc


def _do_fetch_history(
    cfg: dict,
    days: int,
    interval: Interval | str,
) -> pd.DataFrame:
    """单次拉取（无重试）；网络/其他异常一律包成 YFinanceError 抛出。"""
    iv = Interval.from_str(interval)
    symbol = cfg["yf_symbol"]
    period = yfinance_period_for(iv, days)
    tk = yf.Ticker(symbol)
    # timeout 在每次调用时读取，方便测试用 monkeypatch.setattr 改 module 常量
    timeout = YFINANCE_HISTORY_TIMEOUT
    try:
        df = tk.history(period=period, interval=iv.value, timeout=timeout)
        if df is None or df.empty:
            # 仅日 K 做"再试 1mo"兜底；分钟级直接抛错（period 已是上限）
            if not iv.is_intraday:
                df = tk.history(period="1mo", timeout=timeout)
            if df is None or df.empty:
                raise YFinanceError(
                    f"yfinance 无法获取 {symbol} 行情数据 (interval={iv.value})"
                )
    except YFinanceError:
        raise
    except Exception as e:
        raise YFinanceError(
            f"yfinance.history({symbol}, {iv.value}) 异常: {e}"
        ) from e
    out = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    # intraday 统一 UTC；日 K 保持原 tz-naive，避免动既有 daily 调用
    if iv.is_intraday and getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_convert("UTC")
    return out


def fetch_history(
    cfg: dict,
    days: int = 120,
    interval: Interval | str = Interval.DAY_1,
) -> pd.DataFrame:
    """
    拉取 K 线，返回标准化 DataFrame：
      列：Open / High / Low / Close / Volume
      索引：DatetimeIndex
        - 日 K（默认）：tz-naive
        - 分钟/小时级 (intraday)：tz-aware，统一 tz_convert("UTC")

    interval 默认 DAY_1，保持向后兼容。
    分钟级仅 yfinance 7 天滚动窗口可用；超出请用日 K 或外部历史源。

    单标的失败会在内部指数退避重试（默认 3 次），全部失败才抛 YFinanceError。
    """
    return _with_retry(_do_fetch_history, cfg, days, interval)


# ── 价值型基本面字段 ────────────────────────────────────
def _do_fetch_fundamentals_info(yf_symbol: str) -> dict:
    """单次 .info 拉取，网络/其他异常包成 YFinanceError。"""
    tk = yf.Ticker(yf_symbol)
    try:
        info = tk.info or {}
    except YFinanceError:
        raise
    except Exception as e:
        raise YFinanceError(f"yfinance .info 失败 ({yf_symbol}): {e}") from e
    return info


def fetch_fundamentals(yf_symbol: str) -> dict:
    """拉单只标的的估值/质量/股东回报字段。

    返回 5 个 key（缺失时置 None，调用方需容错）：
      - pe: trailingPE (TTM)
      - pb: priceToBook
      - dividend_yield: 0~1 小数（如 0.066 = 6.6%）
      - roe: returnOnEquity，0~1 小数
      - debt_to_equity: yfinance 给的是百分数（如 162 = 1.62），统一除 100 转小数
    任何失败都抛 YFinanceError；上游决定是否跳过。

    .info 失败会指数退避重试（默认 3 次），全部失败才抛。
    """
    if not yf_symbol:
        raise YFinanceError("yf_symbol 不能为空")
    info = _with_retry(_do_fetch_fundamentals_info, yf_symbol)

    def _f(key):
        v = info.get(key)
        if v is None:
            return None
        try:
            f = float(v)
            # NaN/Inf → None
            if math.isnan(f) or math.isinf(f):
                return None
            return f
        except (TypeError, ValueError):
            return None

    de_pct = _f("debtToEquity")
    return {
        "pe": _f("trailingPE"),
        "pb": _f("priceToBook"),
        "dividend_yield": _f("dividendYield"),
        "roe": _f("returnOnEquity"),
        # yfinance debtToEquity 单位是百分比，例如 Verizon 显示 162（=1.62 倍）
        "debt_to_equity": (de_pct / 100.0) if de_pct is not None else None,
    }


# ── 港股财务补充（取代 akshare/eastmoney 兜底）──────────────
def _coerce_float(v) -> float | None:
    """容错转 float；None / NaN / Inf / 非数 → None。"""
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def fetch_hk_fundamentals(yf_symbol: str) -> dict:
    """港股财务补充：从 .info 取 pe / roe / revenue_growth / profit_margin。

    取代原 akshare(eastmoney) 兜底——eastmoney 对 Python TLS 指纹反爬不可用
    （直接 curl 200，但 requests/urllib/curl_cffi 全被 RST）；而 yfinance 本
    就是 pipeline 港股基本面的主源，港股池规模小（.info 不触发限频）足够可靠。

    返回 dict（缺失字段 None），单位与 pipeline 主路径（pipeline.py）严格一致：
      - pe:             trailingPE，round 2
      - roe:            returnOnEquity ×100，round 1（百分比）
      - revenue_growth: revenueGrowth  ×100，round 1（百分比）
      - profit_margin:  profitMargins  ×100，round 1（百分比）

    .info 失败指数退避重试（默认 3 次）；全部失败返回全 None（不抛错，
    让上游 router/pipeline 回落 static_overrides）。
    """
    out = {"pe": None, "roe": None, "revenue_growth": None, "profit_margin": None}
    if not yf_symbol:
        return out
    try:
        info = _with_retry(_do_fetch_fundamentals_info, yf_symbol)
    except Exception:
        return out  # 静默：让上游回落 static_overrides

    pe = _coerce_float(info.get("trailingPE"))
    out["pe"] = round(pe, 2) if pe else None

    roe = _coerce_float(info.get("returnOnEquity"))
    out["roe"] = round(roe * 100, 1) if roe is not None else None

    rg = _coerce_float(info.get("revenueGrowth"))
    out["revenue_growth"] = round(rg * 100, 1) if rg is not None else None

    pm = _coerce_float(info.get("profitMargins"))
    out["profit_margin"] = round(pm * 100, 1) if pm is not None else None

    return out


def fetch_fundamentals_enrich(yf_symbol: str) -> dict:
    """data.js 富化用：一次 .info 取齐 估值/质量/成长 + 行业分类字段。

    用于给 A股/港股回补 yf.info 基本面（与美股同源同口径）。返回 dict（缺失置 None），
    单位严格对齐 data.js（个股口径）：
      - pe:            trailingPE，round 2
      - pb:            priceToBook，round 2（比率，无单位）
      - roe:           returnOnEquity ×100，round 1（百分比，如 31.2）
      - profit_margin: profitMargins ×100，round 1（百分比）
      - revenue_growth:revenueGrowth ×100，round 1（百分比）
      - market_cap:    marketCap（原值，本币）
      - eps:           trailingEps（原值，round 2 —— data.js eps 是裸数）
      - beta:          beta（原值，round 2 —— data.js beta 是裸数）
      - revenue:       totalRevenue → "X.XB"/"X.XT" 字符串（对齐 data.js 展示口径）
      - ebitda:        ebitda → "X.XB"/"X.XT" 字符串（同上）
      - ps:            priceToSalesTrailing12Months，round 2（比率）
      - peg:           trailingPegRatio，round 2（比率，trailing 口径）
      - ev_ebitda:     enterpriseToEbitda，round 2（企业倍数）
      - target_price:  targetMeanPrice（卖方综合目标价，本币，round 2）
      - analyst_count: numberOfAnalystOpinions（覆盖机构家数，int）
      - next_earnings: earningsTimestamp → "YYYY-MM-DD"，仅当在未来才返回
                       （yf 对 A股给的是上次财报日=过去，未来护栏可滤掉，避免误导）
      - sector:        .info sector（英文大类，如 'Consumer Defensive'）
      - industry:      .info industry（英文细类，如 'Banks - Diversified'）
    .info 失败指数退避重试；全部失败返回全 None（不抛错，让上游跳过保原值）。
    """
    out = {"pe": None, "pb": None, "roe": None, "profit_margin": None,
           "revenue_growth": None, "market_cap": None, "eps": None, "beta": None,
           "revenue": None, "ebitda": None, "ps": None, "peg": None, "ev_ebitda": None,
           "target_price": None, "analyst_count": None, "next_earnings": None,
           "sector": None, "industry": None}
    if not yf_symbol:
        return out
    try:
        info = _with_retry(_do_fetch_fundamentals_info, yf_symbol)
    except Exception:
        return out

    pe = _coerce_float(info.get("trailingPE"))
    out["pe"] = round(pe, 2) if pe else None
    pb = _coerce_float(info.get("priceToBook"))
    out["pb"] = round(pb, 2) if pb else None
    roe = _coerce_float(info.get("returnOnEquity"))
    out["roe"] = round(roe * 100, 1) if roe is not None else None
    pm = _coerce_float(info.get("profitMargins"))
    out["profit_margin"] = round(pm * 100, 1) if pm is not None else None
    rg = _coerce_float(info.get("revenueGrowth"))
    out["revenue_growth"] = round(rg * 100, 1) if rg is not None else None
    out["market_cap"] = _coerce_float(info.get("marketCap"))
    eps = _coerce_float(info.get("trailingEps"))
    out["eps"] = round(eps, 2) if eps is not None else None
    beta = _coerce_float(info.get("beta"))
    out["beta"] = round(beta, 2) if beta is not None else None
    out["revenue"] = _fmt_big(_coerce_float(info.get("totalRevenue")))
    out["ebitda"] = _fmt_big(_coerce_float(info.get("ebitda")))
    ps = _coerce_float(info.get("priceToSalesTrailing12Months"))
    out["ps"] = round(ps, 2) if ps and ps > 0 else None
    peg = _coerce_float(info.get("trailingPegRatio"))
    out["peg"] = round(peg, 2) if peg and peg > 0 else None
    eve = _coerce_float(info.get("enterpriseToEbitda"))
    out["ev_ebitda"] = round(eve, 2) if eve and eve > 0 else None
    tgt = _coerce_float(info.get("targetMeanPrice"))
    out["target_price"] = round(tgt, 2) if tgt and tgt > 0 else None
    nac = _coerce_float(info.get("numberOfAnalystOpinions"))
    out["analyst_count"] = int(nac) if nac and nac > 0 else None
    ts = info.get("earningsTimestamp") or info.get("earningsTimestampStart")
    ts = _coerce_float(ts)
    if ts:
        try:
            d = datetime.fromtimestamp(ts, UTC).date()
            if d >= datetime.now(UTC).date():  # 仅未来财报日
                out["next_earnings"] = d.isoformat()
        except (ValueError, OverflowError, OSError):
            pass
    sec = info.get("sector")
    out["sector"] = str(sec).strip() if sec else None
    ind = info.get("industry")
    out["industry"] = str(ind).strip() if ind else None
    return out


def _fmt_big(v: float | None) -> str | None:
    """大额金额 → data.js 展示口径字符串（对齐美股：T 2 位 / B 1 位 / M 整数）。
    None/非有限/<=0 → None（让上游跳过保原值，不写 "0"）。"""
    if v is None or v <= 0:
        return None
    if v >= 1e12:
        return f"{v / 1e12:.2f}T"
    if v >= 1e9:
        return f"{v / 1e9:.1f}B"
    if v >= 1e6:
        return f"{v / 1e6:.0f}M"
    return f"{v:.0f}"
