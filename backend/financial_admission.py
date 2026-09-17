"""Research admission: known non-reliance notices and original verification."""
from sec_vintages import select_fact, timestamp

MATCHED = {'matched', 'matched_with_rounding'}


def reliability(row, as_of, notices):
    for notice in notices:
        if notice['cik'] != row['cik'] or row['end'] not in notice['affected_period_ends']:
            continue
        if not notice.get('source'):
            raise ValueError('Non-reliance notice requires source')
        if timestamp(as_of) >= timestamp(notice['known_at']) and row['accession'] not in notice['replacement_accessions']:
            return {'status': 'blocked_non_reliance', 'notice': notice}
    return {'status': 'not_blocked_by_reviewed_notices', 'notice_coverage_complete': False}


def select_admitted(bundle, verified_rows, notices, **query):
    row = select_fact(bundle, **query)
    if row is None:
        return {'status': 'unavailable', 'fact': None}
    gate = reliability(row, query['as_of'], notices)
    if gate['status'] == 'blocked_non_reliance':
        return {**gate, 'fact': None, 'blocked_accession': row['accession']}
    key = ('cik', 'accession', 'concept', 'unit', 'start', 'end', 'available_at', 'accepted_at', 'status', 'source')
    matching = [r for r in verified_rows if all(r[k] == row[k] for k in key)]
    if len(matching) != 1 or matching[0]['original_check'] not in MATCHED or matching[0]['value'] != row['value']:
        return {'status': 'unverified_original', 'fact': None}
    return {'status': 'research_candidate', 'fact': matching[0], 'strict_pit_eligible': False,
            'notice_coverage_complete': False}
