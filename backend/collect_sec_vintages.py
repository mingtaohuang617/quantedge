"""Bounded SEC companyfacts/submissions archive; no DB writes or scoring changes."""
import argparse
import hashlib
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

import requests

from price_evidence import encode, persist_evidence, read_evidence
from sec_vintages import normalize


def obtain(root, url, cik, replay, user_agent):
    request = {'provider': 'SEC', 'url': url, 'cik': cik}
    if replay:
        candidates = []
        for folder in root.iterdir():
            if not folder.is_dir():
                continue
            payload, manifest = read_evidence(folder)
            if manifest['request'] == request:
                candidates.append((manifest['retrieved_at'], folder, payload, manifest))
        if not candidates:
            raise ValueError('Missing exact archived request')
        _, folder, payload, manifest = max(candidates, key=lambda x: (x[0], x[1].name))
    else:
        response = requests.get(url, headers={'User-Agent': user_agent}, timeout=40)
        response.raise_for_status()
        payload = response.json()
        folder = persist_evidence(root, response.content, request, datetime.now(UTC).isoformat())
        _, manifest = read_evidence(folder)
    return payload, {'folder': str(folder.resolve()), **manifest}


def run(cik, root, replay, user_agent):
    if not re.fullmatch(r'\d{10}', cik):
        raise ValueError('Require a 10-digit CIK')
    refs = []
    submissions, ref = obtain(root, f'https://data.sec.gov/submissions/CIK{cik}.json', cik, replay, user_agent)
    refs.append(ref)
    if str(submissions['cik']).zfill(10) != cik:
        raise ValueError('Submission CIK mismatch')
    files = submissions['filings']['files']
    if len(files) > 5:
        raise ValueError('Pilot limited to five older submission files; do not silently truncate')
    tables = [submissions['filings']['recent']]
    for entry in files:
        name = entry['name']
        if not re.fullmatch(r'CIK' + cik + r'-submissions-\d+\.json', name):
            raise ValueError('Unexpected SEC history filename')
        payload, ref = obtain(root, 'https://data.sec.gov/submissions/' + name, cik, replay, user_agent)
        tables.append(payload)
        refs.append(ref)
    facts, ref = obtain(root, f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json', cik, replay, user_agent)
    refs.append(ref)
    result = normalize(facts, tables, cik)
    result['evidence'] = refs
    result['production_database_modified'] = False
    result['records_sha256'] = hashlib.sha256(encode(result['records'])).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cik', required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--replay', action='store_true')
    args = parser.parse_args()
    try:
        result = run(args.cik, args.root, args.replay,
                     os.environ.get('SEC_USER_AGENT', 'QuantEdge Research https://mintoview.com'))
        status = 0
    except (requests.RequestException, ValueError, KeyError, TypeError, OSError) as exc:
        result = {'cik': args.cik, 'status': 'failed', 'error_type': type(exc).__name__,
                  'strict_pit_eligible': False, 'model_change_allowed': False}
        status = 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'status': result.get('status', 'candidate_only'), 'records': len(result.get('records', [])),
                      'issues': result.get('issues', {}), 'error_type': result.get('error_type')}))
    return status


if __name__ == '__main__':
    raise SystemExit(main())
