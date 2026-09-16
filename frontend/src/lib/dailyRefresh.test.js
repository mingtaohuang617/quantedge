import { expect, it, vi } from 'vitest';
import { collectDailyRows, mergeDailyReleases, selectDailyMarket } from './dailyRefresh.js';
const row = (time = 1789516800, received = '2026-09-16T22:00:00Z') => ({ ticker: 'MU', status: 'success', snapshot: {
  timeframe: '1D', resolved_symbol: 'BATS:MU', received_at: received, bar: { time, close: 100 }, indicators: { time, rsi: 50, macd: 1, signal: 1, histogram: 0 } } });
it('separates market batches without intraday or unsupported instruments', () => {
  expect(selectDailyMarket('MU', 'us')).toBe(true); expect(selectDailyMarket('MU', 'asia')).toBe(false);
  for (const ticker of ['07747.HK','000660.KS','7203.T','600519.SS','300750.SZ']) expect(selectDailyMarket(ticker,'asia')).toBe(true);
  expect(selectDailyMarket('BTC-USD','all')).toBe(false);
});
it('keeps previous rows on failure, rejects older bars and preserves inactive exceptions', () => {
  const baseline = { timeframe: '1D', generated_at: '2026-09-16T22:00:00Z', rows: [row(), { ticker: 'EA', status: 'inactive' }] };
  const out = mergeDailyReleases(baseline, { timeframe: '1D', generated_at: '2026-09-17T22:00:00Z', rows: [{ ticker:'MU',status:'failed' }, row(1789430400,'2026-09-17T22:00:00Z')] });
  expect(out.rows).toEqual(baseline.rows); expect(out.total).toBe(2);
  expect(out.generated_at).toBe(baseline.generated_at);
});
it('retries transport and validation errors, then reports partial failure without overwriting', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(Error()).mockResolvedValue({});
  const validate = vi.fn().mockReturnValue(row()); const wait = vi.fn();
  const out = await collectDailyRows([{ticker:'MU'}], { fetcher, validate, wait });
  expect(out.rows).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledWith(15000);
  const bad = await collectDailyRows([{ticker:'MU'}], { fetcher, validate:()=>{throw Error();}, wait });
  expect(bad.failures).toEqual(['MU']); expect(bad.rows).toEqual([]);
});
it('stops a broad provider outage after five failed tickers', async () => {
  const fetcher = vi.fn().mockRejectedValue(Error());
  const result = await collectDailyRows(Array.from({length:10},()=>({ticker:'MU'})), { fetcher, validate:()=>{}, wait:async()=>{} });
  expect(result.processed).toBe(5); expect(fetcher).toHaveBeenCalledTimes(15);
});
