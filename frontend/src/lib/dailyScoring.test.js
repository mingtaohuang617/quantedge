import { expect, it } from 'vitest';
import { dailyScoringStock } from './dailyScoring.js';
const now = Date.parse('2026-09-16T22:00:00Z');
const fixture = () => ({ timeframe: '1D', resolved_symbol: 'BATS:MU', received_at: '2026-09-16T21:00:00Z', timezone: 'America/New_York',
  bar: { time: 1789565400, close: 110 }, previous_close: 100, indicators: { time: 1789565400, rsi: 60, macd: 2, signal: 1, histogram: 1 } });
it('overlays daily display only, preserves scoring/financial objects and independently computes change', () => {
  const stock = { ticker: 'MU', price: 1, rsi: 2, score: 70, pe: 10, scoring: { priceAsOf: '2025-12-01' }, scoringInputs: { rsi: 12 } };
  const result = dailyScoringStock(stock, { MU: fixture() }, now);
  expect(result.price).toBe(110); expect(result.change).toBeCloseTo(10); expect(result.rsi).toBe(60);
  expect(result.score).toBe(70); expect(result.pe).toBe(10); expect(result.scoring).toBe(stock.scoring); expect(result.scoringInputs).toBe(stock.scoringInputs);
  expect(stock.price).toBe(1); expect(result.dailyQuote.date).toBe('2026-09-16');
});
it('does not infer unchanged return from missing previous close, or overwrite with mismatched ticker', () => {
  const value = fixture(); delete value.previous_close;
  expect(dailyScoringStock({ ticker: 'MU' }, { MU: value }, now).change).toBeNull();
  expect(dailyScoringStock({ ticker: 'SPY', price: 3 }, { SPY: value }, now)).toMatchObject({ price: 3, dailyQuote: { status: 'unavailable' } });
});
it('marks stale observations and ceased trading without presenting cached prices as current', () => {
  expect(dailyScoringStock({ ticker: 'MU' }, { MU: fixture() }, now + 2 * 86400000).dailyQuote.status).toBe('stale');
  expect(dailyScoringStock({ ticker: 'EA', price: 99 }, {}, now)).toMatchObject({ price: null, dailyQuote: { status: 'inactive' } });
});
