"""Explicit, source-preserving research transforms; no TTM or score inference."""
from datetime import date, timedelta
from decimal import Decimal

from sec_vintages import timestamp

ADDITIVE = {'NetIncomeLoss', 'OperatingIncomeLoss', 'Revenues',
            'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetCashProvidedByUsedInOperatingActivities'}


def verified(row, as_of):
    if row.get('original_check') != 'matched' or row.get('status') != 'filing_linked_candidate':
        raise ValueError('Require original-verified candidate')
    if timestamp(row['available_at']) > timestamp(as_of):
        raise ValueError('Fact was not available')
    value = Decimal(str(row['value']))
    if not value.is_finite():
        raise ValueError('Invalid value')
    return value


def difference(total, component, as_of):
    a, b = verified(total, as_of), verified(component, as_of)
    keys = ('cik', 'concept', 'unit', 'accession')
    if any(total[k] != component[k] for k in keys) or total['concept'] not in ADDITIVE or total['unit'] != 'USD':
        raise ValueError('Require same-filing additive amount contexts')
    if not total['start'] or not component['start']:
        raise ValueError('Instant values are not additive durations')
    ts, te, cs, ce = (date.fromisoformat(v) for v in (total['start'], total['end'], component['start'], component['end']))
    if ts == cs and ts <= ce < te:
        start, end = ce + timedelta(days=1), te
    elif te == ce and ts < cs <= te:
        start, end = ts, cs - timedelta(days=1)
    else:
        raise ValueError('Component must be a proper prefix or suffix of total')
    return {'concept': total['concept'], 'unit': total['unit'], 'start': str(start), 'end': str(end),
            'value': str(a - b), 'available_at': max((total['available_at'], component['available_at']), key=timestamp),
            'source_accession': total['accession'], 'source_contexts': [total, component],
            'method': 'same_filing_duration_difference', 'strict_pit_eligible': False}


def align_eps(row, source_basis, target_basis, events, as_of):
    value = verified(row, as_of)
    if row['concept'] != 'EarningsPerShareDiluted' or row['unit'] != 'USD/shares':
        raise ValueError('Require diluted EPS in USD/shares')
    for basis in (source_basis, target_basis):
        if (basis.get('cik') != row['cik'] or not basis.get('evidence')
                or len(set(basis['split_ids'])) != len(basis['split_ids'])):
            raise ValueError('Explicit evidenced share basis required')
    source_ids, target_ids = set(source_basis['split_ids']), set(target_basis['split_ids'])
    registry = {e['id']: e for e in events}
    if len(registry) != len(events) or not source_ids | target_ids <= registry.keys():
        raise ValueError('Missing or duplicate split evidence')
    factor = Decimal(1)
    for identifier in sorted(source_ids | target_ids):
        event = registry[identifier]
        ratio = Decimal(str(event['ratio']))
        if (not ratio.is_finite() or ratio <= 0 or event['cik'] != row['cik'] or not event.get('source')
                or timestamp(event['known_at']) > timestamp(as_of) or timestamp(event['effective_at']) > timestamp(as_of)):
            raise ValueError('Invalid or future split evidence')
        if identifier in target_ids - source_ids:
            factor /= ratio
        elif identifier in source_ids - target_ids:
            factor *= ratio
    return {'original_value': str(value), 'aligned_value': str(value * factor), 'factor': str(factor),
            'period_start': row['start'], 'period_end': row['end'], 'source_record': row,
            'source_basis': source_basis, 'target_basis': target_basis, 'events': events,
            'strict_pit_eligible': False, 'valuation_ready': False,
            'limitation': 'Share-unit conversion only; quarterly EPS is not TTM EPS; event-list completeness requires review'}
