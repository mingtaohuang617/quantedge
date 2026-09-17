"""Bounded inline-XBRL checks against archived SEC originals, not a general XBRL engine."""
import argparse
import hashlib
import json
import re
from html.entities import html5
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

from lxml import etree

from price_evidence import read_evidence, iso_day
from sec_vintages import TAGS

X = 'http://www.xbrl.org/2003/instance'
IX = 'http://www.xbrl.org/2013/inlineXBRL'
XSI = 'http://www.w3.org/2001/XMLSchema-instance'


def qualified(element, value):
    prefix, local = value.split(':', 1)
    uri = element.nsmap.get(prefix)
    if not uri:
        raise ValueError('Unresolved QName')
    return uri, local


def numeric(element):
    if element.get(f'{{{XSI}}}nil') in ('true', '1') or element.get('continuedAt'):
        raise ValueError('Nil/continued numeric fact unsupported')
    fmt = element.get('format')
    if fmt:
        uri, name = qualified(element, fmt)
        if not uri.startswith('http://www.xbrl.org/inlineXBRL/transformation/'):
            raise ValueError('Unsupported transformation namespace')
        if name not in ('num-dot-decimal', 'numdotdecimal', 'fixed-zero'):
            raise ValueError('Unsupported transformation')
    else:
        name = None
    if any(True for _ in element.iter(f'{{{IX}}}exclude')):
        raise ValueError('Excluded numeric content unsupported')
    text = ''.join(element.itertext()).strip()
    if name == 'fixed-zero':
        value = Decimal(0)
    else:
        if name in ('num-dot-decimal', 'numdotdecimal'):
            if not re.fullmatch(r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?', text):
                raise ValueError('Invalid decimal transformation input')
            text = text.replace(',', '')
        if not re.fullmatch(r'[+-]?\d+(?:\.\d+)?', text):
            raise ValueError('Unsupported decimal representation')
        value = Decimal(text)
    scale = int(element.get('scale', '0'))
    if abs(scale) > 18 or element.get('sign') not in (None, '-'):
        raise ValueError('Unsupported scale/sign')
    return value * (Decimal(10) ** scale) * (-1 if element.get('sign') == '-' else 1)


def parse_original(html, cik, tags=None):
    tags = TAGS if tags is None else tags
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', html, re.I):
        raise ValueError('DTD/entity declarations not supported')
    # Older issuer XHTML uses standard HTML named entities. Resolve only this
    # fixed local table; never fetch a DTD or recover malformed XML silently.
    def entity(match):
        name = match[1]
        if name in ('amp', 'lt', 'gt', 'apos', 'quot'):
            return match[0]
        if name + ';' not in html5:
            raise ValueError('Unknown named entity')
        return ''.join(f'&#{ord(c)};' for c in html5[name + ';'])
    html = re.sub(r'&([A-Za-z][A-Za-z0-9]+);', entity, html)
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    root = etree.fromstring(html.encode('utf-8'), parser)
    if root.getroottree().docinfo.internalDTD or root.getroottree().docinfo.externalDTD:
        raise ValueError('DTD not supported')
    contexts, units, issues = {}, {}, Counter()
    for context in root.iter(f'{{{X}}}context'):
        key = context.get('id')
        if key in contexts:
            raise ValueError('Duplicate context id')
        contexts[key] = None
        ids = context.findall(f'.//{{{X}}}identifier')
        if (len(ids) != 1 or ids[0].get('scheme') != 'http://www.sec.gov/CIK'
                or (ids[0].text or '').zfill(10) != cik):
            continue
        # No segmented/dimensional facts may impersonate consolidated totals.
        if context.findall(f'.//{{{X}}}segment') or context.findall(f'.//{{{X}}}scenario'):
            continue
        period = context.find(f'{{{X}}}period')
        if period is None:
            continue
        dates = {etree.QName(e).localname: iso_day(e.text) for e in period}
        if len(dates) != len(period):
            continue
        if set(dates) == {'instant'}:
            contexts[key] = (None, dates['instant'])
        elif set(dates) == {'startDate', 'endDate'} and dates['startDate'] <= dates['endDate']:
            contexts[key] = (dates['startDate'], dates['endDate'])
    def measure(e):
        uri, name = qualified(e, e.text.strip())
        if uri == 'http://www.xbrl.org/2003/iso4217' and name == 'USD':
            return 'USD'
        if uri == X and name == 'shares':
            return 'shares'
        raise ValueError('Unsupported unit')
    for unit in root.iter(f'{{{X}}}unit'):
        key = unit.get('id')
        if key in units:
            raise ValueError('Duplicate unit id')
        units[key] = None
        try:
            direct = unit.findall(f'{{{X}}}measure')
            if len(direct) == 1 and len(unit) == 1:
                units[key] = measure(direct[0])
            else:
                numerator = unit.findall(f'{{{X}}}divide/{{{X}}}unitNumerator/{{{X}}}measure')
                denominator = unit.findall(f'{{{X}}}divide/{{{X}}}unitDenominator/{{{X}}}measure')
                if len(numerator) == len(denominator) == 1:
                    units[key] = measure(numerator[0]) + '/' + measure(denominator[0])
        except (ValueError, AttributeError):
            continue
    records = []
    instance = root.tag == f'{{{X}}}xbrl'
    facts = list(root) if instance else root.iter(f'{{{IX}}}nonFraction')
    for fact in facts:
        try:
            if not isinstance(fact.tag, str):
                continue
            if instance:
                uri, concept = etree.QName(fact).namespace, etree.QName(fact).localname
            else:
                uri, concept = qualified(fact, fact.get('name', ''))
            gaap = re.fullmatch(r'https?://fasb.org/us-gaap/\d{4}(?:-\d{2}-\d{2})?', uri or '')
            dei = concept == 'EntityCommonStockSharesOutstanding' and re.fullmatch(r'https?://xbrl.sec.gov/dei/\d{4}(?:-\d{2}-\d{2})?', uri or '')
            if not (gaap or dei) or concept not in tags:
                continue
            context, unit = contexts.get(fact.get('contextRef')), units.get(fact.get('unitRef'))
            if context is None or unit is None:
                issues['excluded_context_or_unit'] += 1
                continue
            records.append({'concept': concept, 'unit': unit, 'start': context[0], 'end': context[1],
                            'value': str(numeric(fact)), 'context_id': fact.get('contextRef'),
                            'fact_id': fact.get('id'), 'decimals': fact.get('decimals')})
        except (ValueError, InvalidOperation, TypeError):
            issues['unsupported_numeric_fact'] += 1
    return records, dict(issues)


def compare(candidates, originals):
    index = defaultdict(list)
    for row in originals:
        index[tuple(row[k] for k in ('concept', 'unit', 'start', 'end'))].append(row)
    checks = []
    for row in candidates:
        matches = index.get(tuple(row[k] for k in ('concept', 'unit', 'start', 'end')), [])
        values = {Decimal(m['value']) for m in matches}
        status = ('missing_original_context' if not values else 'ambiguous_original_context' if len(values) > 1
                  else 'matched' if row['value'] is not None and Decimal(str(row['value'])) in values else 'value_mismatch')
        rounding = []
        if status == 'ambiguous_original_context' and row['value'] is not None:
            candidate = Decimal(str(row['value']))
            try:
                for m in matches:
                    d = m.get('decimals')
                    if d == 'INF':
                        radius = Decimal(0)
                    elif re.fullmatch(r'-?\d+', d or '') and abs(int(d)) <= 18:
                        radius = Decimal('0.5') * Decimal(10) ** -int(d)
                    else:
                        raise ValueError('Missing/unsupported decimals')
                    value = Decimal(m['value'])
                    rounding.append({'fact_id': m.get('fact_id'), 'decimals': d,
                                     'lower': str(value - radius), 'upper': str(value + radius)})
                # Require an exact reported value, plus compatibility with EVERY
                # original's declared accuracy interval. Never choose an average.
                if candidate in values and all(Decimal(r['lower']) <= candidate <= Decimal(r['upper']) for r in rounding):
                    status = 'matched_with_rounding'
            except (ValueError, InvalidOperation):
                pass
        checks.append({**row, 'original_check': status, 'original_facts': matches, 'rounding_intervals': rounding})
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('candidates', 'collection', 'output'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    candidate_raw = args.candidates.read_bytes()
    bundle = json.loads(candidate_raw)
    collection = json.loads(args.collection.read_text(encoding='utf-8'))
    if not collection or len({r['accession'] for r in collection}) != len(collection):
        raise ValueError('Empty/duplicate filing collection')
    results = []
    for entry in collection:
        payload, manifest = read_evidence(Path(entry['folder']))
        candidates = [r for r in bundle['records'] if r['accession'] == entry['accession']]
        primary_url = entry.get('primary_url', entry['url'])
        if (not candidates or manifest['request']['accession'] != entry['accession']
                or manifest['request']['url'] != entry['url'] or any(r['source'] != primary_url for r in candidates)
                or entry['url'].rsplit('/', 1)[0] != primary_url.rsplit('/', 1)[0]):
            raise ValueError('Original/candidate accession or URL mismatch')
        rows, issues = parse_original(payload.get('html', payload.get('xml')), bundle['cik'])
        checks = compare(candidates, rows)
        results.append({'accession': entry['accession'], 'evidence': manifest, 'issues': issues,
                        'counts': dict(Counter(r['original_check'] for r in checks)), 'checks': checks})
    report = {'schema_version': 'sec-original-checks-1.0.0', 'candidate_sha256': hashlib.sha256(candidate_raw).hexdigest(),
              'filings': results, 'strict_pit_eligible': False, 'model_change_allowed': False,
              'scope': 'Exact original facts for selected filings only; not all filings, revision chains or share-price unit alignment'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'accession': r['accession'], 'counts': r['counts'], 'issues': r['issues']} for r in results]))
    return 0 if all(r['original_check'] in ('matched', 'matched_with_rounding') for f in results for r in f['checks']) else 2


if __name__ == '__main__':
    raise SystemExit(main())
