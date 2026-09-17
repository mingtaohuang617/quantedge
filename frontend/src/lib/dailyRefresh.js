import { dailySymbol, dailySummary } from './dailyWatchlist.js';
export const DAILY_LIVE_KEY = 'qe:market:daily:v1';
export const DAILY_HEALTH_KEY = 'qe:market:daily:health:v1';
export function selectDailyMarket(ticker, market) {
  const symbol = dailySymbol(ticker);
  return !!symbol && (market === 'all' || (market === 'us' ? symbol.startsWith('BATS:') : /^(HKEX|KRX|TSE|SSE|SZSE):/.test(symbol)));
}
export function mergeDailyReleases(baseline, update) {
  if (baseline?.timeframe !== '1D' || !Array.isArray(baseline.rows)) throw Error('invalid_baseline');
  const rows = new Map(baseline.rows.map(row => [row.ticker, row]));
  let updated = false;
  if (update?.timeframe !== '1D' || !Array.isArray(update.rows)) return baseline;
  for (const row of update.rows) {
    try {
      if (row.status !== 'success') continue;
      const candidate = dailySummary({ ...row.snapshot, bars: [row.snapshot?.bar] });
      if (candidate.resolved_symbol.replace('_DLY:', ':') !== dailySymbol(row.ticker)) continue;
      const old = rows.get(row.ticker);
      if (old?.status === 'inactive') continue;
      if (old?.snapshot && (candidate.bar.time < old.snapshot.bar.time || Date.parse(candidate.received_at) <= Date.parse(old.snapshot.received_at))) continue;
      rows.set(row.ticker, row);
      updated = true;
    } catch { /* malformed updates must not replace usable records */ }
  }
  const merged = [...rows.values()];
  return { ...baseline, rows: merged, total: merged.length, success: merged.filter(row => row.status === 'success').length,
    generated_at: updated && Date.parse(update.generated_at) > Date.parse(baseline.generated_at) ? update.generated_at : baseline.generated_at };
}

// The caller injects persistence/network. Retries remain bounded and spaced;
// a successful transport with invalid data is not a successful refresh.
export async function collectDailyRows(queue, { fetcher, validate, wait, onProgress = () => {}, attempts = 3 }) {
  const rows = []; const failures = [];
  let requests = 0;
  for (const row of queue) {
    let accepted = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (requests++) await wait(attempt ? 15000 * attempt : 6000);
      try {
        const data = await fetcher({ symbol: dailySymbol(row.ticker), timeframe: '1D' });
        rows.push(validate(row.ticker, data)); accepted = true; break;
      } catch { /* sanitized aggregate status only */ }
    }
    if (!accepted) failures.push(row.ticker);
    await onProgress({ rows, failures, processed: rows.length + failures.length });
    // Credentials/provider outage: stop early rather than hammering 500 names.
    if (failures.length >= 5 && rows.length === 0) break;
  }
  return { rows, failures, processed: rows.length + failures.length, requested: queue.length };
}
