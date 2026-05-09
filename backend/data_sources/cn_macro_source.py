"""
A 股宏观/资金面数据源（W6 对照层）
====================================
混合 akshare（免费、宏观月度）+ tushare（北向资金）。
失败 graceful：缺接口或网络抖动不影响其他因子。
"""
from __future__ import annotations

import os
from typing import Any

import pandas as pd

import factors_lib as _fl

try:
    import akshare as ak
    HAS_AK = True
except ImportError:
    HAS_AK = False

try:
    import tushare as ts
    HAS_TS = True
except ImportError:
    HAS_TS = False


# ── tushare 单例 ────────────────────────────────────────
_pro = None


def _get_pro():
    global _pro
    if _pro is not None:
        return _pro
    if not HAS_TS:
        raise RuntimeError("tushare 未安装")
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("TUSHARE_TOKEN 未设置")
    ts.set_token(token)
    _pro = ts.pro_api()
    return _pro


# ── 工具：月份字符串 "2024年12月" → "2024-12-01" ─────────
def _ym_cn_to_iso(s: str) -> str | None:
    s = str(s).strip()
    try:
        if "年" in s and "月" in s:
            y = s.split("年")[0]
            m = s.split("年")[1].split("月")[0]
            return f"{int(y):04d}-{int(m):02d}-01"
        # 已经是 'YYYY-MM' 或 'YYYY/MM' 格式
        if len(s) >= 7:
            try:
                return pd.to_datetime(s).strftime("%Y-%m-01")
            except Exception:
                return None
        return None
    except Exception:
        return None


# ── 6 个 fetcher ─────────────────────────────────────────
def fetch_cn_m2_yoy() -> list[dict]:
    """M2 同比增速（%，月度，akshare）"""
    df = ak.macro_china_money_supply()
    # 列名：月份 / M2 同比增长
    cols = list(df.columns)
    yoy_col = next((c for c in cols if "M2" in c and "同比" in c), None)
    month_col = next((c for c in cols if "月份" in c or "月" == c), cols[0])
    if not yoy_col:
        raise RuntimeError(f"找不到 M2 同比列：{cols}")
    rows = []
    for _, r in df.iterrows():
        d = _ym_cn_to_iso(r[month_col])
        v = r[yoy_col]
        if d is None or pd.isna(v):
            continue
        try:
            rows.append({"value_date": d, "publish_date": d, "value": float(v)})
        except (ValueError, TypeError):
            continue
    rows.sort(key=lambda x: x["value_date"])
    return rows


def fetch_cn_cpi_yoy() -> list[dict]:
    """CPI 同比（%，月度，akshare）"""
    df = ak.macro_china_cpi_yearly()
    # 列：日期 / 今值 / 预测值 / 前值
    rows = []
    for _, r in df.iterrows():
        d = pd.to_datetime(r.get("日期"), errors="coerce")
        v = r.get("今值")
        if pd.isna(d) or pd.isna(v):
            continue
        try:
            rows.append({
                "value_date": d.strftime("%Y-%m-01"),
                "publish_date": d.strftime("%Y-%m-%d"),
                "value": float(v),
            })
        except (ValueError, TypeError):
            continue
    rows.sort(key=lambda x: x["value_date"])
    return rows


def fetch_cn_northbound_daily() -> list[dict]:
    """北向资金每日净流入（万元，tushare moneyflow_hsgt 拉近 5 年）"""
    pro = _get_pro()
    end = pd.Timestamp.now().strftime("%Y%m%d")
    start = (pd.Timestamp.now() - pd.Timedelta(days=2000)).strftime("%Y%m%d")
    df = pro.moneyflow_hsgt(start_date=start, end_date=end)
    rows = []
    for _, r in df.iterrows():
        d = str(r["trade_date"])  # 'YYYYMMDD'
        if len(d) != 8:
            continue
        date_str = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        v = r.get("north_money")
        if pd.isna(v):
            continue
        rows.append({
            "value_date": date_str, "publish_date": date_str,
            "value": float(v),
        })
    rows.sort(key=lambda x: x["value_date"])
    return rows


def fetch_cn_margin_balance() -> list[dict]:
    """沪市融资余额（元，日频，akshare）"""
    end = pd.Timestamp.now().strftime("%Y%m%d")
    start = (pd.Timestamp.now() - pd.Timedelta(days=1500)).strftime("%Y%m%d")
    df = ak.stock_margin_sse(start_date=start, end_date=end)
    # 列：信用交易日期 / 融资余额 / 融资买入额 / 融券余量 / 融券余量金额 / 融券卖出量
    rows = []
    for _, r in df.iterrows():
        d = str(r.get("信用交易日期", ""))
        if len(d) != 8:
            continue
        date_str = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        v = r.get("融资余额")
        if pd.isna(v):
            continue
        rows.append({
            "value_date": date_str, "publish_date": date_str,
            "value": float(v),
        })
    rows.sort(key=lambda x: x["value_date"])
    return rows


def fetch_cn_new_account() -> list[dict]:
    """新增证券投资者数量（万人，月度，akshare）"""
    df = ak.stock_account_statistics_em()
    # 列：数据日期 / 新增投资者-数量 / ...
    rows = []
    for _, r in df.iterrows():
        d = pd.to_datetime(r.get("数据日期"), errors="coerce")
        v = r.get("新增投资者-数量")
        if pd.isna(d) or pd.isna(v):
            continue
        rows.append({
            "value_date": d.strftime("%Y-%m-01"),
            "publish_date": d.strftime("%Y-%m-%d"),
            "value": float(v),
        })
    rows.sort(key=lambda x: x["value_date"])
    return rows


def fetch_csi300_pe() -> list[dict]:
    """沪深 300 滚动市盈率（日频，akshare）"""
    df = ak.stock_index_pe_lg(symbol="沪深300")
    # 列：日期 / 指数 / 等权静态市盈率 / 静态市盈率 / ... / 滚动市盈率
    pe_col = next((c for c in df.columns if "滚动市盈率" in c and "中位数" not in c and "等权" not in c), None)
    if not pe_col:
        pe_col = next((c for c in df.columns if "静态市盈率" in c and "中位数" not in c and "等权" not in c), None)
    if not pe_col:
        raise RuntimeError(f"找不到沪深 300 PE 列: {list(df.columns)}")
    rows = []
    for _, r in df.iterrows():
        d = pd.to_datetime(r.get("日期"), errors="coerce")
        v = r.get(pe_col)
        if pd.isna(d) or pd.isna(v):
            continue
        rows.append({
            "value_date": d.strftime("%Y-%m-%d"),
            "publish_date": d.strftime("%Y-%m-%d"),
            "value": float(v),
        })
    rows.sort(key=lambda x: x["value_date"])
    return rows


# ── sync 包装：把 fetcher 写到 series_observations ───────
SERIES_DEFS: list[dict[str, Any]] = [
    {"id": "CN_M2_YOY",          "name": "中国 M2 同比",        "freq": "monthly", "source": "akshare",  "fetch": fetch_cn_m2_yoy},
    {"id": "CN_CPI_YOY",         "name": "中国 CPI 同比",       "freq": "monthly", "source": "akshare",  "fetch": fetch_cn_cpi_yoy},
    {"id": "CN_NORTHBOUND_DAILY","name": "北向资金每日净流入",  "freq": "daily",   "source": "tushare",  "fetch": fetch_cn_northbound_daily},
    {"id": "CN_MARGIN_BAL",      "name": "沪市融资余额",        "freq": "daily",   "source": "akshare",  "fetch": fetch_cn_margin_balance},
    {"id": "CN_NEW_ACCOUNT",     "name": "新增证券投资者数",    "freq": "monthly", "source": "akshare",  "fetch": fetch_cn_new_account},
    {"id": "CN_CSI300_PE",       "name": "沪深 300 滚动 PE",    "freq": "daily",   "source": "akshare",  "fetch": fetch_csi300_pe},
]


def sync_all() -> dict[str, int]:
    """端到端：拉所有 6 个 A 股序列，写 series_meta + series_observations。"""
    out = {}
    for s in SERIES_DEFS:
        try:
            rows = s["fetch"]()
            _fl.upsert_series_meta(
                series_id=s["id"], name=s["name"], source=s["source"],
                source_id=s["fetch"].__name__, frequency=s["freq"], market="CN",
                description=f"{s['source']} - {s['fetch'].__name__}",
            )
            n = _fl.upsert_observations(s["id"], rows, source=s["source"])
            out[s["id"]] = n
        except Exception as e:
            print(f"  [fail] {s['id']:20s} {type(e).__name__}: {str(e)[:120]}")
    return out
