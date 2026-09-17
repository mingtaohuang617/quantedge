"""Compare legacy closes with archived vendor prices without replacing either."""
import argparse
import json
import sqlite3
import statistics
from pathlib import Path

from price_evidence import normalize_folder


def compare(database, collection, reviews):
    results = []
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        conn.execute('BEGIN')
        for entry in collection['results']:
            if entry['status'] != 'captured':
                continue
            bundle = normalize_folder(Path(entry['evidence_folder']))
            symbol = bundle['symbol']
            old = list(conn.execute('SELECT trade_date,close,source FROM daily_bars WHERE ticker=? ORDER BY trade_date', (symbol,)))
            mapping = {d: (p, source) for d, p, source in old}
            previous = {old[i][0]: old[i - 1][0] for i in range(1, len(old))}
            differences = []
            for a, b in zip(bundle['rows'][:-1], bundle['rows'][1:], strict=True):
                if previous.get(b['date']) != a['date'] or a['date'] not in mapping or mapping[a['date']][0] <= 0:
                    continue
                old_return = mapping[b['date']][0] / mapping[a['date']][0] - 1
                new_return = b['adjusted_close'] / a['adjusted_close'] - 1
                differences.append({'date': b['date'], 'legacy_source': mapping[b['date']][1],
                                    'legacy_return': old_return, 'vendor_proxy_return': new_return,
                                    'difference_bps': (old_return - new_return) * 10000})
            events = []
            for review in reviews:
                if review['symbol'] != symbol:
                    continue
                matches = [a for a in bundle['actions'] if a['kind'] == 'splits' and a['date'] == review['date']
                           and a['payload']['numerator'] / a['payload']['denominator'] == review['ratio']]
                events.append({**review, 'matches_provider': len(matches) == 1})
            abs_diff = [abs(d['difference_bps']) for d in differences]
            results.append({'symbol': symbol, 'legacy_rows': len(old), 'matched_return_intervals': len(differences),
                            'median_absolute_difference_bps': statistics.median(abs_diff) if abs_diff else None,
                            'intervals_over_10bps': sum(d > 10 for d in abs_diff),
                            'largest_differences': sorted(differences, key=lambda d: abs(d['difference_bps']), reverse=True)[:5],
                            'reviewed_splits': events, 'strict_total_return_eligible': False})
    return {'results': results, 'method': 'matched consecutive dates only; absolute difference threshold is diagnostic, not a validation rule',
            'limitations': ['differences can reflect legitimate dividend adjustment or vendor revision, not necessarily bad prices',
                            'split spot checks do not certify dividends, calendars, the absence of missing actions or PIT availability']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--collection', type=Path, required=True)
    parser.add_argument('--reviews', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    collection = json.loads(args.collection.read_text(encoding='utf-8'))
    result = compare(args.database, collection,
                     json.loads(args.reviews.read_text(encoding='utf-8'))['split_reviews'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    lines = ['# 价格证据层验收', '',
             '结论：独立研究采集、版本留存和总回报计算器已建立。已采集标的见下表，尚未达到全量严格回测的数据准入；生产数据库和评分权重均未改变。', '',
             '## Before 与 After', '',
             '| 项目 | 原链路 | 本轮研究入口 |', '|---|---|---|',
             '| 价格口径 | yfinance 批量显式不自动复权，单标的依赖自动复权默认值；同名来源不足以识别口径 | Close 与 Adj Close 分列，明确标为供应商调整价候选，拒绝缺失时回填 |',
             '| 原始证据 | 数据写入优先级库，无法还原每次响应 | 原始响应、请求参数、带时区抓取时间、哈希按内容寻址保存；修订保留新版本 |',
             '| 公司行动 | 旧 daily_bars 未保留分红拆股明细 | 分红、拆并股、资本利得分配独立保留；未知行动拒绝处理 |',
             '| 当天日线 | 接口可能附送当日未完成值 | 按交易所时区排除当天与请求外日线，记录 excluded_sessions |',
             '| 总回报 | 口径不明的 close 直接相除 | 明确价格和现金份额口径后，逐日计算现金再投资；已统一份额的价格不再乘拆股倍数 |', '',
             '注意：原生产路由和旧数据库仍保持原状，本轮建立的是可审计研究入口，不代表旧库混合口径已被修复或覆盖。', '',
             '## 实际采集结果', '',
             '| 标的 | 起点 | 最后完整日期 | 日线数 | 分红事件 | 拆股事件 | 状态 |', '|---|---|---|---:|---:|---:|---|']
    for row in collection['results']:
        if row['status'] != 'captured':
            lines.append(f"| {row['symbol']} | — | — | — | — | — | 失败 |")
            continue
        state = '需核查跳变' if row['issues'] else '供应商候选，未认证'
        lines.append(f"| {row['symbol']} | {row['first']} | {row['last']} | {row['rows']} | {row['actions']['dividends']} | {row['actions']['splits']} | {state} |")
    lines += ['', '请求外与当日未完成日线已排除，具体日期见采集清单 excluded_sessions。新增加密行情仅存在于研究数据包，尚未加入生产评分池。', '',
              '## 与旧库的同日期收益对照', '',
              '只比较两端日期完全一致的连续区间。10 bps 是差异诊断阈值，不是有效性或错误判断标准。分红口径和历史修订也可能产生合法差异。', '',
              '| 标的 | 可比区间 | 绝对差异中位数 bps | 超过 10 bps 的区间 |', '|---|---:|---:|---:|']
    for row in result['results']:
        value = row['median_absolute_difference_bps']
        value = '无旧库样本' if value is None else f'{value:.4f}'
        lines.append(f"| {row['symbol']} | {row['matched_return_intervals']} | {value} | {row['intervals_over_10bps']} |")
    lines += ['', '差异最大的具体日期与幅度见同日收益对照文件 largest_differences；不能据此推断哪家数据源全面错误，也不能直接用新值覆盖旧证据。新供应商序列中的超过 50% 跳变继续标记待核查，不自动修复。', '',
              '## 官方拆股抽查', '',
              '抽查日期、比例、官方来源与逐项匹配结果见 action-reviews.json 和 legacy-comparison.json 的 reviewed_splits。',
              '- 以上仅核对指定拆股事件，不证明历史分红、现金单位、遗漏公司行动和全部价格均已通过验证。', '',
              '## 总回报计算约定', '',
              '初始指数为 100。原始实际交易价格的单日增长倍数为（当日收盘价＋按拆股后每股计的现金分配）× 新股/旧股比例 ÷ 前日收盘价；已使用固定拆股份额单位的价格与现金不再乘拆股倍数。现金在除息日收盘再投资，不含税、佣金、汇率或盘中成交假设。', '',
              '该公式已通过单元测试，但不能把未知份额口径的 Yahoo 数据直接塞入并标成真实总回报。供应商调整价继续使用 vendor_adjusted_proxy 标签，strict_total_return_eligible 保持 false。', '',
              '## 下一准入条件', '',
              '- 优先解决 RKLX 旧库异常及新源跳变，并用发行商 NAV/独立成交序列交叉核验。',
              '- 对齐全部现金分配的金额、除息日期、币种、拆股前后份额单位；核验交易日历与缺失行情。',
              '- 扩展覆盖历史成员和退市标的；新抓取的数据仅证明抓取时版本，不能冒充当时已存在的历史版本。',
              '- 上述核验后，才能接入严格回测；历史财报公开时间及修订版本仍为下一独立数据入口。', '',
              '## 证据与复现', '',
              '- [采集清单和源文件哈希](collection.json)', '- [同日收益对照](legacy-comparison.json)', '- [拆股抽查记录](action-reviews.json)',
              '- 原始与标准化响应保存在 backend/data/price_evidence，受既有忽略规则保护。离线重放需要保留此目录。',
              '- 运行方法见 [价格证据层说明](../../price-evidence.md)。', '',
              '## 资料来源', '',
              '- [Yahoo 调整价说明](https://help.yahoo.com/kb/SLN28256.html)',
              '- [NVIDIA SEC 8-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000144/nvda-20240607.htm)',
              '- [ProShares 拆股公告](https://www.proshares.com/press-releases/proshares-announces-etf-share-splits5)',
              '- [RKLX 拆股补充文件](https://www.sec.gov/Archives/edgar/data/1924868/000199937125018306/defiance-497_112125.htm)',
              '- 价格与事件为 Yahoo chart 接口抓取的供应商数据；具体 URL、请求区间和抓取时间随原始响应保存。']
    args.output.with_suffix('.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps([{k: v for k, v in r.items() if k not in ('largest_differences', 'reviewed_splits')} for r in result['results']], ensure_ascii=False))


if __name__ == '__main__':
    main()
