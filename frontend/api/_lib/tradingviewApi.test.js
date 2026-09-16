import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSession } from './auth.js';
import handler, { parseTradingViewQuery, fetchTradingView } from './tradingviewApi.js';
const response = () => ({ statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(v) { this.statusCode=v; return this; }, json(v) { this.body=v; return this; } });
const request = (query = {}, authenticated = true) => ({ method: 'GET', query, headers: { origin: 'http://localhost:5173', cookie: authenticated ? `__Host-qe_session=${createSession().token}` : '' } });
beforeEach(() => { vi.stubEnv('QUANTEDGE_SESSION_SECRET', 'test-tradingview-session-secret-32-characters'); vi.stubEnv('QUANTEDGE_TRADINGVIEW_ENABLED','1'); vi.stubEnv('TV_SESSION','secret-token'); vi.stubEnv('TV_SIGNATURE','secret-signature'); });
afterEach(() => vi.unstubAllEnvs());
it('validates exchange, timeframe and rejects injection', () => {
  expect(parseTradingViewQuery({symbol:'KRX:000660'})).toEqual({symbol:'KRX:000660',timeframe:'1D'});
  expect(parseTradingViewQuery({symbol:'KRX:005930',timeframe:'60'})).toBeNull();
  expect(parseTradingViewQuery({symbol:'hkex:700'})).toEqual({symbol:'HKEX:700',timeframe:'1D'});
  expect(parseTradingViewQuery({timeframe:'1D'}).timeframe).toBe('1D');
  for (const timeframe of ['1','5','15','60','1S','1W','']) expect(parseTradingViewQuery({timeframe})).toBeNull();
  for (const symbol of ['https://evil.test', 'NASDAQ:AAPL;foo', '../secret']) expect(parseTradingViewQuery({symbol})).toBeNull();
  expect(parseTradingViewQuery({timeframe:'invalid'})).toBeNull();
});
it('requires authenticated private session before upstream access', async () => {
  const fetcher=vi.fn(); const res=response(); await handler(request({},false),res,fetcher);
  expect(res.statusCode).toBe(401); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects forbidden origins and writes', async () => {
  const req=request(); req.headers.origin='https://evil.test'; const res=response(); await handler(req,res,vi.fn()); expect(res.statusCode).toBe(403);
  const write=request(); write.method='POST'; const output=response(); await handler(write,output,vi.fn()); expect([403,405]).toContain(output.statusCode);
});
it('requires explicit enablement', async () => {
  vi.stubEnv('QUANTEDGE_TRADINGVIEW_ENABLED','0'); const res=response(); const fetcher=vi.fn(); await handler(request(),res,fetcher); expect(res.statusCode).toBe(503); expect(fetcher).not.toHaveBeenCalled();
});
it('returns actual source metadata, caches without changing received timestamp', async () => {
  const data={ resolved_symbol:'BATS:AAPL',received_at:'2026-09-15T09:00:00Z', delay_seconds:0 };
  const fetcher=vi.fn().mockResolvedValue(data); const req=request({symbol:'NASDAQ:AAPL',timeframe:'1D'});
  const first=response(); await handler(req,first,fetcher); const second=response(); await handler(req,second,fetcher);
  expect(first.body.data.cached).toBe(false); expect(second.body.data.cached).toBe(true); expect(second.body.data.received_at).toBe(data.received_at); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(first.headers['Cache-Control']).toContain('no-store'); expect(JSON.stringify(first.body)).not.toContain('secret-token');
});
it('rejects intraday queries at both route and adapter boundaries', async () => {
  const res=response(); const fetcher=vi.fn();
  await handler(request({timeframe:'60'}),res,fetcher);
  expect(res.statusCode).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  await expect(fetchTradingView({symbol:'NASDAQ:AAPL',timeframe:'1'})).rejects.toThrow('invalid_query');
});
it('sanitizes upstream errors and reports timeout distinctly', async () => {
  const res=response(); await handler(request({symbol:'BINANCE:BTCUSDT'}),res,async()=>{throw new Error('secret-token secret-signature');});
  expect(res.statusCode).toBe(502); expect(JSON.stringify(res.body)).not.toContain('secret-token');
  const timeout=response(); await handler(request({symbol:'BINANCE:ETHUSDT'}),timeout,async()=>{throw new Error('upstream_timeout');}); expect(timeout.statusCode).toBe(504);
});
