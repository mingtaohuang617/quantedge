"""Bounded annual quality-input replay; never certifies backtest eligibility."""
from datetime import date, timedelta
from decimal import Decimal

from financial_admission import select_admitted
from scoring import score_universe


def trial(bundle, checks, notices, *, ticker, accession, start, end, prior_start, revenue_tag, as_of):
    first, last, previous = map(date.fromisoformat, (start, end, prior_start))
    prior_end = str(first - timedelta(days=1))
    if not (350 <= (last - first).days + 1 <= 380 and 350 <= (first - previous).days <= 380):
        raise ValueError('Require consecutive issuer annual periods')
    evidence = {}

    def get(name, concept, begin, finish):
        result = select_admitted(bundle, checks, notices, concept=concept, unit='USD', start=begin, end=finish, as_of=as_of)
        if result['fact'] and result['fact']['accession'] != accession:
            result = {'status': 'different_filing', 'fact': None}
        evidence[name] = result
        return Decimal(str(result['fact']['value'])) if result['fact'] else None

    income = get('income', 'NetIncomeLoss', start, end)
    revenue = get('revenue', revenue_tag, start, end)
    prior = get('prior_revenue', revenue_tag, prior_start, prior_end)
    opening = get('opening_equity', 'StockholdersEquity', None, prior_end)
    closing = get('closing_equity', 'StockholdersEquity', None, end)
    ratios = {'roe': None, 'profitMargin': None, 'revenueGrowth': None}
    reasons = {}
    if income is not None and opening is not None and closing is not None and min(opening, closing) > 0:
        ratios['roe'] = float(200 * income / (opening + closing))
    else:
        reasons['roe'] = 'Missing admitted inputs or nonpositive opening/closing equity'
    if income is not None and revenue is not None and revenue > 0:
        ratios['profitMargin'] = float(100 * income / revenue)
    else:
        reasons['profitMargin'] = 'Missing admitted inputs or nonpositive revenue'
    if revenue is not None and prior is not None and revenue >= 0 and prior > 0:
        ratios['revenueGrowth'] = float(100 * (revenue / prior - 1))
    else:
        reasons['revenueGrowth'] = 'Missing admitted inputs or nonpositive prior/negative current revenue'
    stock = dict(ticker=ticker, market='US', assetType='stock', financialCurrency='USD',
                 financialPeriod=end, **ratios)
    score_universe([stock])
    return {'ticker': ticker, 'as_of': as_of, 'accession': accession, 'period': [start, end],
            'inputs': ratios, 'input_blocks': reasons, 'source_facts': evidence,
            'qualityScore': stock['qualityScore'], 'subScores': stock['subScores'], 'scoring': stock['scoring'],
            'strict_pit_eligible': False, 'model_change_allowed': False,
            'limitations': ['Annual fiscal-period ratios; no quarterly TTM inference',
                           'Historical price, share count and valuation inputs missing',
                           'Independent cases with absolute anchors; no cross-date peer ranking',
                           'Reviewed notices only; notice and revision coverage incomplete']}
