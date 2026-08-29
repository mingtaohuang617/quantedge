import { describe, expect, it } from 'vitest';
import { parseEligibleFallback } from '../api/yahoo.js';

describe('quote fallback freshness boundary', () => {
  const now = Date.parse('2026-08-28T00:10:00Z');

  it('marks 30 seconds as fresh and older eligible data as stale', () => {
    const fresh = JSON.stringify({ stored_at: now - 30_000, body: '{"ok":true}' });
    const stale = JSON.stringify({ stored_at: now - 30_001, body: '{"ok":true}' });
    expect(parseEligibleFallback(fresh, now)).toMatchObject({ stale: false, ageMs: 30_000 });
    expect(parseEligibleFallback(stale, now)).toMatchObject({ stale: true, ageMs: 30_001 });
  });

  it('rejects data older than five minutes and malformed cache entries', () => {
    const expired = JSON.stringify({ stored_at: now - 300_001, body: '{"ok":true}' });
    expect(parseEligibleFallback(expired, now)).toBeNull();
    expect(parseEligibleFallback('{broken', now)).toBeNull();
  });
});
