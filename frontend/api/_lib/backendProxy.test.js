import { describe, expect, it } from 'vitest';
import { normalizeBackendPath } from './backendProxy.js';

describe('BFF route allowlist', () => {
  it('accepts known backend roots', () => {
    expect(normalizeBackendPath(['mining-alpha', 'run', 'status'])).toBe('mining-alpha/run/status');
    expect(normalizeBackendPath('smart-beta/backtest')).toBe('smart-beta/backtest');
  });

  it('rejects traversal, empty segments, backslashes and unknown roots', () => {
    for (const value of ['../secret', 'db/../secret', 'db//stats', 'db\\stats', 'admin/run', '%2e%2e/secret']) {
      expect(normalizeBackendPath(value), value).toBeNull();
    }
  });
});
