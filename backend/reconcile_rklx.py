"""Read-only RKLX cash-adjustment investigation; never authorizes calibration."""
import argparse
import hashlib
import json
import math
import sqlite3
import statistics
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path

from price_evidence import normalize_folder
from research_calendar import audit_sessions


class DistributionTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.row = {}
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self.row = {}
        if tag == 'td' and 'data-mtr-content' in attrs:
            key = attrs['data-mtr-content'].strip()
            if key in self.row:
                raise ValueError('Duplicate distribution field')
            self.row[key] = attrs.get('data-sort')

    def handle_endtag(self, tag):
        if tag == 'tr' and ('Ex-Div Date' in self.row or 'Amount ($)' in self.row):
            self.rows.append(self.row)
            self.row = {}


def distribution(html, ex_date):
    parser = DistributionTable()
    parser.feed(html)
    matches = [r for r in parser.rows if r.get('Ex-Div Date') == ex_date]
    if len(matches) != 1:
        raise ValueError('Expected exactly one issuer distribution')
    amount = Decimal(matches[0]['Amount ($)'])
    if not amount.is_finite() or amount <= 0:
        raise ValueError('Invalid issuer distribution')
    return amount


def affine_diagnostic(pairs):
    """Describe old = a * new + b. A fit is evidence, never a repair rule."""
    if len(pairs) < 3 or any(not math.isfinite(v) for pair in pairs for v in pair):
        raise ValueError('Insufficient finite pairs')
    xs, ys = zip(*pairs, strict=True)
    xbar, ybar = statistics.mean(xs), statistics.mean(ys)
    variance = sum((x - xbar) ** 2 for x in xs)
    if variance == 0:
        raise ValueError('Constant comparison prices')
    slope = sum((x - xbar) * (y - ybar) for x, y in pairs) / variance
    offset = ybar - slope * xbar
    return {'pairs': len(pairs), 'slope': slope, 'offset': offset,
            'max_absolute_residual': max(abs(y - slope * x - offset) for x, y in pairs)}


def reconcile(database, etf_folder, underlying_folder, issuer_folder):
    etf, stock = normalize_folder(etf_folder), normalize_folder(underlying_folder)
    if etf['symbol'] != 'RKLX' or stock['symbol'] != 'RKLB':
        raise ValueError('Wrong comparison instruments')
    manifest = json.loads((issuer_folder / 'manifest.json').read_text(encoding='utf-8'))['files']['RKLX.html']
    raw = (issuer_folder / 'RKLX.html').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sha256']:
        raise ValueError('Issuer source hash mismatch')
    ex_date = '2025-12-30'
    amount = distribution(raw.decode('utf-8'), ex_date)
    cash = [e for e in etf['actions'] if e['kind'] == 'dividends' and e['date'] == ex_date]
    if len(cash) != 1:
        raise ValueError('Missing/duplicate vendor cash action')
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('BEGIN')
        old = [dict(r) for r in conn.execute(
            'SELECT trade_date AS date,open,high,low,close,source FROM daily_bars WHERE ticker=? ORDER BY trade_date', ('RKLX',))]
    if not old:
        raise ValueError('Missing legacy RKLX series')
    new = {r['date']: r for r in etf['rows']}
    fit = affine_diagnostic([(new[r['date']]['close'], r['close']) for r in old
                             if r['date'] < ex_date and r['date'] in new])
    fit['offset_plus_issuer_cash'] = fit['offset'] + float(amount)
    bad_ohlc = [r for r in old if any(r[k] is None or not math.isfinite(r[k]) or r[k] <= 0
                                    for k in ('open', 'high', 'low', 'close'))]
    def change(bundle):
        mapping = {r['date']: r['close'] for r in bundle['rows']}
        return mapping['2026-05-08'] / mapping['2026-05-07'] - 1
    etf_return, stock_return = change(etf), change(stock)
    old_days = [r['date'] for r in old]
    report = {
        'as_of': '2026-09-16', 'strict_total_return_eligible': False, 'model_change_allowed': False,
        'production_database_modified': False,
        'evidence': {'etf': etf['source_manifest'], 'underlying': stock['source_manifest'], 'issuer': manifest,
                     'legacy_rows_sha256': hashlib.sha256(json.dumps(old, sort_keys=True).encode()).hexdigest()},
        'distribution': {'ex_date': ex_date, 'issuer_usd_per_share': str(amount),
                         'vendor_usd_per_share': cash[0]['payload']['amount'],
                         'difference_usd_per_share': str(amount - Decimal(str(cash[0]['payload']['amount']))),
                         'unit_note': 'Issuer cash is after the reviewed 2025-12-09 3:1 split; provider historical close share units remain uncertified.'},
        'pre_distribution_affine_fit': fit,
        'legacy_nonpositive_or_missing_ohlc': bad_ohlc,
        'legacy_calendar': audit_sessions(old_days, old_days[0], old_days[-1]),
        'candidate_calendar': audit_sessions(list(new), min(new), max(new)),
        'may_8_comparison': {'rklx_market_close_return': etf_return, 'rklb_close_return': stock_return,
                             'two_times_rklb': 2 * stock_return, 'difference_bps': (etf_return - 2 * stock_return) * 10000,
                             'status': 'directionally_explained_not_NAV_tracking_certified'},
        'decision': 'Legacy additive-adjusted prices cannot be ratioed as shareholder total return. No automated repair.',
        'remaining_gates': ['independent price/NAV check', 'complete cash and split share-unit certification',
                            'historical universe and financial publication vintages'],
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('database', 'etf-folder', 'underlying-folder', 'issuer-folder', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    report = reconcile(args.database, args.etf_folder, args.underlying_folder, args.issuer_folder)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('pre_distribution_affine_fit', 'candidate_calendar', 'may_8_comparison')}, indent=2))


if __name__ == '__main__':
    main()
