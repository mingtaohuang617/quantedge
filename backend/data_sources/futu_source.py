"""
Futu OpenD 数据源
==================
支持港股 (HK) 和 A 股 (SH/SZ) 历史日 K 线拉取。
要求本地已启动 Futu OpenD GUI 并登录。
"""
import time
from datetime import datetime, timedelta

import pandas as pd
from futu import OpenQuoteContext, RET_OK, KLType, AuType


FUTU_HOST = "127.0.0.1"
FUTU_PORT = 11111


class FutuError(RuntimeError):
    """Futu 数据拉取错误（连接 / 权限 / 接口失败）"""


def to_futu_symbol(cfg: dict) -> str:
    """
    从 config 字典获取 Futu 格式代码。
    优先使用显式的 futu_symbol，否则按 market 自动转换 yf_symbol。
    """
    if cfg.get("futu_symbol"):
        return cfg["futu_symbol"]

    market = cfg.get("market", "").upper()
    yf_sym = cfg["yf_symbol"]

    if market == "HK":
        # yfinance: "0005.HK" → futu: "HK.00005"
        base = yf_sym.split(".")[0]
        return f"HK.{base.zfill(5)}"
    if market in ("SH", "CN"):
        return f"SH.{yf_sym.split('.')[0]}"
    if market == "SZ":
        return f"SZ.{yf_sym.split('.')[0]}"

    raise FutuError(f"无法将 {yf_sym} (market={market}) 转换为 Futu 代码")


def fetch_history(cfg: dict, days: int = 120) -> pd.DataFrame:
    """
    拉取日 K 线，返回与 yfinance.history() 兼容的 DataFrame：
    列：Open / High / Low / Close / Volume
    索引：DatetimeIndex（升序）
    """
    symbol = to_futu_symbol(cfg)
    end = datetime.now().date()
    start = end - timedelta(days=days + 30)  # 多取一些缓冲，避免节假日导致样本不足

    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        ret, df, _ = ctx.request_history_kline(
            symbol,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            ktype=KLType.K_DAY,
            autype=AuType.QFQ,  # 前复权
            max_count=days + 30,
        )
        if ret != RET_OK:
            raise FutuError(f"Futu 拉取 {symbol} 失败: {df}")
        if df is None or df.empty:
            raise FutuError(f"Futu 返回空数据: {symbol}")

        # 标准化为 yfinance 风格
        df = df.rename(columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        })
        df["time_key"] = pd.to_datetime(df["time_key"])
        df = df.set_index("time_key").sort_index()
        return df[["Open", "High", "Low", "Close", "Volume"]]
    finally:
        ctx.close()


# ── 价值型基本面字段（HK 批量）─────────────────────────
def fetch_fundamentals_hk(futu_codes: list[str], batch_size: int = 200,
                          sleep_sec: float = 1.0) -> dict[str, dict]:
    """批量拉港股基本面字段。

    返回 {futu_code: {pe, pb, dividend_yield, roe, debt_to_equity}}
    数据来源：
      - get_market_snapshot(批量)：pe_ratio / pb_ratio / dividend_ratio_ttm（已经是百分比，转小数）
      - 暂不调 get_financial_report 拿 ROE/D/E：单股 1 次调用，3000+ 票拉太久
        ROE / debt_to_equity 留 None；用户能用 PE/PB/股息率 3 维筛即可

    单批最多 200（OpenD 限制）；批间 sleep 1s 避免限频。
    所有 futu_codes 都不通时返回空 dict（不抛错，让上游知道全市场缺数据）。
    """
    out: dict[str, dict] = {}
    if not futu_codes:
        return out

    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        # health check
        ret, gs = ctx.get_global_state()
        if ret != RET_OK or not gs.get("qot_logined"):
            raise FutuError(f"OpenD 不可达或未登录行情: {gs}")

        for i in range(0, len(futu_codes), batch_size):
            chunk = futu_codes[i:i + batch_size]
            ret, df = ctx.get_market_snapshot(chunk)
            if ret != RET_OK:
                # 单批失败不阻塞全局，sleep 后继续
                time.sleep(sleep_sec * 2)
                continue
            for _, row in df.iterrows():
                code = str(row.get("code", "")).strip()
                if not code:
                    continue
                pe = row.get("pe_ratio")
                pb = row.get("pb_ratio")
                dv = row.get("dividend_ratio_ttm")
                out[code] = {
                    "pe": float(pe) if pe is not None and pe != 0 else None,
                    "pb": float(pb) if pb is not None and pb != 0 else None,
                    "dividend_yield": (float(dv) / 100.0) if dv is not None else None,  # snapshot 单位 %
                    "roe": None,
                    "debt_to_equity": None,
                }
            time.sleep(sleep_sec)
    finally:
        ctx.close()
    return out


def health_check() -> tuple[bool, str]:
    """检查 OpenD 是否在线、行情已登录。返回 (ok, message)。"""
    try:
        ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
        try:
            ret, data = ctx.get_global_state()
            if ret != RET_OK:
                return False, f"OpenD get_global_state 失败: {data}"
            if not data.get("qot_logined"):
                return False, "OpenD 未登录行情服务，请在 GUI 中登录"
            return True, f"OpenD 正常 (server_ver={data.get('server_ver')})"
        finally:
            ctx.close()
    except Exception as e:
        return False, f"无法连接 OpenD ({FUTU_HOST}:{FUTU_PORT}): {e}"
