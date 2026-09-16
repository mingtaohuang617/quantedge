// Trusted cloud runner only: no write endpoint, credentials never enter logs.
import { setTimeout as wait } from 'node:timers/promises';
import { KV_ENABLED, kvGetJsonStrict as kvGetJson, kvSetJson } from '../api/_lib/kv.js';
import { readDailySnapshot } from '../api/_lib/dailySnapshots.js';
import { fetchTradingView } from '../api/_lib/tradingviewApi.js';
import { buildDailySnapshot } from './build-daily-snapshot.mjs';
import { dailySummary } from '../src/lib/dailyWatchlist.js';
import { DAILY_INACTIVE } from '../src/lib/dailyInstrumentStatus.js';
import { DAILY_LIVE_KEY, DAILY_HEALTH_KEY, selectDailyMarket, mergeDailyReleases, collectDailyRows } from '../src/lib/dailyRefresh.js';

async function main() {
  const market = process.argv[2] || 'all';
  if (!['all', 'asia', 'us'].includes(market)) throw Error('invalid_market');
  if (!KV_ENABLED || !process.env.TV_SESSION || !process.env.TV_SIGNATURE) throw Error('missing_configuration');
  const started = new Date().toISOString();
  const baseline = await readDailySnapshot();
  const initial = mergeDailyReleases(baseline, await kvGetJson(DAILY_LIVE_KEY));
  const queue = initial.rows.filter(row => !DAILY_INACTIVE[row.ticker] && selectDailyMarket(row.ticker, market));
  const validate = (ticker, data) => {
    const output = buildDailySnapshot({ total: 1, completed_at: new Date().toISOString(), results: [{ ticker, status: 'success', bars: data.bars, snapshot: dailySummary(data) }] }, [{ ticker }]);
    return output.rows[0];
  };
  await kvSetJson(DAILY_HEALTH_KEY, { status: 'running', market, started_at: started, total: queue.length });
  const result = await collectDailyRows(queue, { fetcher: fetchTradingView, validate, wait, onProgress: async progress => {
    if (progress.processed % 20 !== 0) return;
    // Checkpoint only validated records; failed rows retain their original date.
    const current = mergeDailyReleases(baseline, await kvGetJson(DAILY_LIVE_KEY));
    await kvSetJson(DAILY_LIVE_KEY, mergeDailyReleases(current, { timeframe: '1D', generated_at: new Date().toISOString(), rows: progress.rows }));
    await kvSetJson(DAILY_HEALTH_KEY, { status: 'running', market, started_at: started, processed: progress.processed, total: queue.length, failed: progress.failures.length });
    console.log(JSON.stringify({ processed: progress.processed, total: queue.length, failed: progress.failures.length }));
  } });
  const completed = new Date().toISOString();
  const next = mergeDailyReleases(initial, { timeframe: '1D', generated_at: completed, rows: result.rows });
  await kvSetJson(DAILY_LIVE_KEY, next);
  const stored = await kvGetJson(DAILY_LIVE_KEY);
  if (JSON.stringify(stored) !== JSON.stringify(next)) throw Error('readback_mismatch');
  const degraded = result.failures.length > 0 || result.processed !== queue.length;
  const stale = result.rows.filter(row => row.stale).length;
  const health = { status: degraded ? 'degraded' : 'complete', market, started_at: started, completed_at: completed,
    total: queue.length, processed: result.processed, success: result.rows.length, failed: result.failures.length, stale };
  await kvSetJson(DAILY_HEALTH_KEY, health);
  console.log(JSON.stringify(health));
  if (degraded) process.exitCode = 1;
}
main().catch(async () => {
  // Avoid raw errors / URLs / provider responses in public CI logs.
  try { await kvSetJson(DAILY_HEALTH_KEY, { status: 'failed', completed_at: new Date().toISOString() }); } catch { /* unavailable storage */ }
  console.error('Daily refresh failed; previous successful data retained. Check configuration or upstream availability.');
  process.exitCode = 1;
});
