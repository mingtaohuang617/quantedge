import { proxyToBackend } from './_lib/backendProxy.js';
import inviteHandler from './auth/_invite.js';
import logoutHandler from './auth/_logout.js';
import sessionHandler from './auth/_session.js';

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
  return proxyToBackend(req, res, rawPath);
}
