"""Read-only scoring audit and explicitly exploratory, dated trend diagnostics.

This adapter cannot certify PIT fundamentals, historical membership or total returns.
Strict mode therefore fails closed; diagnostic mode never authorizes model changes.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import sqlite3
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from backtest_scoring import spearman
from scoring import MODEL_VERSION, asset_metadata, score_universe

ROOT = Path(__file__).resolve().parents[1]
METADATA = ('ticker', 'market', 'isETF', 'quoteType', 'assetType', 'leverage',
            'underlyingType', 'underlyingSymbol', 'benchmark', 'etfType',
            'cryptoCategory', 'gicsSector', 'yfSector')
BLOCKERS = {
    'return_basis': '数据库混有不复权 Close 与前复权序列，缺少逐条复权版本及分红/拆并股记录。',
    'historical_membership': '当前标的池不能还原历史成员、退市收益和历史行业分类。',
    'fundamental_vintages': '没有个股财报原始版本、公开时间与修订历史，禁止回填当前基本面。',
    'session_calendars': '缺少经过验证的市场交易日历；探索性检验仅用同组观测日期并集。',
    'product_vintages': 'ETF 费用、价差、NAV 与目标倍数缺少可检验的历史版本序列。',
}


def finite_positive(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def load_inputs(database, snapshot):
    """Single SQLite read transaction; never initialize or migrate the database."""
    text = snapshot.read_text(encoding='utf-8')
    stocks = json.loads(text.split('export const STOCKS =', 1)[1].split('export const ALERTS', 1)[0].strip().rstrip(';'))
    bars = defaultdict(list)
    digest = hashlib.sha256()
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        conn.execute('BEGIN')
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for ticker, day, close, source, factor, ingested in conn.execute(
            'SELECT ticker,trade_date,close,source,adj_factor,ingested_at FROM daily_bars ORDER BY ticker,trade_date'
        ):
            row = {'date': day, 'close': close, 'source': source, 'adj_factor': factor, 'ingested_at': ingested}
            bars[ticker].append(row)
            digest.update(json.dumps([ticker, row], sort_keys=True).encode())
    if len({s['ticker'] for s in stocks}) != len(stocks):
        raise ValueError('Duplicate snapshot tickers')
    return stocks, dict(bars), {'bars_sha256': digest.hexdigest(), 'snapshot_sha256': hashlib.sha256(snapshot.read_bytes()).hexdigest(), 'tables': tables}


def inspect_series(rows):
    issues = []
    days = [r['date'] for r in rows]
    try:
        valid_dates = all(date.fromisoformat(d).isoformat() == d for d in days)
    except (ValueError, TypeError):
        valid_dates = False
    if not valid_dates or days != sorted(set(days)):
        issues.append('invalid_or_duplicate_dates')
    if any(not finite_positive(r.get('close')) for r in rows):
        issues.append('invalid_close')
    if len({r.get('source') for r in rows}) > 1:
        issues.append('mixed_sources')
    if 'invalid_close' not in issues and any(abs(b['close'] / a['close'] - 1) > .5 for a, b in zip(rows[:-1], rows[1:], strict=True)):
        issues.append('unreviewed_jump_over_50pct')
    return issues


def audit(stocks, bars, provenance):
    per_asset, classes = {}, Counter()
    for s in stocks:
        meta = asset_metadata(s)
        classes[meta['assetType']] += 1
        rows = bars.get(s['ticker'], [])
        per_asset[s['ticker']] = {'asset_type': meta['assetType'], 'rows': len(rows),
            'first': rows[0]['date'] if rows else None, 'last': rows[-1]['date'] if rows else None,
            'sources': sorted({r['source'] for r in rows}), 'issues': inspect_series(rows)}
    all_rows = [r for rows in bars.values() for r in rows]
    return {'model_version': MODEL_VERSION, 'provenance': provenance,
        'database': {'rows': len(all_rows), 'tickers': len(bars),
                     'first': min(r['date'] for r in all_rows) if all_rows else None,
                     'last': max(r['date'] for r in all_rows) if all_rows else None,
                     'sources': dict(Counter(r['source'] for r in all_rows))},
        'snapshot_classes': dict(classes), 'assets': per_asset,
        'strict_status': 'blocked', 'blockers': BLOCKERS, 'model_change_allowed': False}


def point_in_time_record(records, signal_date):
    """Date-only publication is conservatively usable the following day.

    Retain original filings and revisions separately; period end is never availability.
    This selection utility does not claim the existing database contains these records.
    """
    if date.fromisoformat(signal_date).isoformat() != signal_date:
        raise ValueError('Expected ISO date')
    eligible = []
    for r in records:
        try:
            valid = all(date.fromisoformat(r[k]).isoformat() == r[k] for k in ('available_at', 'period_end'))
        except (KeyError, TypeError, ValueError):
            continue
        if valid and r.get('source') and r.get('version') and r['period_end'] <= r['available_at'] < signal_date:
            eligible.append(r)
    return max(eligible, key=lambda r: (r['period_end'], r['available_at'])) if eligible else None


def score_on_date(members, bars, day):
    work, trunc = [], {}
    for s in members:
        ticker = s['ticker']
        rows = bars[ticker]
        n = bisect.bisect_right([r['date'] for r in rows], day)
        if n < 200 or rows[n - 1]['date'] != day:
            continue
        work.append({k: s[k] for k in METADATA if k in s})
        trunc[ticker] = rows[:n]
    score_universe(work, trunc)
    return work


def forward_outcome(rows_by_date, calendar, signal_index, horizon, cost_bps):
    """Signal at T close; entry T+1 close, exit T+1+H close; no same-close fill.

    Requires every session in the observed group calendar; no forward fill across gaps.
    Returns drawdown over the same holding interval, not a portfolio NAV drawdown.
    """
    end = signal_index + 1 + horizon
    if end >= len(calendar):
        return None
    days = calendar[signal_index + 1:end + 1]
    if any(d not in rows_by_date for d in days):
        return None
    prices = [rows_by_date[d]['close'] for d in days]
    if not all(finite_positive(p) for p in prices):
        return None
    gross = prices[-1] / prices[0] - 1
    net = prices[-1] * (1 - cost_bps / 10000) / (prices[0] * (1 + cost_bps / 10000)) - 1
    peak, drawdown = prices[0], 0.
    for price in prices:
        peak = max(peak, price)
        drawdown = min(drawdown, price / peak - 1)
    return {'gross': gross, 'net': net, 'drawdown': drawdown, 'entry': days[0], 'exit': days[-1]}


def split_label(exit_date, signal_date, cutoff):
    if exit_date < cutoff:
        return 'development'
    if signal_date >= cutoff:
        return 'holdout'
    return 'purged'


def summarize_cohort(items):
    scores = [x['score'] for x in items]
    result = {'n': len(items), 'ic': spearman(scores, [x['gross'] for x in items]),
              'drawdown_ic': spearman(scores, [x['drawdown'] for x in items])}
    # Ties at the cutoffs are excluded, never resolved using ticker order or returns.
    low, high = sorted(scores)[len(scores) // 5], sorted(scores)[len(scores) * 4 // 5]
    bottom, top = [x for x in items if x['score'] < low], [x for x in items if x['score'] > high]
    if not top or not bottom or high <= low:
        return {**result, 'spread_gross': None, 'top_net': None, 'top_drawdown': None}
    return {**result, 'spread_gross': statistics.mean(x['gross'] for x in top) - statistics.mean(x['gross'] for x in bottom),
            'top_net': statistics.mean(x['net'] for x in top),
            'top_drawdown': statistics.mean(x['drawdown'] for x in top)}


def diagnose(stocks, bars, report, horizons=(20, 60, 120), costs=(0, 10, 25, 50)):
    groups = defaultdict(list)
    for s in stocks:
        meta = asset_metadata(s)
        groups[(s.get('market', 'unknown'), meta['assetType'], meta['direction'], s.get('cryptoCategory', 'none'))].append(s)
    cohorts, exclusions, coverage = [], Counter(), []
    for group, members in sorted(groups.items()):
        valid = [s for s in members if len(bars.get(s['ticker'], [])) >= 200 and not report['assets'][s['ticker']]['issues']]
        coverage.append({'group': list(group), 'members': len(members), 'diagnostic_eligible': len(valid)})
        if len(valid) < 8:
            continue
        calendar = sorted({r['date'] for s in valid for r in bars[s['ticker']]})
        maps = {s['ticker']: {r['date']: r for r in bars[s['ticker']]} for s in valid}
        # Fixed chronological holdout; no weights/thresholds fitted on either split.
        cutoff = calendar[int(len(calendar) * .7)]
        for h in horizons:
            # Non-overlapping forward intervals for each horizon and group.
            for index in range(199, len(calendar) - h - 1, h + 1):
                day = calendar[index]
                work = score_on_date(valid, bars, day)
                for dimension in ('timingScore', 'momentum', 'trend', 'rsi'):
                    scored = [(s['ticker'], s.get(dimension) if dimension == 'timingScore' else s['subScores'].get(dimension)) for s in work]
                    scored = [(t, v) for t, v in scored if v is not None]
                    if len(scored) < 8:
                        exclusions['small_cohort'] += 1
                        continue
                    split = split_label(calendar[index + h + 1], day, cutoff)
                    if split == 'purged':
                        exclusions['overlaps_holdout_boundary'] += 1
                        continue
                    for cost in costs:
                        items = []
                        for ticker, value in scored:
                            outcome = forward_outcome(maps[ticker], calendar, index, h, cost)
                            if outcome is not None:
                                items.append({'score': value, **outcome})
                        # No survivor-only label subset: reject the whole incomplete cohort.
                        if len(items) != len(scored):
                            exclusions['incomplete_forward_cohort'] += 1
                            continue
                        cohorts.append({'group': list(group), 'date': day, 'cutoff': cutoff, 'horizon': h,
                                        'cost_bps_per_side': cost, 'dimension': dimension, 'split': split,
                                        **summarize_cohort(items)})
    buckets = defaultdict(list)
    for row in cohorts:
        buckets[(*row['group'], row['horizon'], row['cost_bps_per_side'], row['dimension'], row['split'])].append(row)
    summary = []
    for key, values in sorted(buckets.items()):
        metric = {}
        for field in ('ic', 'drawdown_ic', 'spread_gross', 'top_net', 'top_drawdown'):
            observations = [r[field] for r in values if r[field] is not None]
            metric[field] = statistics.mean(observations) if observations else None
            metric[field + '_windows'] = len(observations)
        summary.append({'key': list(key), 'windows': len(values), **metric,
                        'evidence': 'insufficient_windows' if metric['ic_windows'] < 12 else 'exploratory_only'})
    return {'status': 'exploratory_only', 'coverage': coverage, 'excluded_cohorts': dict(exclusions),
            'summary': summary, 'cohorts': cohorts, 'model_change_allowed': False,
            'limitations': ['current-universe selection bias', 'whole-series quality screening and rejected cohorts can cause selection bias', 'unverified return adjustments',
                            'no authoritative exchange calendars', 'no fitted model or statistical significance claim',
                            'cost scenarios are assumptions; no borrow, financing or tax model',
                            'window drawdown and top-bottom spread are not a tradable portfolio backtest']}


def render_report(report):
    issues = Counter(i for a in report['assets'].values() for i in a['issues'])
    db = report['database']
    lines = ['# 评分有效性验证：第一轮结果', '',
             '结论：严格验证未通过数据准入，保持线上 3.2.0 权重和阈值不变。以下结果仅为探索性诊断，不是评分有效或无效的证明。', '',
             '## 数据证据', '',
             f"- 日线库：{db['rows']:,} 行、{db['tickers']} 个标的，区间 {db['first']} 至 {db['last']}。这不是实时行情。",
             f"- 当前评分快照：{len(report['assets'])} 个标的；类别分布见 audit.json。",
             f"- 混合行情源：{issues['mixed_sources']} 个；待核查单日涨跌超过 50%：{issues['unreviewed_jump_over_50pct']} 个。两类可能重叠；跳变不等于错误。",
             '- 加密货币样本为零，不能对其趋势或基本面作有效性判断。',
             '- 数据读取采用 SQLite 只读事务，没有初始化或修改数据库。', '',
             '## 第一阶段：历史检验方法', '',
             '- 旧 CLI 已停用：它混用当前基本面与各股票倒数位置，可能发生未来信息泄漏和跨日期比较。',
             '- 新入口按市场、资产类型、多空方向及加密分类分组，以同一个日期重算趋势。当前财务值和历史评分字段不进入输入。',
             '- 200 根观测预热；信号日收盘后，下一交易日收盘成交，持有 20／60／120 个观测交易日。',
             '- 单边成本情景为 0／10／25／50 bps，买卖各计一次；是敏感性假设，不是实测费率，不含税、融资和借券成本。',
             '- 每个期限的持有区间互不重叠；按组内日历前 70% 与后 30% 分开发期和后期保留集；跨边界收益剔除。没有训练或调参，因此后期结果不是已校准模型的正式样本外证明。',
             '- 最少 8 个评分可用标的；未来观测缺失使整组退出，不能只删除没有结果的标的。五分位边界并列分数不任意拆分。',
             '- 回撤是单标的持有窗口最大回撤的组均值；组间收益差不是可交易多空组合净值。', '',
             '## 第二阶段：资产类型验收', '',
             '| 资产类型 | 当前验收结论 | 主要缺口 |',
             '|---|---|---|',
             '| 股票质量／综合分 | 不计算历史 IC | 个股财报公开时间、原始版本、修订历史和历史分类 |',
             '| 股票趋势 | 仅探索性诊断 | 总回报口径、历史成员、退市收益、交易日历 |',
             '| 指数 ETF | 未通过有效性验证 | 样本不足、历史费用/价差/基准跟踪和持仓穿透 |',
             '| 单股杠杆 ETF | 未通过有效性验证 | 样本不足、公司行动核验的 NAV 与标的收益序列 |',
             '| 指数杠杆 ETF | TQQQ 可复核短期路径，不验证产品分 | 仅 52 个日收益、没有评分预测效果的历史面板 |',
             '| 加密货币 | 无法检验 | 当前快照没有加密资产，需独立 24/7 日历和可靠行情 |', '',
             '## 后期保留集：20 日趋势诊断', '',
             '单边成本 10 bps。IC 是评分与未来收益的秩相关；数值高低不能替代数据准入和统计检验。', '',
             '| 市场 | 有效窗口 | 收益 IC 均值 | 高分组净收益均值 | 高分组窗口回撤均值 |',
             '|---|---:|---:|---:|---:|']
    for row in report.get('diagnostic', {}).get('summary', []):
        key = row['key']
        if key[4:] == [20, 10, 'timingScore', 'holdout']:
            fmt = lambda v: '缺失' if v is None else f'{v:.2%}'
            ic = '缺失' if row['ic'] is None else f"{row['ic']:.4f}"
            lines.append(f"| {key[0]} | {row['ic_windows']} | {ic} | {fmt(row['top_net'])} | {fmt(row['top_drawdown'])} |")
    lines += ['', '窗口数不足，且当前标的池、整段质量筛选与缺失窗口剔除仍可能带来选择偏差；不报告显著性、年化收益或胜率承诺。12 个窗口仅为研究报告的最低样本提示，不是有效性的判断阈值。', '',
              '## 第三阶段：模型决策', '',
              '保持质量 60%／趋势 40% 及现有子因子权重不变。当前诊断不支持提高、降低或删除任一因子。ETF 执行质量和持有路径继续分开，不将其包装为收益预测分。', '',
              '## 下一入口与验收条件', '',
              '- 先修复价格证据：按源保留原始 OHLC、分红、拆并股、调整因子及版本，形成统一总回报序列；现有 adj_factor 全为 1 不能证明已经复权。',
              '- 补历史标的成员、退市收益、当时行业分类及交易日历；按时间过滤，不能拿今日池子声称全市场有效。',
              '- 接入原始财报和公开时间。美国公司可从 SEC submissions/companyfacts 起步，按提交/接受时间及版本筛选；不能把报告期末当公开日，也不能覆盖原值。',
              '- ETF 保存费用有效期、价差窗口、NAV、基准总回报及目标倍数历史；EWY/RKLX 的缺项继续保留为空。',
              '- 加密资产单列时区、交易所、稳定币、代币更名/迁移与退市规则，再进入趋势检验。',
              '- 数据准入通过后冻结开发/验证/测试区间，再做行业内 IC、成本后组合收益与区块重采样；保留未参与调参的最终测试集，禁止见到结果后改变划分。', '',
              '## 可复现证据', '',
              '- [完整审计与窗口结果](audit.json)', '- [TQQQ 实际持有路径复核](product-paths.json)',
              f"- 日线序列 SHA-256：`{report['provenance']['bars_sha256']}`",
              f"- 评分快照 SHA-256：`{report['provenance']['snapshot_sha256']}`", '',
              '## 资料来源', '',
              '- 本地 SQLite daily_bars、当前 frontend/src/data.js，以及项目行情采集代码。',
              '- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)',
              '- [FINRA 杠杆与反向 ETF 说明](https://www.finra.org/rules-guidance/notices/09-31)',
              '- TQQQ 净值、分红、NDX 与公司行动来源和文件哈希见 product-paths.json。']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'frontend/src/data.js')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--diagnostic', action='store_true', help='Explicitly allow descriptive trend diagnostics; never certifies validity')
    args = parser.parse_args()
    stocks, bars, provenance = load_inputs(args.database, args.snapshot)
    report = audit(stocks, bars, provenance)
    if args.diagnostic:
        report['diagnostic'] = diagnose(stocks, bars, report)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    args.output.with_suffix('.md').write_text(render_report(report), encoding='utf-8')
    print(json.dumps({'strict_status': report['strict_status'], 'output': str(args.output),
                      'database': report['database'], 'model_change_allowed': False}, ensure_ascii=False))
    return 0 if args.diagnostic else 2


if __name__ == '__main__':
    raise SystemExit(main())
