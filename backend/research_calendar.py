"""Bounded US equity daily-session audit. Not an intraday/settlement calendar.

Reviewed 2026-09-16 against Nasdaq's 2025 calendar, 2026 holiday schedule
and ETA2025-1 (the exceptional 2025-01-09 closure). Half days remain sessions.
No inference outside the reviewed interval; no fallback for other markets.
"""
from collections import Counter
from datetime import date, timedelta

SOURCES = [
    'https://www.nasdaqtrader.com/content/technicalsupport/2025tradingcalendar.pdf',
    'https://nasdaqtrader.com/Trader.aspx?id=Calendar',
    'https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2025-1',
]
VERSION = 'us-equity-daily-2026-09-16'
START, END = '2025-01-01', '2026-09-15'
CLOSED = set('''2025-01-01 2025-01-09 2025-01-20 2025-02-17 2025-04-18
2025-05-26 2025-06-19 2025-07-04 2025-09-01 2025-11-27 2025-12-25
2026-01-01 2026-01-19 2026-02-16 2026-04-03 2026-05-25 2026-06-19
2026-07-03 2026-09-07'''.split())


def sessions(start, end, market='US_EQUITY'):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if (first.isoformat() != start or last.isoformat() != end
            or market != 'US_EQUITY' or not START <= start <= end <= END):
        raise ValueError('Outside reviewed calendar scope')
    days = (first + timedelta(days=i) for i in range((last - first).days + 1))
    return [d.isoformat() for d in days if d.weekday() < 5 and d.isoformat() not in CLOSED]


def audit_sessions(days, start, end):
    expected = set(sessions(start, end))
    counts = Counter(days)
    missing, unexpected = sorted(expected - counts.keys()), sorted(counts.keys() - expected)
    duplicates = sorted(d for d, n in counts.items() if n > 1)
    return {'version': VERSION, 'start': start, 'end': end, 'expected': len(expected),
            'missing': missing, 'unexpected': unexpected, 'duplicates': duplicates,
            'passed': not (missing or unexpected or duplicates), 'sources': SOURCES}
