// Runs in trusted CI only. Never print cookies, environment values or raw errors.
import { execFileSync } from 'node:child_process';
import { createSession } from '../api/_lib/auth.js';
import { dailySymbol } from '../src/lib/dailyWatchlist.js';
import { dailySummary } from '../src/lib/dailyWatchlist.js';
import { readDailySnapshot } from '../api/_lib/dailySnapshots.js';
import { STOCKS } from '../src/data.js';
import { DAILY_INACTIVE } from '../src/lib/dailyInstrumentStatus.js';
import { loginForSmoke } from './smoke-login.mjs';
const base = new URL(process.argv[2]);
if (base.protocol !== 'https:' || !base.hostname.endsWith('.vercel.app')) throw new Error('Expected verified Vercel deployment');
const cookie = process.argv.includes('--protected')
  ? `__Host-qe_session=${createSession().token}`
  : await loginForSmoke(base, process.env.QUANTEDGE_SMOKE_INVITE_CODE);
let csrfToken;
const request = async (path, authenticated = true, payload = null) => {
  if (process.argv.includes('--protected')) {
    const args = ['curl', path, '--deployment', base.origin, '--', '--silent', '--show-error', '--max-time', '45',
      '--header', `Origin: ${base.origin}`, '--write-out', '\\n%{http_code}'];
    if (authenticated) args.push('--header', `Cookie: ${cookie}`);
    if (payload !== null) {
      args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data', JSON.stringify(payload));
      if (authenticated) args.push('--header', `X-CSRF-Token: ${csrfToken}`);
    }
    let output;
    try { output = execFileSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 55000 }); }
    catch { throw new Error('Protected deployment request failed'); }
    const split = output.lastIndexOf('\n');
    let body;
    try { body = JSON.parse(output.slice(0, split)); } catch { throw new Error('Deployment returned non-JSON'); }
    return { status: Number(output.slice(split + 1)), body };
  }
  const response = await fetch(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(45000),
    ...(payload !== null ? { method: 'POST', body: JSON.stringify(payload) } : {}),
    headers: { origin: base.origin, ...(authenticated ? { cookie } : {}), ...(payload !== null ? { 'content-type': 'application/json', ...(authenticated ? { 'x-csrf-token': csrfToken } : {}) } : {}) } });
  let body;
  try { body = await response.json(); } catch { throw new Error('Deployment returned non-JSON'); }
  return { status: response.status, body };
};
const endpoint = '/api/private/market-data/tradingview';
const readFavorites = async () => {
  const result = await request('/api/watchlist/favorites');
  if(result.status!==200 || result.body.kv===false || !Array.isArray(result.body.tickers))throw new Error('Server favorites verification unavailable');
  return [...result.body.tickers].sort();
};
// Preview may use an isolated data store; check user favorites on production only.
const beforeFavorites = process.argv.includes('--protected') ? null : await readFavorites();
const unauth = await request(endpoint, false);
if (unauth.status !== 401) throw new Error('Authentication gate failed');
const intraday = await request(endpoint + '?symbol=NASDAQ:AAPL&timeframe=60');
if (intraday.status !== 400) throw new Error('Daily-only gate failed');
console.log('Private authentication and daily-only gates: PASS');
// Reject before cache/model access; this does not call a paid model or write data.
const session = await request('/api/auth/session');
csrfToken = session.body.data?.csrf_token;
if (session.status !== 200 || typeof csrfToken !== 'string' || !csrfToken) throw new Error('Smoke session CSRF unavailable');
const scoreProbe = await request('/api/llm/explain-score', true, { ticker: 'SMOKE', assetType: 'crypto', score: null });
if (scoreProbe.status !== 400 || scoreProbe.body.code !== 'invalid_score_contract') throw new Error('Score explanation contract gate failed');
console.log('Local scoring explanation contract gate: PASS');
const snapshotPath='/api/private/market-data/daily-snapshots';
if((await request(snapshotPath,false)).status!==401)throw new Error('Published snapshot authentication gate failed');
const expected=await readDailySnapshot();
const publishedTickers=new Set(expected.rows.map(row=>row.ticker));
if(STOCKS.some(stock=>!publishedTickers.has(stock.ticker)))throw new Error('Snapshot omits a published universe ticker');
if(beforeFavorites?.some(ticker=>!publishedTickers.has(ticker)))throw new Error('Snapshot omits a current server favorite');
const published=await request(snapshotPath);
if(published.status!==200 || published.body.data?.timeframe!=='1D')throw new Error('Published universe snapshot unavailable');
const actualRows = new Map(published.body.data.rows.map(row=>[row.ticker,row]));
for(const row of expected.rows) {
  const actual=actualRows.get(row.ticker);
  if(!actual || actual.status!==row.status)throw new Error('Published universe coverage mismatch');
  if(row.status==='success') {
    const snap=dailySummary({...actual.snapshot,bars:[actual.snapshot?.bar]});
    if(snap.resolved_symbol!==row.snapshot.resolved_symbol || snap.bar.time<row.snapshot.bar.time || Date.parse(snap.received_at)<Date.parse(row.snapshot.received_at))throw new Error('Published universe regressed');
  }
}
for(const row of expected.rows) {
  if(row.status==='success')dailySummary({...row.snapshot,bars:[row.snapshot.bar]});
  else if(row.status!=='inactive'||!DAILY_INACTIVE[row.ticker]||row.effective_at!==DAILY_INACTIVE[row.ticker].effective_at)throw new Error('Published active universe contains an unresolved daily row');
}
console.log(JSON.stringify({published_daily_total:expected.total,published_daily_success:expected.success,generated_at:expected.generated_at}));
const favorites = ['MU','EWY','000660.KS','NVDA','DRAM','GOOG','005930.KS','GOOGL','RKLB','AAOI','QQQ','TQQQ','SOXL','UGL','07747.HK','RKLX','KORU','07709.HK','07552.HK','8035.T','7203.T','6758.T'];
for (const ticker of favorites) {
  const symbol = dailySymbol(ticker);
  await new Promise(resolve => setTimeout(resolve, 6000));
  const path = endpoint + '?' + new URLSearchParams({ symbol, timeframe: '1D' });
  let result = await request(path);
  // One bounded retry for transient upstream failure; no intraday fallback.
  if ([502, 504].includes(result.status)) {
    await new Promise(resolve => setTimeout(resolve, 6000));
    result = await request(path);
  }
  const data = result.body.data;
  if (result.status !== 200 || data?.timeframe !== '1D' || data?.bars?.length < 2
      || data?.indicators?.time !== data.bars[0].time
      || !['rsi', 'macd', 'signal', 'histogram'].every(key => Number.isFinite(data.indicators[key]))) {
    throw new Error(`Daily data verification failed: ${symbol} HTTP ${result.status} ${result.body.error?.code || 'invalid_data'}`);
  }
  console.log(JSON.stringify({ tested_at: new Date().toISOString(), symbol, resolved: data.resolved_symbol,
    timeframe: data.timeframe, bars: data.bars.length, indicators_aligned: true, received_at: data.received_at }));
}
if(beforeFavorites) {
  const afterFavorites=await readFavorites();
  if(JSON.stringify(beforeFavorites)!==JSON.stringify(afterFavorites))throw new Error('Favorites changed during read-only daily verification');
  console.log(JSON.stringify({favorites_count:afterFavorites.length,favorites_unchanged:true}));
}
