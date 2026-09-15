// Runs in trusted CI only. Never print cookies, environment values or raw errors.
import { execFileSync } from 'node:child_process';
import { createSession } from '../api/_lib/auth.js';
import { dailySymbol } from '../src/lib/dailyWatchlist.js';
const base = new URL(process.argv[2]);
if (base.protocol !== 'https:' || !base.hostname.endsWith('.vercel.app')) throw new Error('Expected verified Vercel deployment');
const cookie = `__Host-qe_session=${createSession().token}`;
const request = async (path, authenticated = true) => {
  if (process.argv.includes('--protected')) {
    const args = ['curl', path, '--deployment', base.origin, '--', '--silent', '--show-error', '--max-time', '45',
      '--header', `Origin: ${base.origin}`, '--write-out', '\\n%{http_code}'];
    if (authenticated) args.push('--header', `Cookie: ${cookie}`);
    let output;
    try { output = execFileSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 55000 }); }
    catch { throw new Error('Protected deployment request failed'); }
    const split = output.lastIndexOf('\n');
    let body;
    try { body = JSON.parse(output.slice(0, split)); } catch { throw new Error('Deployment returned non-JSON'); }
    return { status: Number(output.slice(split + 1)), body };
  }
  const response = await fetch(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { origin: base.origin, ...(authenticated ? { cookie } : {}) } });
  let body;
  try { body = await response.json(); } catch { throw new Error('Deployment returned non-JSON'); }
  return { status: response.status, body };
};
const endpoint = '/api/private/market-data/tradingview';
const unauth = await request(endpoint, false);
if (unauth.status !== 401) throw new Error('Authentication gate failed');
const intraday = await request(endpoint + '?symbol=NASDAQ:AAPL&timeframe=60');
if (intraday.status !== 400) throw new Error('Daily-only gate failed');
console.log('Private authentication and daily-only gates: PASS');
const favorites = ['MU','EWY','000660.KS','NVDA','DRAM','GOOG','005930.KS','GOOGL','RKLB','AAOI','QQQ','TQQQ','SOXL','UGL','07747.HK','RKLX','KORU','07709.HK','07552.HK'];
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
