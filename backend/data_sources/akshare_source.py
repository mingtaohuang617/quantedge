"""
AKShare 数据源
===============
免费开源金融数据接口，数据来自东方财富等。
主要用途: 港股财务数据补充（PE/ROE/营收增长/利润率等）。

pip install akshare
"""
from __future__ import annotations

import sys

import akshare as ak
import pandas as pd


class AKShareError(RuntimeError):
    pass


# ── 容错配置 ─────────────────────────────────────────────

# eastmoney "代码"列实际格式可能漂移；按优先级尝试这些变体匹配
def _code_candidates(symbol: str) -> list[str]:
    """生成可能的 akshare "代码"列值变体。

    >>> _code_candidates("0005.HK")
    ['00005', '0005', '5', '0005.HK', '00005.HK']
    """
    raw = symbol.split(".")[0]
    out: list[str] = []
    # 5 位 zfill（如 "00005"，eastmoney 港股最常用）
    out.append(raw.zfill(5))
    # 原样
    if raw not in out:
        out.append(raw)
    # 去前导零（如 "5"）
    stripped = raw.lstrip("0") or "0"
    if stripped not in out:
        out.append(stripped)
    # 带 .HK 后缀（某些 akshare 版本）
    if "." in symbol:
        if symbol not in out:
            out.append(symbol)
        zfilled_with_suffix = f"{raw.zfill(5)}.{symbol.split('.', 1)[1]}"
        if zfilled_with_suffix not in out:
            out.append(zfilled_with_suffix)
    return out


# eastmoney 实时表的"市盈率"列可能的名字（按版本漂移）
PE_FIELD_CANDIDATES = ["市盈率-动态", "市盈率(动态)", "市盈率", "动态市盈率", "PE", "pe"]
# 总市值列候选
MARKET_CAP_FIELD_CANDIDATES = ["总市值", "市值", "总市值(港元)"]
# 利润表"净利润"候选
NET_PROFIT_CANDIDATES = ["净利润", "归属母公司净利润", "归母净利润", "净利润(亿元)"]
# 利润表"营业收入"候选
REVENUE_CANDIDATES = ["营业收入", "营业总收入", "营业收入(亿元)", "总收入"]
# 资产负债表"股东权益合计"候选
EQUITY_CANDIDATES = ["股东权益合计", "归属母公司股东权益", "所有者权益合计", "净资产"]


# ── helpers ─────────────────────────────────────────────

def _safe_float(val) -> float | None:
    """把 akshare 返回的值容错转 float；占位符（"-" / "--" / "—" / "" / None）→ None。"""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        f = float(val)
        # 排除 NaN / inf
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    s = str(val).strip()
    if s in ("", "-", "--", "—", "N/A", "nan", "NaN"):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _first_field(row_or_dict, candidates: list[str]) -> object:
    """按候选名顺序找到第一个非空值；返回原始值（未转 float）。"""
    for name in candidates:
        if hasattr(row_or_dict, "get"):
            v = row_or_dict.get(name)
        elif name in row_or_dict:  # pandas Series 也支持
            v = row_or_dict[name]
        else:
            v = None
        if v is not None:
            # pandas 的 NaN/None 都视为缺失
            if isinstance(v, float) and v != v:  # NaN
                continue
            return v
    return None


def _log(msg: str) -> None:
    """诊断日志（统一前缀，写 stderr）。"""
    print(f"[akshare_source] {msg}", file=sys.stderr)


# ── 主 API ──────────────────────────────────────────────

def fetch_hk_fundamentals(symbol: str) -> dict:
    """
    获取港股的核心财务指标。
    symbol: 港股代码，接受 "00005" / "0005.HK" / "HK.00005" 等多种格式。

    返回 dict (缺失字段为 None)：
      {pe, roe, revenue_growth, profit_margin, market_cap, eps}

    错误策略：
      - akshare API 异常 → 写诊断日志，对应字段保持 None，不抛错
      - 代码列匹配不上 → 试多种格式（5 位 zfill / 原样 / 去前导零 / 带后缀）
      - 字段名漂移 → 按候选名列表逐一尝试
    """
    result = {
        "pe": None, "roe": None, "revenue_growth": None,
        "profit_margin": None, "market_cap": None, "eps": None,
    }

    codes = _code_candidates(symbol)
    primary_code = codes[0]  # 标准的 zfill 5 位代码用于 stock_financial_hk_report_em

    # ── 1. 实时行情表：PE + 总市值 ──
    try:
        df = ak.stock_hk_spot_em()
        if df is None or df.empty:
            _log(f"{symbol}: stock_hk_spot_em 返回空表")
        elif "代码" not in df.columns:
            _log(f"{symbol}: 找不到 '代码' 列；实际列={list(df.columns)[:6]}...")
        else:
            row = pd.DataFrame()
            matched_code = None
            for c in codes:
                row = df[df["代码"].astype(str) == c]
                if not row.empty:
                    matched_code = c
                    break
            if row.empty:
                _log(f"{symbol}: 代码列无匹配（试过 {codes}），表中样本: {df['代码'].head(3).tolist()}")
            else:
                first_row = row.iloc[0]
                result["pe"] = _safe_float(_first_field(first_row, PE_FIELD_CANDIDATES))
                result["market_cap"] = _safe_float(_first_field(first_row, MARKET_CAP_FIELD_CANDIDATES))
                if result["pe"] is None and result["market_cap"] is None:
                    _log(
                        f"{symbol}: 匹配上代码={matched_code} 但 PE/市值字段都 None "
                        f"(列={list(first_row.index)[:8]}...)"
                    )
    except Exception as e:
        _log(f"{symbol}: stock_hk_spot_em 异常: {e}")

    # ── 2. 利润表：profit_margin + 缓存 net_profit 给 ROE 用 ──
    net_profit = None  # 在 try 外定义，给后面 ROE 块用
    try:
        df = ak.stock_financial_hk_report_em(symbol=primary_code, indicator="利润表")
        if df is None or df.empty:
            _log(f"{symbol}: 利润表为空 (code={primary_code})")
        else:
            latest = df.iloc[0]
            net_profit = _safe_float(_first_field(latest, NET_PROFIT_CANDIDATES))
            revenue = _safe_float(_first_field(latest, REVENUE_CANDIDATES))
            if net_profit is not None and revenue is not None and revenue != 0:
                result["profit_margin"] = round(net_profit / revenue * 100, 1)
            else:
                _log(
                    f"{symbol}: 利润表字段未匹配 net_profit={net_profit} revenue={revenue} "
                    f"(列={list(latest.index)[:8]}...)"
                )
    except Exception as e:
        _log(f"{symbol}: 利润表异常: {e}")

    # ── 3. 资产负债表：用 net_profit / equity 算 ROE ──
    # （修 bug：之前 result.get("_net_profit") 从未被 set，导致 ROE 永远 None）
    try:
        df = ak.stock_financial_hk_report_em(symbol=primary_code, indicator="资产负债表")
        if df is None or df.empty:
            _log(f"{symbol}: 资产负债表为空 (code={primary_code})")
        else:
            equity = _safe_float(_first_field(df.iloc[0], EQUITY_CANDIDATES))
            if equity is not None and equity > 0 and net_profit is not None:
                result["roe"] = round(net_profit / equity * 100, 1)
            elif equity is None:
                _log(
                    f"{symbol}: 资产负债表股东权益未匹配 "
                    f"(列={list(df.iloc[0].index)[:8]}...)"
                )
            # net_profit 是 None → 在利润表块已记录，不重复
    except Exception as e:
        _log(f"{symbol}: 资产负债表异常: {e}")

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
