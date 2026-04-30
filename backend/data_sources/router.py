"""
数据源路由器（多源版）
========================
优先级链: iTick → Futu → yfinance
每一层失败后自动降级到下一层。

行情数据 (K线/报价): iTick → Futu(港股/A股) → yfinance
财务数据:           iTick info + AKShare(港股) + yfinance info

市场支持:
  US (美股)       — iTick → yfinance
  HK (港股)       — iTick → Futu → yfinance
  SH/SZ/CN (A股)  — iTick → Futu → yfinance
  KR (韩股)       — iTick → yfinance     (Futu 不支持)
  JP (日股)       — iTick → yfinance     (Futu 不支持)
"""
import pandas as pd

from . import itick_source, futu_source, yfinance_source, akshare_source

# Futu 支持的市场（其他市场跳过 Futu 这一层）
_FUTU_MARKETS = {"HK", "SH", "SZ", "CN"}


# ── 行情数据 (K线) ────────────────────────────────────────

def fetch_history(cfg: dict, days: int = 120) -> tuple[pd.DataFrame, str]:
    """
    拉取日K线。按优先级尝试多个数据源。
    返回 (DataFrame, source_name)。
    """
    errors = []
    market = (cfg.get("market") or "").upper()

    # 1) iTick — 全市场主力
    try:
        df = itick_source.fetch_history(cfg, days=days)
        if df is not None and len(df) >= 5:
            return df, "iTick"
    except Exception as e:
        errors.append(f"iTick: {e}")

    # 2) Futu — 仅港股/A股
    if market in _FUTU_MARKETS:
        try:
            df = futu_source.fetch_history(cfg, days=days)
            if df is not None and len(df) >= 5:
                return df, "Futu"
        except Exception as e:
            errors.append(f"Futu: {e}")

    # 3) yfinance — 最终兜底（覆盖所有市场，韩日 A股都能拉）
    try:
        df = yfinance_source.fetch_history(cfg, days=days)
        if df is not None and len(df) >= 5:
            return df, "yfinance"
    except Exception as e:
        errors.append(f"yfinance: {e}")

    raise RuntimeError(
        f"所有数据源均失败 ({cfg.get('yf_symbol')}): " +
        " | ".join(errors)
    )


# ── 实时报价 ──────────────────────────────────────────────

def fetch_quote(cfg: dict) -> tuple[dict, str]:
    """
    获取实时报价快照。
    返回 (quote_dict, source_name)。
    """
    try:
        return itick_source.fetch_quote(cfg), "iTick"
    except Exception:
        pass

    # fallback: 用 yfinance 的 fast_info
    try:
        import yfinance as yf
        tk = yf.Ticker(cfg["yf_symbol"])
        fi = tk.fast_info
        return {
            "price": fi.get("lastPrice"),
            "open": fi.get("open"),
            "high": fi.get("dayHigh"),
            "low": fi.get("dayLow"),
            "prev_close": fi.get("previousClose"),
            "volume": fi.get("lastVolume"),
            "change": None,
            "change_pct": None,
        }, "yfinance"
    except Exception:
        pass

    return {}, "none"


# ── 公司信息 (iTick) ─────────────────────────────────────

def fetch_info(cfg: dict) -> tuple[dict, str]:
    """
    获取公司基本信息（市值/PE/行业/简介）。
    返回 (info_dict, source_name)。
    """
    try:
        return itick_source.fetch_info(cfg), "iTick"
    except Exception:
        return {}, "none"


# ── 港股财务补充 (AKShare) ────────────────────────────────

def fetch_hk_fundamentals(cfg: dict) -> tuple[dict, str]:
    """
    获取港股财务数据（PE/ROE/利润率等）。
    仅对 market=HK 的标的有效。
    返回 (fundamentals_dict, source_name)。
    """
    market = (cfg.get("market") or "").upper()
    if market != "HK":
        return {}, "n/a"
    try:
        ticker_key = cfg.get("yf_symbol", "")
        return akshare_source.fetch_hk_fundamentals(ticker_key), "AKShare"
    except Exception:
        return {}, "none"


# ── 搜索 ─────────────────────────────────────────────────

def search_stocks(keyword: str, market: str = "HK") -> pd.DataFrame:
    """按关键词搜索股票（AKShare 源）。"""
    return akshare_source.search_stocks(keyword, market)


# ── 健康检查 ──────────────────────────────────────────────

def health_check() -> dict:
    """检查所有数据源健康状态。"""
    itick_ok, itick_msg = itick_source.health_check()
    futu_ok, futu_msg = futu_source.health_check()
    akshare_ok, akshare_msg = akshare_source.health_check()
    return {
        "iTick": (itick_ok, itick_msg),
        "Futu": (futu_ok, futu_msg),
        "AKShare": (akshare_ok, akshare_msg),
        "yfinance": (True, "yfinance 无需健康检查（按需重试）"),
    }
