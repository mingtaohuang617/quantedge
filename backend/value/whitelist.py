"""
value.whitelist — 巴菲特持仓白名单（V5 加分项）
=================================================
用作策略对照基准：把这些公开持仓的标的加入观察后，看 5 维评分是否
能识别出"伟大的公司"。也是验证评分模型有效性的简单办法。

数据来源：伯克希尔 13F 公开披露 + 巴菲特致股东信
"""
from __future__ import annotations

BUFFETT_WHITELIST: list[dict] = [
    {
        "ticker": "AAPL",
        "name": "Apple Inc.",
        "since": "2016",
        "thesis": "iOS 生态转换成本极高 + 巨额回购把净利润集中到留存股东",
        "type": "core",
    },
    {
        "ticker": "KO",
        "name": "The Coca-Cola Co.",
        "since": "1988",
        "thesis": "全球品牌护城河 + 200 国家分销网络 + 60+ 年连续分红",
        "type": "core",
    },
    {
        "ticker": "AXP",
        "name": "American Express",
        "since": "1991",
        "thesis": "高净值持卡人转换成本 + 双边网络效应（持卡人 vs 商户）",
        "type": "core",
    },
    {
        "ticker": "MCO",
        "name": "Moody's Corp",
        "since": "2000",
        "thesis": "全球评级行业双寡头（与 S&P）+ 监管护城河",
        "type": "core",
    },
    {
        "ticker": "BAC",
        "name": "Bank of America",
        "since": "2017",
        "thesis": "美国 #2 银行 + 巴菲特优先股转普通股的特殊条款",
        "type": "core",
    },
    {
        "ticker": "OXY",
        "name": "Occidental Petroleum",
        "since": "2022",
        "thesis": "页岩油低成本龙头 + 大宗商品对冲",
        "type": "energy",
    },
    {
        "ticker": "CVX",
        "name": "Chevron Corp",
        "since": "2020",
        "thesis": "一体化能源 + 高分红 + 资本纪律",
        "type": "energy",
    },
    {
        "ticker": "KHC",
        "name": "Kraft Heinz",
        "since": "2015",
        "thesis": "食品消费品牌（巴菲特承认买贵了，但仍持有）",
        "type": "consumer",
    },
    {
        "ticker": "DVA",
        "name": "DaVita Inc.",
        "since": "2012",
        "thesis": "美国肾透析双寡头（与 Fresenius）",
        "type": "healthcare",
    },
    {
        "ticker": "VRSN",
        "name": "VeriSign",
        "since": "2012",
        "thesis": ".com / .net 域名注册局垄断（合同至 2030）",
        "type": "tech_infra",
    },
]


def get_whitelist() -> list[dict]:
    """返回完整白名单。"""
    return list(BUFFETT_WHITELIST)


def is_whitelisted(ticker: str) -> bool:
    """ticker 是否在巴菲特白名单中。"""
    if not ticker:
        return False
    upper = ticker.strip().upper()
    return any(it["ticker"] == upper for it in BUFFETT_WHITELIST)


def whitelist_thesis(ticker: str) -> dict | None:
    """返回白名单标的的 thesis 详情；不在则返回 None。"""
    if not ticker:
        return None
    upper = ticker.strip().upper()
    for it in BUFFETT_WHITELIST:
        if it["ticker"] == upper:
            return dict(it)
    return None
