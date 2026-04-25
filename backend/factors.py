"""
因子计算模块
从原始行情和财务数据计算量化因子
"""
import numpy as np
import pandas as pd


def calc_rsi(prices: pd.Series, period: int = 14) -> float:
    """计算 RSI (Relative Strength Index)"""
    if len(prices) < period + 1:
        return 50.0  # 数据不足时返回中性值

    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)

    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    latest = rsi.dropna().iloc[-1] if not rsi.dropna().empty else 50.0
    return round(float(latest), 1)


def calc_momentum(prices: pd.Series, period: int = 20) -> float:
    """
    计算动量评分 (0-100)
    基于 N 日收益率的百分位排名
    """
    if len(prices) < period + 1:
        return 50.0

    ret = (prices.iloc[-1] / prices.iloc[-period] - 1) * 100

    # 将收益率映射到 0-100 评分
    # -20% -> 0, 0% -> 50, +20% -> 100
    score = 50 + ret * 2.5
    return round(float(np.clip(score, 0, 100)), 1)


def calc_stock_score(
    pe: float | None,
    roe: float | None,
    revenue_growth: float | None,
    profit_margin: float | None,
    momentum: float,
    rsi: float,
    weights: dict | None = None,
    detailed: bool = False,
) -> float | tuple[float, dict]:
    """
    计算个股综合评分 (0-100)
    
    三大维度:
    - 基本面: PE估值 + ROE + 利润率
    - 技术面: 动量 + RSI
    - 成长性: 营收增长率
    """
    if weights is None:
        weights = {"fundamental": 0.40, "technical": 0.30, "growth": 0.30}

    # ── 基本面评分 ──
    # PE: 越低越好 (0-100)，负PE(亏损)给20分
    if pe is None or pe < 0:
        pe_score = 20
    elif pe < 15:
        pe_score = 95
    elif pe < 25:
        pe_score = 80
    elif pe < 40:
        pe_score = 60
    elif pe < 80:
        pe_score = 40
    else:
        pe_score = 20

    # ROE: 越高越好
    if roe is None:
        roe_score = 30
    elif roe > 30:
        roe_score = 95
    elif roe > 20:
        roe_score = 80
    elif roe > 10:
        roe_score = 60
    elif roe > 0:
        roe_score = 40
    else:
        roe_score = 15

    # 利润率
    if profit_margin is None:
        margin_score = 30
    elif profit_margin > 30:
        margin_score = 95
    elif profit_margin > 15:
        margin_score = 75
    elif profit_margin > 5:
        margin_score = 55
    elif profit_margin > 0:
        margin_score = 35
    else:
        margin_score = 15

    fundamental = (pe_score + roe_score + margin_score) / 3

    # ── 技术面评分 ──
    # RSI 在40-60最健康(70分)，超买超卖减分
    if 40 <= rsi <= 60:
        rsi_score = 70
    elif 30 <= rsi <= 70:
        rsi_score = 55
    else:
        rsi_score = 35

    technical = (momentum + rsi_score) / 2

    # ── 成长性评分 ──
    if revenue_growth is None:
        growth = 40
    elif revenue_growth > 50:
        growth = 95
    elif revenue_growth > 25:
        growth = 80
    elif revenue_growth > 10:
        growth = 65
    elif revenue_growth > 0:
        growth = 45
    else:
        growth = 20

    # ── 加权合成 ──
    score = (
        fundamental * weights["fundamental"]
        + technical * weights["technical"]
        + growth * weights["growth"]
    )

    if detailed:
        return round(float(np.clip(score, 0, 100)), 1), {
            "fundamental": round(float(fundamental), 1),
            "technical": round(float(technical), 1),
            "growth": round(float(growth), 1),
        }
    return round(float(np.clip(score, 0, 100)), 1)


def parse_leverage(leverage) -> float | None:
    """解析杠杆字段：'2x' / '-1x' / 2.0 → float；空/无杠杆返回 None"""
    if leverage in (None, "", "None"):
        return None
    if isinstance(leverage, (int, float)):
        return float(leverage)
    s = str(leverage).lower().replace("x", "").strip()
    try:
        val = float(s)
        return val if abs(val) > 1.0001 else None  # 1x 视作非杠杆
    except ValueError:
        return None


def calc_leverage_decay(prices: pd.Series, leverage) -> float | None:
    """
    估算杠杆 ETF 的年化波动磨损率（vol drag）
    -------------------------------------------
    理论：每日复利杠杆 ETF 长期收益 ≈ L·R - (L²-L)/2 · σ²
    其中 L 是杠杆倍数、σ² 是标的的日方差。
    损耗项 = (L²-L)/2 · σ_daily² · 252  → 年化磨损率（%）

    用 ETF 自身的历史日收益估 σ²（除以 L² 还原标的方差）。
    返回单位：百分比 / 年；样本不足返回 None。
    """
    L = parse_leverage(leverage)
    if L is None or len(prices) < 30:
        return None

    daily_returns = prices.pct_change().dropna()
    if len(daily_returns) < 20:
        return None

    # ETF 自身日方差需要还原到标的方差：σ_etf² ≈ L² · σ_underlying²
    sigma_etf_sq = float(daily_returns.var())
    sigma_underlying_sq = sigma_etf_sq / (L * L)

    drag_daily = (L * L - L) / 2 * sigma_underlying_sq
    drag_annual = drag_daily * 252  # 年化
    return round(drag_annual * 100, 2)  # 百分比


def calc_etf_score(
    expense_ratio: float | None,
    premium_discount: float | None,
    aum_usd: float | None,       # AUM 换算为美元
    momentum: float,
    concentration_top3: float | None,
    leverage: str | None,
    detailed: bool = False,
) -> float | tuple[float, dict]:
    """
    计算 ETF 综合评分 (0-100)
    
    维度:
    - 成本效率: 费率 + 折溢价
    - 流动性: AUM规模
    - 动量: 价格趋势
    - 风险: 集中度 + 杠杆惩罚
    """
    # 费率评分 (越低越好)
    if expense_ratio is None:
        er_score = 50
    elif expense_ratio <= 0.3:
        er_score = 95
    elif expense_ratio <= 0.65:
        er_score = 75
    elif expense_ratio <= 1.0:
        er_score = 55
    else:
        er_score = 30  # >1% 很贵

    # 折溢价评分 (越接近0越好)
    pd_abs = abs(premium_discount) if premium_discount is not None else 0
    if pd_abs < 0.5:
        pd_score = 95
    elif pd_abs < 2:
        pd_score = 75
    elif pd_abs < 5:
        pd_score = 55
    elif pd_abs < 10:
        pd_score = 35
    else:
        pd_score = 15

    # AUM 评分
    if aum_usd is None:
        aum_score = 40
    elif aum_usd > 1e9:
        aum_score = 90
    elif aum_usd > 1e8:
        aum_score = 70
    elif aum_usd > 1e7:
        aum_score = 50
    else:
        aum_score = 30

    # 集中度评分 (越分散越好)
    if concentration_top3 is None:
        conc_score = 50
    elif concentration_top3 > 90:
        conc_score = 15
    elif concentration_top3 > 70:
        conc_score = 35
    elif concentration_top3 > 50:
        conc_score = 60
    else:
        conc_score = 85

    # 杠杆惩罚
    leverage_penalty = 15 if leverage else 0

    cost = (er_score + pd_score) / 2
    liquidity = aum_score
    momentum_score = momentum
    risk = conc_score

    score = (
        er_score * 0.20
        + pd_score * 0.20
        + aum_score * 0.15
        + momentum * 0.25
        + conc_score * 0.20
        - leverage_penalty
    )

    if detailed:
        return round(float(np.clip(score, 0, 100)), 1), {
            "cost": round(float(cost), 1),
            "liquidity": round(float(liquidity), 1),
            "momentum": round(float(momentum_score), 1),
            "risk": round(float(risk), 1),
        }
    return round(float(np.clip(score, 0, 100)), 1)
