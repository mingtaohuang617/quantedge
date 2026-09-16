import { proxyToBackend } from './_lib/backendProxy.js';
import inviteHandler from './auth/_invite.js';
import logoutHandler from './auth/_logout.js';
import sessionHandler from './auth/_session.js';
import tradingviewApi from './_lib/tradingviewApi.js';
import dailySnapshots from './_lib/dailySnapshots.js';

export const config = { maxDuration: 60 };

const AUTH_HANDLERS = {
  'auth/invite': inviteHandler,
  'auth/logout': logoutHandler,
  'auth/session': sessionHandler,
};

export default function handler(req, res) {
  const rawPath = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const authHandler = AUTH_HANDLERS[rawPath];
  if (authHandler) return authHandler(req, res);
  if (rawPath === 'private/market-data/tradingview') return tradingviewApi(req, res);
  if (rawPath === 'private/market-data/daily-snapshots') return dailySnapshots(req, res);
  return proxyToBackend(req, res, rawPath);
}
