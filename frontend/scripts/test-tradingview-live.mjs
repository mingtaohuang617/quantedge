// Explicit, opt-in live test. Load TV_* with node --env-file; never log secrets.
import crypto from 'node:crypto';
import { createServer } from 'vite';
import { createSession } from '../api/_lib/auth.js';
if (!process.env.TV_SESSION || !process.env.TV_SIGNATURE) throw new Error('Load server-side TV credentials first');
process.env.QUANTEDGE_TRADINGVIEW_ENABLED = '1';
process.env.QUANTEDGE_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true, open: false }, logLevel: 'error' });
try {
  await server.listen();
  const base = 'http://127.0.0.1:5187/api/private/market-data/tradingview';
  const unauth = await fetch(base, { headers: { origin: 'http://localhost:5173' } });
  if (unauth.status !== 401) throw new Error('Unauthenticated access was not denied');
  console.log('Unauthenticated HTTP request: 401 PASS');
  const cookie = `__Host-qe_session=${createSession().token}`;
  for (const symbol of process.argv.slice(2).length ? process.argv.slice(2) : ['BINANCE:BTCUSDT', 'HKEX:700']) {
    const response = await fetch(`${base}?${new URLSearchParams({ symbol, timeframe: '1D' })}`, { headers: { origin: 'http://localhost:5173', cookie }, signal: AbortSignal.timeout(35000) });
    const payload = await response.json();
    const data = payload.data;
    console.log(JSON.stringify({ tested_at: new Date().toISOString(), status: response.status, symbol, resolved: data?.resolved_symbol, bars: data?.bars?.length, candle: data?.bars?.[0], indicators: data?.indicators, delay_seconds: data?.delay_seconds, received_at: data?.received_at, error: payload.error?.code }));
    if (!response.ok || data.timeframe !== '1D' || data.indicators.time !== data.bars[0].time) process.exitCode = 1;
  }
} finally { await server.close(); }
