import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireOrigin, requireSession, sendError, enforceRateLimit, runWithConcurrency } from './auth.js';

const cache = new Map();
export function parseTradingViewQuery(query) {
  const symbol = String(query.symbol || 'NASDAQ:AAPL').trim().toUpperCase();
  const timeframe = String(query.timeframe ?? '1D');
  if (!/^(NASDAQ|NYSE|AMEX|BATS|HKEX|KRX|TSE|SSE|SZSE|BINANCE):[A-Z0-9.\-]{1,24}$/.test(symbol)
    || timeframe !== '1D') return null;
  return { symbol, timeframe };
}

export function fetchTradingView(query) {
  const validated = parseTradingViewQuery(query);
  if (!validated) return Promise.reject(new Error('invalid_query'));
  return new Promise((resolve, reject) => {
    // No secrets in argv/stdout. Only this worker receives provider credentials.
    const bundled = new URL('./tradingview-runtime/worker.cjs', import.meta.url);
    const worker = existsSync(bundled) ? bundled : new URL('./tradingview-worker.cjs', import.meta.url);
    const child = fork(fileURLToPath(worker), [], {
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TV_SESSION', 'TV_SIGNATURE', 'TV_PROXY'].includes(key))),
    });
    let settled = false;
    const finish = (error, data, progress) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) {
        console.warn('TradingView worker failure', { code: ['upstream_timeout','upstream_unavailable'].includes(error) ? error : 'worker_failed', progress: progress || null });
        reject(Object.assign(new Error(error), { progress }));
      } else resolve(data);
    };
    const timer = setTimeout(() => finish('upstream_timeout'), 28000);
    child.once('error', () => finish('upstream_unavailable'));
    child.once('exit', () => finish('upstream_unavailable'));
    child.once('message', payload => finish(payload.error, payload.data, payload.progress));
    child.send(validated);
  });
}

export default async function tradingviewApi(req, res, fetcher = fetchTradingView) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (!requireOrigin(req, res) || !requireSession(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed', 'Only GET is supported');
  }
  if (!enforceRateLimit(req, res, 'tradingview', { limit: 12, windowMs: 60000 })) return;
  const query = parseTradingViewQuery(req.query);
  if (!query) return sendError(res, 400, 'invalid_query', 'Unsupported symbol or timeframe');
  if (process.env.QUANTEDGE_TRADINGVIEW_ENABLED !== '1' || !process.env.TV_SESSION || !process.env.TV_SIGNATURE) {
    return sendError(res, 503, 'tradingview_not_configured', 'TradingView 服务尚未启用或登录凭据未配置');
  }
  const key = JSON.stringify(query);
  const cached = cache.get(key);
  const respond = (data, hit) => res.status(200).json({ data: { ...data, cached: hit }, meta: { schema_version: '1.1', source: 'tradingview', available_at: data.received_at } });
  if (cached && cached.expires > Date.now()) return respond(cached.data, true);
  return runWithConcurrency(res, 'tradingview', 2, async () => {
    try {
      const data = await fetcher(query);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expires: Date.now() + 15000 });
      return respond(data, false);
    } catch (error) {
      const timeout = error.message === 'upstream_timeout';
      return sendError(res, timeout ? 504 : 502, timeout ? 'tradingview_timeout' : 'tradingview_unavailable', timeout
        ? 'TradingView 查询超时，请稍后重试'
        : 'TradingView 暂不可用，请检查服务端网络、登录有效期和指标权限');
    }
  });
}
