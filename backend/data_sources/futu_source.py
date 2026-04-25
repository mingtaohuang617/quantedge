"""
Futu OpenD 数据源
==================
支持港股 (HK) 和 A 股 (SH/SZ) 历史日 K 线拉取。
要求本地已启动 Futu OpenD GUI 并登录。
"""
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
