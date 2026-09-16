"""Reconcile archived issuer cumulative market-price returns; not NAV certification."""
import argparse
import calendar
import hashlib
import json
import re
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path

from price_evidence import normalize_folder
from research_calendar import sessions, audit_sessions


class PerformanceTables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.active = None
        self.cell = None
        self.row = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table' and attrs.get('id', '').startswith('cumulative-'):
            if self.active is not None:
                raise ValueError('Nested performance table')
            self.active = {'date': datetime.strptime(attrs['data-date'], '%m-%d-%Y').date().isoformat(), 'rows': []}
        if self.active is not None:
            if tag == 'tr':
                self.row = []
            if tag in ('td', 'th'):
                self.cell = []

    def handle_data(self, text):
        if self.cell is not None:
            self.cell.append(text)

    def handle_endtag(self, tag):
        if self.active is None:
            return
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr':
            self.active['rows'].append(self.row)
        elif tag == 'table':
            self.tables.append(self.active)
            self.active = None


def percent(value):
    # Issuer displays two decimal percentage points: rounding interval is 0.5 bp.
    if not re.fullmatch(r'-?\d+\.\d{2}%', value):
        raise ValueError('Expected two-decimal percentage')
    return float(value[:-1]) / 100


def checkpoints(html):
    parser = PerformanceTables()
    parser.feed(html)
    if parser.active is not None or not parser.tables:
        raise ValueError('Missing/incomplete cumulative performance table')
    output, seen = [], set()
    labels = ['', 'YTD', '1 Month', '3 Months', '6 Months', 'Since Inception']
    for table in parser.tables:
        if table['date'] in seen:
            raise ValueError('Duplicate performance date')
        seen.add(table['date'])
        rows = table['rows']
        if (len(rows) != 3 or rows[0] != labels or any(len(r) != len(labels) for r in rows)
                or rows[1][0] != 'Total Return NAV (%)' or rows[2][0] != 'Market Price (%)'):
            raise ValueError('Unrecognized performance schema')
        for i, period in enumerate(labels[1:-1], 1):
            output.append({'as_of': table['date'], 'period': period,
                           'issuer_nav_return': percent(rows[1][i]), 'issuer_market_return': percent(rows[2][i])})
    return output


def boundaries(as_of, period):
    end = date.fromisoformat(as_of)
    if end.day != calendar.monthrange(end.year, end.month)[1]:
        raise ValueError('Only calendar month-end checkpoints supported')
    if period == 'YTD':
        start = date(end.year - 1, 12, 31)
    else:
        months = {'1 Month': 1, '3 Months': 3, '6 Months': 6}[period]
        serial = end.year * 12 + end.month - 1 - months
        year, month = divmod(serial, 12)
        start = date(year, month + 1, calendar.monthrange(year, month + 1)[1])
    # Resolve month ends using the reviewed exchange calendar, never price availability.
    def last_session(day):
        return sessions(day.replace(day=1).isoformat(), day.isoformat())[-1]
    return last_session(start), last_session(end)


def evaluate(points, bundle):
    rows = bundle['rows']
    days = [r['date'] for r in rows]
    if days != sorted(set(days)):
        raise ValueError('Unsorted/duplicate candidate dates')
    mapping = {r['date']: r for r in rows}
    results = []
    for point in points:
        result = dict(point)
        try:
            start, end = boundaries(point['as_of'], point['period'])
            result.update(start=start, end=end)
            calendar_check = audit_sessions([d for d in days if start <= d <= end], start, end)
            if not calendar_check['passed']:
                result.update(status='missing_or_unexpected_sessions', calendar=calendar_check)
            else:
                vendor = mapping[end]['adjusted_close'] / mapping[start]['adjusted_close'] - 1
                difference = (vendor - point['issuer_market_return']) * 10000
                result.update(vendor_proxy_return=vendor, difference_bps=difference,
                              market_minus_nav_bps=(point['issuer_market_return'] - point['issuer_nav_return']) * 10000,
                              status='within_display_rounding' if abs(difference) <= .5 + 1e-8 else 'mismatch')
        except (ValueError, KeyError) as exc:
            result.update(status='unsupported_scope', reason=str(exc))
        results.append(result)
    return {'symbol': bundle['symbol'], 'checks': results, 'tolerance_bps': .5,
            'passed_checkpoints': sum(r['status'] == 'within_display_rounding' for r in results),
            'strict_total_return_eligible': False, 'model_change_allowed': False,
            'scope': 'Cumulative market-price return checkpoints only. Overlapping periods are not independent samples. NAV is reference only.',
            'excluded': 'Since inception: inception NAV is not the first exchange closing price. Annualized tables are not mixed with cumulative returns.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('issuer-folder', 'evidence-folder', 'output'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.issuer_folder / 'manifest.json').read_text(encoding='utf-8'))['files']['RKLX.html']
    raw = (args.issuer_folder / 'RKLX.html').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sha256']:
        raise ValueError('Issuer evidence hash mismatch')
    bundle = normalize_folder(args.evidence_folder)
    if bundle['symbol'] != 'RKLX':
        raise ValueError('Expected RKLX evidence')
    result = evaluate(checkpoints(raw.decode('utf-8')), bundle)
    result['sources'] = {'issuer': manifest, 'candidate': bundle['source_manifest']}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'checks': len(result['checks']), 'passed': result['passed_checkpoints']}))
    return 0 if result['passed_checkpoints'] == len(result['checks']) else 2


if __name__ == '__main__':
    raise SystemExit(main())
