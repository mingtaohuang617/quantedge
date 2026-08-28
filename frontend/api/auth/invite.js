import crypto from 'node:crypto';
import {
  clientIp,
  consumeRateLimit,
  createSession,
  readJson,
  requireOrigin,
  resetRateLimit,
  safeEqual,
  sendError,
  sessionCookie,
} from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }
  if (!requireOrigin(req, res)) return;

  const ip = clientIp(req);
  const rate = consumeRateLimit(`invite:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return sendError(res, 429, 'rate_limited', 'Too many failed invite attempts');
  }

  const inviteCode = process.env.QUANTEDGE_INVITE_CODE || '';
  if (!inviteCode) return sendError(res, 503, 'invite_not_configured', 'Invite authentication is not configured');

  let body;
  try {
    body = await readJson(req, { maxBytes: 4096 });
  } catch (error) {
    return sendError(res, error.statusCode || 400, 'invalid_request', error.message);
  }
  const submitted = typeof body.code === 'string' ? body.code.trim() : '';
  if (!submitted || !safeEqual(submitted, inviteCode)) {
    return sendError(res, 401, 'invite_invalid', 'Invite code is invalid');
  }
  resetRateLimit(`invite:${ip}`);

  let created;
  try {
    created = createSession();
  } catch (error) {
    return sendError(res, 503, 'session_not_configured', error.message);
  }
  res.setHeader('Set-Cookie', sessionCookie(created.token));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    data: {
      user: {
        id: created.payload.sub,
        name: created.payload.name,
        plan: created.payload.plan,
        workspace_id: created.payload.workspace_id,
        joinedAt: new Date(created.payload.iat * 1000).toISOString(),
      },
      csrf_token: created.payload.csrf,
      expires_at: new Date(created.payload.exp * 1000).toISOString(),
    },
    meta: {
      as_of: new Date().toISOString(),
      source: 'quantedge-auth',
      cache_status: 'bypass',
      stale: false,
      quality: 'verified',
      schema_version: '1.0',
      request_id: crypto.randomUUID(),
    },
  });
}
