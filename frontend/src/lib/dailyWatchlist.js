import { DAILY_INACTIVE } from './dailyInstrumentStatus.js';
export const DAILY_SNAPSHOT_KEY = 'quantedge_daily_snapshots_v1';
const supported = /^(NASDAQ|NYSE|AMEX|BATS|HKEX|KRX|TSE|SSE|SZSE|BINANCE):[A-Z0-9.\-]{1,24}$/;
export function dailySymbol(ticker) {
  const value = String(ticker || '').trim().toUpperCase();
  if (supported.test(value)) return value;
  const hk = value.match(/^(\d{1,5})\.HK$/);
  if (hk) return `HKEX:${Number(hk[1])}`;
  const kr = value.match(/^(\d{6})\.KS$/);
  if (kr) return `KRX:${kr[1]}`;
  const jp = value.match(/^(\d{4})\.T$/);
  if (jp) return `TSE:${jp[1]}`;
  const cn = value.match(/^(\d{6})\.(SH|SS|SZ)$/);
  if (cn) return `${cn[2] === 'SZ' ? 'SZSE' : 'SSE'}:${cn[1]}`;
  // Bare US symbols use the explicit Cboe source, never pretend to be primary exchange quotes.
  if (/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(value)) return `BATS:${value.replace('-', '.')}`;
  return null;
}

export function buildDailyQueue(favorites, stocks = [], expand = false) {
  const seen = new Set();
  const rows = [];
  const add = (ticker, favorite) => {
    const key = String(ticker || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({ ticker: key, favorite, symbol: dailySymbol(key), ...(DAILY_INACTIVE[key] ? {inactive:DAILY_INACTIVE[key]} : {}) });
  };
  favorites.forEach(ticker => add(ticker, true));
  if (expand) stocks.forEach(stock => add(stock.ticker, false));
  return rows;
}

export async function loadDailyFavorites(request, storage) {
  let local = [];
  try { const parsed = JSON.parse(storage?.getItem('quantedge_favorites') || '[]'); if (Array.isArray(parsed)) local = parsed.filter(x => typeof x === 'string'); } catch { /* no local copy */ }
  try {
    const remote = await request('/watchlist/favorites', { noRetry: true });
    if (Array.isArray(remote?.tickers) && remote.kv !== false && (remote.tickers.length || remote.updated_at)) {
      return { tickers: remote.tickers.filter(x => typeof x === 'string'), source: 'server', updatedAt: remote.updated_at || null };
    }
  } catch { /* keep explicitly labelled local fallback */ }
  return { tickers: local, source: 'local', updatedAt: null };
}

export function dailySummary(data) {
  const bar = data?.bars?.[0];
  if (data?.timeframe !== '1D' || !Number.isFinite(bar?.time) || !Number.isFinite(bar?.close)
    || data?.indicators?.time !== bar.time || !['rsi','macd','signal','histogram'].every(key => Number.isFinite(data.indicators[key]))
    || !data.resolved_symbol || !Number.isFinite(Date.parse(data.received_at))) throw new Error('invalid_daily_data');
  return { resolved_symbol: data.resolved_symbol, timeframe: '1D', currency: data.currency, timezone: data.timezone,
    delay_seconds: data.delay_seconds, received_at: data.received_at, bar, indicators: data.indicators,
    ...(Number.isFinite(data.previous_close ?? data.bars?.[1]?.close) && (data.previous_close ?? data.bars?.[1]?.close) > 0
      ? { previous_close: data.previous_close ?? data.bars[1].close } : {}) };
}

export function loadDailySnapshots(storage) {
  const output = {};
  try {
    const parsed = JSON.parse(storage.getItem(DAILY_SNAPSHOT_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return output;
    for (const [ticker, snapshot] of Object.entries(parsed)) {
      try { output[ticker] = dailySummary({ ...snapshot, bars: [snapshot.bar] }); } catch { /* invalid cache is not market data */ }
    }
  } catch { /* storage unavailable */ }
  return output;
}

export async function loadPublishedDaily(request, storage) {
  const snapshots = loadDailySnapshots(storage);
  let published = null;
  try {
    const data = await request('/private/market-data/daily-snapshots', { noRetry: true });
    if (data?.timeframe !== '1D' || !Array.isArray(data.rows)) throw new Error('invalid_snapshot');
    published = data;
    for (const row of data.rows) {
      if (row.status !== 'success' || typeof row.ticker !== 'string') continue;
      try {
        const snapshot = dailySummary({ ...row.snapshot, bars: [row.snapshot?.bar] });
        const existing = snapshots[row.ticker];
        if (!existing || (snapshot.bar.time >= existing.bar.time && Date.parse(snapshot.received_at) > Date.parse(existing.received_at))) snapshots[row.ticker] = snapshot;
      } catch { /* Invalid published rows never replace a valid local copy. */ }
    }
    try { storage.setItem(DAILY_SNAPSHOT_KEY, JSON.stringify(snapshots)); } catch { /* still usable in memory */ }
  } catch { /* Manual daily fetch and local snapshots remain available. */ }
  return { snapshots, published };
}

export async function runDailyQueue(queue, { request, onResult, signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), spacingMs = 6000 }) {
  const result = { success: 0, failed: 0, skipped: 0, stopped: false };
  let firstRequest = true;
  for (const row of queue) {
    if (signal?.aborted) { result.stopped = true; break; }
    if (row.inactive) { result.skipped++; onResult({...row,status:'inactive'}); continue; }
    if (!row.symbol) { result.skipped++; onResult({ ...row, status: 'unsupported' }); continue; }
    if (!firstRequest) await wait(spacingMs);
    if (signal?.aborted) { result.stopped = true; break; }
    firstRequest = false;
    try {
      const data = await request(`/private/market-data/tradingview?${new URLSearchParams({ symbol: row.symbol, timeframe: '1D' })}`, { noRetry: true, signal });
      if (signal?.aborted) { result.stopped = true; break; }
      const snapshot = dailySummary(data);
      result.success++; onResult({ ...row, status: 'success', snapshot });
    } catch (error) {
      if (signal?.aborted) { result.stopped = true; break; }
      result.failed++;
      onResult({ ...row, status: 'failed', code: error.code || 'request_failed' });
      // Stop on auth/config/rate failures: do not hammer every stock with the same error.
      if ([401, 403, 429, 503].includes(error.status)) { result.stopped = true; break; }
    }
  }
  return result;
}
