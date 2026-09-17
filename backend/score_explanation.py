"""Deterministic boundaries for score narratives; no network or model call."""
import math


def build_score_prompt(stock, weights):
    scoring = stock.get('scoring') or {}
    if stock.get('isETF') or scoring.get('status') == 'separate_dimensions' or stock.get('assetType') != 'stock':
        raise ValueError('仅股票完整综合分支持此解读；其他资产分别解释各维度')
    def valid(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100
    score, quality, timing = (stock.get(k) for k in ('score', 'qualityScore', 'timingScore'))
    if not all(valid(v) for v in (score, quality, timing)):
        raise ValueError('缺少有效综合分、质量分或趋势分')
    if not scoring.get('version') or stock.get('modelVersion') != scoring['version']:
        raise ValueError('评分版本缺失或不一致')
    quality_weight, timing_weight = (weights.get(k) for k in ('quality', 'timing'))
    if not all(valid(v) for v in (quality_weight, timing_weight)) or quality_weight + timing_weight <= 0:
        raise ValueError('权重无效')
    wq = quality_weight / (quality_weight + timing_weight)
    if abs(score - (quality * wq + timing * (1-wq))) > .11:
        raise ValueError('综合分与分项及权重不一致')
    return (f"股票 {stock.get('ticker', '?')} 综合分 {score}/100 = 质量 {quality} × {wq:.1%} + 趋势 {timing} × {1-wq:.1%}。\n"
            f"分项：{stock.get('subScores') or {}}。评分依据：{scoring}。\n"
            '用 1–2 句解释哪些分项贡献较高，缺失项明确缺失。评分为实验性描述，尚未通过完整样本外验证；'
            '不能宣称已验证有效，不能将覆盖率解释为准确率、收益率或上涨概率，不给买卖指令。'
            '不使用资产规模替代流动性，不编造财报日期、来源或回测结果。纯文本，不超过 100 字。')
