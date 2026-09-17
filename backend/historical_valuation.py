"""Traceable valuation diagnostics with a separate, fail-closed score gate."""
from datetime import date
from decimal import Decimal

from sec_vintages import timestamp


def positive(value):
    if value is None or isinstance(value, bool):
        return False
    number = Decimal(str(value))
    return number.is_finite() and number > 0


def unique_fact(rows, concept, unit, start, end):
    matches = [r for r in rows if (r['concept'], r['unit'], r['start'], r['end']) == (concept, unit, start, end)]
    values = {Decimal(r['value']) for r in matches}
    if not matches or len(values) != 1 or not all(v.is_finite() for v in values):
        return {'status': 'missing_or_conflicting_original', 'value': None, 'originals': matches}
    return {'status': 'original_verified', 'value': str(next(iter(values))), 'originals': matches}


def split_factor(events, *, start, end):
    """New/old share ratio; reverse splits multiply by a fraction. No cash adjustment."""
    start, end = date.fromisoformat(start), date.fromisoformat(end)
    if end < start:
        raise ValueError('Reversed basis interval')
    factor, seen = Decimal(1), set()
    for event in events:
        day = date.fromisoformat(event['date'])
        if not start < day <= end:
            continue
        if day in seen or not event.get('source') or not positive(event['ratio']):
            raise ValueError('Invalid or duplicate split evidence')
        seen.add(day)
        factor *= Decimal(str(event['ratio']))
    return factor


def evaluate(*, as_of, price, shares, eps, equity, revenue, financial_available_at,
             shares_date, period_end, basis, share_policy='same_day', share_evidence=None):
    """Diagnostics can use explicit assumptions; admitted inputs cannot."""
    blocks = []
    instant = timestamp(as_of)
    if timestamp(financial_available_at) > instant or timestamp(price['closed_at']) > instant:
        return {'status': 'future_input', 'inputs': {}, 'diagnostics': {}, 'blocks': ['Input not available at query time']}
    if date.fromisoformat(shares_date) > instant.date() or date.fromisoformat(period_end) > instant.date():
        return {'status': 'future_input', 'inputs': {}, 'diagnostics': {}, 'blocks': ['Future financial period']}
    if price['currency'] != 'USD' or not positive(price['close']):
        return {'status': 'invalid_price', 'inputs': {}, 'diagnostics': {}, 'blocks': ['Invalid price/currency']}
    age = (instant.date() - date.fromisoformat(shares_date)).days
    quote_age = (instant - timestamp(price['closed_at'])).total_seconds() / 86400
    if quote_age > 4:
        blocks.append('Price older than four calendar days')
    if price.get('basis') != 'raw_as_traded' or not price.get('basis_evidence'):
        blocks.append('Provider close has no independently verified as-traded basis')
    if (not basis.get('split_chain_complete') or not basis.get('evidence')
            or basis.get('price_basis_id') != basis.get('financial_basis_id')):
        blocks.append('Price, EPS and shares lack a verified common split basis')
    # A period-end share count is a disclosed observation, not current shares.
    if share_policy not in ('same_day', 'latest_disclosed'):
        raise ValueError('Unknown share policy')
    estimated = share_policy == 'latest_disclosed'
    if estimated:
        evidence = share_evidence or {}
        if (not evidence.get('source') or not evidence.get('is_latest_public') or age > 45
                or not evidence.get('available_at') or timestamp(evidence['available_at']) > instant
                or evidence.get('capital_actions_reviewed_through', '') < timestamp(price['closed_at']).date().isoformat()):
            blocks.append('Latest-disclosed share estimate lacks freshness, publication or capital-action review')
    elif shares_date != timestamp(price['closed_at']).date().isoformat():
        blocks.append('Period-end shares are a proxy, not shares at the valuation date')
    p = Decimal(str(price['close']))
    market_cap = p * Decimal(str(shares)) if positive(shares) else None
    diagnostic = {'pe': float(p / Decimal(str(eps))) if positive(eps) else None,
                  'pb': float(market_cap / Decimal(str(equity))) if market_cap and positive(equity) else None,
                  'marketCap': float(market_cap) if market_cap else None,
                  'revenue': float(revenue) if revenue is not None else None,
                  'marketCapCurrency': 'USD', 'financialCurrency': 'USD'}
    if not positive(shares):
        blocks.append('Missing positive outstanding shares; weighted-average shares are not a substitute')
    return {'status': 'blocked' if blocks else 'research_estimate' if estimated else 'research_candidate', 'inputs': {} if blocks else diagnostic,
            'diagnostics': diagnostic, 'blocks': blocks, 'share_age_days': age,
            'share_policy': share_policy, 'estimated_market_cap': estimated,
            'diagnostic_assumption': 'Provider close and original financial units assumed equal; period-end shares held constant',
            'strict_pit_eligible': False, 'model_change_allowed': False}
