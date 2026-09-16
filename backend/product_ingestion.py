"""Issuer observations and strictly aligned daily tracking diagnostics.

No network on import. Fetching is an explicit CLI operation in refresh_product_data.py.
"""
import csv
import hashlib
import io
import json
import math
import re
import statistics
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT / 'frontend/src/lib/product-registry.json').read_text(encoding='utf-8'))


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)


def page_text(html):
    parser = PageText()
    parser.feed(html)
    return re.sub(r'\s+', ' ', ' '.join(parser.parts)).strip()


def match(text, pattern):
    found = re.search(pattern, text, re.I)
    if not found:
        raise ValueError(f'Issuer schema changed: missing {pattern}')
    return found.group(1)


def parse_date(value):
    for fmt in ('%m/%d/%Y', '%b %d, %Y', '%B %d, %Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError('Invalid observation date')


def issuer_observations(ticker, html, retrieved_at):
    config = REGISTRY[ticker]
    text = page_text(html)
    if not re.search(rf'\b{re.escape(ticker)}\b', text) or config['metadata']['issuer'] not in text:
        raise ValueError('Product identity mismatch')
    source = config['source']
    digest = hashlib.sha256(html.encode('utf-8')).hexdigest()
    if config['parser'] == 'defiance':
        section = text.split('Fund Details', 1)[1]
        observed = parse_date(match(section, r'Data as of (\d+/\d+/\d{4})'))
        expense = float(match(section, r'Gross Expense Ratio\s+([\d.]+)\s*%'))
        spread = float(match(section, r'Median 30 Day Spread\s+([\d.]+)\s*%'))
        expense_date, basis, expiry = observed, 'gross', None
        if not re.search(r'Underlying Security:\s*Rocket Lab.*?NASDAQ:\s*RKLB', text):
            raise ValueError('RKLX underlying changed')
    elif config['parser'] == 'proshares':
        observed = parse_date(match(text, r'Price as of (\d+/\d+/\d{4})'))
        expense = float(match(text, r'Net Expense Ratio\s+([\d.]+)\s*%'))
        spread = float(match(text, r'30-Day Median Bid Ask Spread\s+([\d.]+)\s*%'))
        expiry = parse_date(match(text, r'fee waiver through ([A-Za-z]+ \d+, \d{4})'))
        # The fee has no separately published effective date. Record when observed, not a guessed date.
        expense_date, basis = retrieved_at, 'net'
        if not re.search(r'three times.*?daily performance of the Nasdaq-100', text, re.I):
            raise ValueError('TQQQ objective changed')
    else:
        observed = parse_date(match(text, r'30 Day Median Bid/Ask Spread\s+[\d.]+%\s+as of ([A-Za-z]+ \d+, \d{4})'))
        expense = float(match(text, r'Expense Ratio:\s*Fees as stated in the prospectus\s+([\d.]+)\s*%'))
        spread = float(match(text, r'30 Day Median Bid/Ask Spread\s+([\d.]+)\s*%'))
        expense_date, basis, expiry = retrieved_at, 'prospectus', None
        if 'MSCI Korea 25/50 Index (Net)' not in text:
            raise ValueError('EWY benchmark changed')
    if observed > retrieved_at:
        raise ValueError('Future issuer observation')
    if not (0 <= expense <= 20 and 0 <= spread <= 100):
        raise ValueError('Invalid fee or spread')
    common = {'source': source, 'availableAt': retrieved_at, 'retrievedAt': retrieved_at, 'sourceHash': digest}
    metrics = {
        'expenseRatio': {**common, 'value': expense, 'unit': 'percent', 'asOf': expense_date, 'basis': basis},
        'medianSpread30d': {**common, 'value': round(spread * 100, 6), 'unit': 'bps', 'asOf': observed},
    }
    if expiry:
        metrics['expenseRatio']['validThrough'] = expiry
    return {'productDataAsOf': retrieved_at, 'productMetrics': metrics, 'productDataIssues': []}


def tracking_diagnostics(fund, benchmark, *, multiple, benchmark_name, currency, benchmark_currency,
                         fund_basis, benchmark_basis, close_convention, benchmark_close_convention, source, benchmark_source):
    """Rows are adjusted economic levels; exact daily alignment, never an inner join across gaps."""
    if currency != benchmark_currency or fund_basis != 'nav_total_return' or benchmark_basis not in ('price_return', 'net_total_return'):
        raise ValueError('Incompatible return basis or currency')
    if not close_convention or close_convention != benchmark_close_convention:
        raise ValueError('Incompatible market close convention')
    if isinstance(multiple, bool) or not isinstance(multiple, (float, int)) or not math.isfinite(multiple) or multiple == 0:
        raise ValueError('Invalid leverage multiple')
    for series in (fund, benchmark):
        dates = [row['date'] for row in series]
        if dates != sorted(set(dates)):
            raise ValueError('Unsorted or duplicate trading dates')
        for row in series:
            if date.fromisoformat(row['date']).isoformat() != row['date']:
                raise ValueError('Invalid date')
            value = row['level']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError('Invalid economic level')
    if len(fund) < 21 or [r['date'] for r in fund] != [r['date'] for r in benchmark]:
        raise ValueError('At least 21 exactly aligned levels required; missing sessions are not filled')
    errors = [(f1['level'] / f0['level'] - 1) - multiple * (b1['level'] / b0['level'] - 1)
              for f0, f1, b0, b1 in zip(fund, fund[1:], benchmark, benchmark[1:])]
    # Large discontinuities require corporate-action review, not winsorization.
    if max(map(abs, errors)) > .1:
        raise ValueError('Tracking discontinuity exceeds 10%; inspect actions and data')
    return {'value': round(statistics.stdev(errors) * 10000, 6), 'unit': 'bps',
            'asOf': fund[-1]['date'], 'windowStart': fund[0]['date'], 'observations': len(errors),
            'targetMultiple': multiple, 'benchmark': benchmark_name, 'source': source,
            'benchmarkSource': benchmark_source, 'fundBasis': fund_basis, 'benchmarkBasis': benchmark_basis,
            'currency': currency, 'closeConvention': close_convention, 'method': 'sample_std_daily_difference',
            'meanDifferenceBps': round(statistics.mean(errors) * 10000, 6),
            'maxAbsDifferenceBps': round(max(map(abs, errors)) * 10000, 6)}


def tqqq_tracking(nav_csv, ndx_json, distributions, actions_json, as_of):
    chart = ndx_json['chart']['result'][0]
    actions = actions_json['chart']['result'][0]
    if chart['meta'].get('symbol') != '^NDX' or actions['meta'].get('symbol') != 'TQQQ':
        raise ValueError('Incorrect tracking instruments')
    if chart['meta'].get('exchangeTimezoneName') != 'America/New_York':
        raise ValueError('Unknown index close timezone')
    closes = chart['indicators']['quote'][0]['close']
    if len(closes) != len(chart['timestamp']):
        raise ValueError('Index timestamp and level counts differ')
    index = [{'date': datetime.fromtimestamp(ts, ZoneInfo('America/New_York')).date().isoformat(), 'level': close}
             for ts, close in zip(chart['timestamp'], closes)]
    index = [r for r in index if r['date'] <= as_of]
    if not index:
        raise ValueError('Index observations unavailable')
    start, end = index[0]['date'], index[-1]['date']
    action_dates = {datetime.fromtimestamp(ts, ZoneInfo('America/New_York')).date().isoformat() for ts in actions.get('timestamp', [])}
    if not set(r['date'] for r in index).issubset(action_dates):
        raise ValueError('Corporate-action query does not cover the tracking window')
    # This adapter deliberately fails closed in action windows. No guessed split/dividend adjustment.
    if actions.get('events'):
        raise ValueError('Corporate actions require an adjusted-NAV adapter')
    if not isinstance(distributions, list) or any(not isinstance(d, dict) or d.get('Symbol') != 'TQQQ' or not d.get('ExDate') for d in distributions):
        raise ValueError('Invalid issuer distribution response')
    if any(start < d['ExDate'][:10] <= end for d in distributions):
        raise ValueError('Distribution in NAV window requires total-return adjustment')
    rows = list(csv.DictReader(io.StringIO(nav_csv)))
    fund = sorted([{'date': parse_date(r['Date']), 'level': float(r['NAV'])} for r in rows
                   if r.get('Ticker') == 'TQQQ' and start <= parse_date(r['Date']) <= end], key=lambda r: r['date'])
    result = tracking_diagnostics(fund, index, multiple=3, benchmark_name=REGISTRY['TQQQ']['metadata']['benchmark'],
                                  currency='USD', benchmark_currency=chart['meta'].get('currency'),
                                  fund_basis='nav_total_return', benchmark_basis='price_return',
                                  close_convention='America/New_York 16:00', benchmark_close_convention='America/New_York 16:00',
                                  source='https://accounts.profunds.com/etfdata/ByFund/TQQQ-historical_nav.csv',
                                  benchmark_source='https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX')
    result.update(availableAt=as_of, retrievedAt=as_of,
                  actionCheck='No splits or distributions in the selected window',
                  distributionSource='https://www.proshares.com/api/distributionsummary/?fund=TQQQ&year=' + as_of[:4])
    return result
