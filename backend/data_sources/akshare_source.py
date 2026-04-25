"""
AKShare 数据源
===============
免费开源金融数据接口，数据来自东方财富等。
主要用途: 港股财务数据补充（PE/ROE/营收增长/利润率等）。

pip install akshare
"""
import akshare as ak
import pandas as pd


class AKShareError(RuntimeError):
    pass


def fetch_hk_fundamentals(symbol: str) -> dict:
    """
    获取港股的核心财务指标。
    symbol: 纯数字代码，如 "00005" / "09988" / "00700"

    返回:
      {pe, roe, revenue_growth, profit_margin, market_cap, eps, ...}
      缺失字段为 None。
    """
    # 去除 .HK 后缀，保留前导零
    code = symbol.split(".")[0]
    if len(code) < 5:
        code = code.zfill(5)

    result = {
        "pe": None, "roe": None, "revenue_growth": None,
        "profit_margin": None, "market_cap": None, "eps": None,
    }

    try:
        # 港股实时行情（东方财富源）—— 包含 PE / 市值 / 涨跌
        df = ak.stock_hk_spot_em()
        if df is not None and not df.empty:
            row = df[df["代码"] == code]
            if not row.empty:
                row = row.iloc[0]
                result["pe"] = _safe_float(row.get("市盈率-动态"))
                result["market_cap"] = _safe_float(row.get("总市值"))
    except Exception:
        pass

    try:
        # 港股财务指标（利润表摘要）
        df = ak.stock_financial_hk_report_em(symbol=code, indicator="利润表")
        if df is not None and not df.empty:
            latest = df.iloc[0]  # 最新一期
            net_profit = _safe_float(latest.get("净利润"))
            revenue = _safe_float(latest.get("营业收入"))
            if net_profit is not None and revenue is not None and revenue != 0:
                result["profit_margin"] = round(net_profit / revenue * 100, 1)
    except Exception:
        pass

    try:
        # 港股财务指标（资产负债表 → ROE 近似）
        df = ak.stock_financial_hk_report_em(symbol=code, indicator="资产负债表")
        if df is not None and not df.empty:
            equity = _safe_float(df.iloc[0].get("股东权益合计"))
            if equity and equity > 0 and result.get("_net_profit"):
                result["roe"] = round(result["_net_profit"] / equity * 100, 1)
    except Exception:
        pass

    return result


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
        raise AKShareError(f"AKShare 搜索失败: {e}")


def health_check() -> tuple[bool, str]:
    """检查 AKShare 是否可用。"""
    try:
        df = ak.stock_hk_spot_em()
        if df is not None and not df.empty:
            return True, f"AKShare 正常 (港股 {len(df)} 只)"
        return False, "AKShare 返回空数据"
    except Exception as e:
        return False, f"AKShare 异常: {e}"


def _safe_float(val) -> float | None:
    if val is None or val == "" or val == "--":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
