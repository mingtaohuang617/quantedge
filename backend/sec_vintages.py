"""SEC filing-linked research facts. Current API extracts are not historical snapshots."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo

from price_evidence import iso_day

NY = ZoneInfo('America/New_York')
FORMS = {'10-K', '10-Q', '10-K/A', '10-Q/A'}
TAGS = {'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues',
        'NetIncomeLoss', 'OperatingIncomeLoss', 'Assets', 'StockholdersEquity',
        'NetCashProvidedByUsedInOperatingActivities', 'EarningsPerShareDiluted'}


def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamp requires explicit timezone')
    return dt


def filing_index(tables):
    index = {}
    fields = ('accessionNumber', 'filingDate', 'acceptanceDateTime', 'form', 'primaryDocument')
    for table in tables:
        count = len(table['accessionNumber'])
        if any(len(table.get(k, [])) != count for k in fields):
            raise ValueError('Misaligned submissions arrays')
        for i in range(count):
            row = {k: table[k][i] for k in fields}
            accession = row['accessionNumber']
            if accession in index and index[accession] != row:
                raise ValueError('Conflicting submission metadata')
            index[accession] = row
    return index


def normalize(company, tables, cik):
    import math
    if str(company['cik']).zfill(10) != cik:
        raise ValueError('Company CIK mismatch')
    index = filing_index(tables)
    records, issues = [], Counter()
    for tag, concept in company.get('facts', {}).get('us-gaap', {}).items():
        if tag not in TAGS:
            continue
        for unit, facts in concept['units'].items():
            for fact in facts:
                accession = fact.get('accn')
                filing = index.get(accession)
                if not filing:
                    issues['missing_submission_metadata'] += 1
                    continue
                if filing['form'] not in FORMS:
                    issues['unsupported_form'] += 1
                    continue
                try:
                    end, filed = iso_day(fact['end']), iso_day(fact['filed'])
                    start = iso_day(fact['start']) if 'start' in fact else None
                    accepted = timestamp(filing['acceptanceDateTime'])
                    if filed != filing['filingDate'] or fact['form'] != filing['form']:
                        raise ValueError('Filing metadata mismatch')
                    if (start and start > end) or end > filed:
                        raise ValueError('Impossible reporting period')
                    value = fact['val']
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        raise ValueError('Invalid fact value')
                    # Conservative daily policy: wait until the following NY date
                    # after BOTH filed date and acceptance date. Not a claim about
                    # first earnings-release publication or intraday dissemination.
                    after = max(datetime.fromisoformat(filed).date(), accepted.astimezone(NY).date()) + timedelta(days=1)
                    available = datetime.combine(after, time.min, NY).isoformat()
                    records.append({'cik': cik, 'taxonomy': 'us-gaap', 'concept': tag, 'unit': unit,
                        'start': start, 'end': end, 'value': value, 'accession': accession,
                        'form': filing['form'], 'filed': filed, 'accepted_at': accepted.isoformat(),
                        'available_at': available, 'primary_document': filing['primaryDocument'],
                        'source': f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace("-", "")}/{filing["primaryDocument"]}',
                        'status': 'filing_linked_candidate'})
                except (ValueError, TypeError, KeyError, OverflowError):
                    issues['invalid_fact_or_metadata'] += 1
    grouped = defaultdict(list)
    for row in records:
        key = tuple(row[k] for k in ('concept', 'unit', 'start', 'end', 'accession'))
        grouped[key].append(row)
    output = []
    for rows in grouped.values():
        unique = {r['value'] for r in rows}
        if len(unique) > 1:
            issues['conflicting_fact_contexts'] += 1
            # Retain ambiguity so selection cannot silently fall back to an older
            # filing or choose whichever duplicate happened to come last.
            row = {**rows[0], 'value': None, 'status': 'ambiguous_context', 'conflicting_values': sorted(unique)}
        else:
            row = rows[0]
        output.append(row)
    output.sort(key=lambda r: (r['concept'], r['unit'], r['start'] or '', r['end'], r['available_at'], r['accession']))
    return {'schema_version': 'sec-vintages-1.0.0', 'cik': cik, 'records': output, 'issues': dict(issues), 'strict_pit_eligible': False,
            'model_change_allowed': False, 'policy': 'next New York calendar day after max(filed date, acceptance date)',
            'limitations': ['Current SEC extracts, not historical API vintages or archived original filings',
                            'Exact concept, unit and duration only; no quarter/TTM or tag mapping inference',
                            '10-K/Q and amendments only; earlier earnings releases are not modeled']}


def select_fact(bundle, *, concept, unit, start, end, as_of):
    instant = timestamp(as_of)
    eligible = [r for r in bundle['records'] if (r['concept'], r['unit'], r['start'], r['end']) == (concept, unit, start, end)
                and timestamp(r['available_at']) <= instant]
    if not eligible:
        return None
    latest = max(timestamp(r['accepted_at']) for r in eligible)
    chosen = [r for r in eligible if timestamp(r['accepted_at']) == latest]
    if len(chosen) != 1 or chosen[0]['status'] != 'filing_linked_candidate':
        return None
    return chosen[0]
