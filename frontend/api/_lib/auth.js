import crypto from 'node:crypto';

export const SESSION_COOKIE = '__Host-qe_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MAX_JSON_BODY_BYTES = 256 * 1024;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RATE_BUCKETS = globalThis.__qeRateBuckets || new Map();
globalThis.__qeRateBuckets = RATE_BUCKETS;

function configuredOrigins() {
  const values = [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    ...(process.env.QUANTEDGE_ALLOWED_HOSTS || '').split(','),
  ].map(value => value?.trim()).filter(Boolean);

  const origins = new Set(['http://localhost:5173', 'http://localhost:4173']);
  for (const value of values) {
    try {
      origins.add(new URL(value.includes('://') ? value : `https://${value}`).origin);
    } catch {
      // Invalid deployment configuration is ignored rather than widening access.
    }
  }
  return origins;
}

function requestOrigin(req) {
  const value = req.headers.origin || req.headers.referer;
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

export function isAllowedOrigin(req) {
  const origin = requestOrigin(req);
  return !!origin && configuredOrigins().has(origin);
}

export function parseCookies(req) {
  const result = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index <= 0) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

function sessionSecret() {
  return process.env.QUANTEDGE_SESSION_SECRET || '';
}

function sign(value, secret = sessionSecret()) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(overrides = {}) {
  const secret = sessionSecret();
  if (secret.length < 32) throw new Error('QUANTEDGE_SESSION_SECRET must be at least 32 characters');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: 'private-investor',
    workspace_id: 'private-default',
    name: 'Investor',
    plan: 'pro',
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    sid: crypto.randomUUID(),
    csrf: crypto.randomBytes(24).toString('base64url'),
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${sign(encoded, secret)}`, payload };
}

export function verifySessionToken(token, now = Math.floor(Date.now() / 1000)) {
  const secret = sessionSecret();
  if (!token || secret.length < 32) return null;
  const [encoded, signature, extra] = String(token).split('.');
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.v !== 1 || payload.sub !== 'private-investor') return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.iat > now + 30 || payload.exp <= now || payload.exp - payload.iat > SESSION_TTL_SECONDS) return null;
    if (!payload.sid || !payload.csrf || payload.workspace_id !== 'private-default') return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSession(req) {
  return verifySessionToken(parseCookies(req)[SESSION_COOKIE]);
}

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

export function sendError(res, status, code, message, details = undefined, requestId = undefined) {
  const id = requestId || crypto.randomUUID();
  return res.status(status).json({
    error: { code, message, ...(details === undefined ? {} : { details }), request_id: id },
    meta: { schema_version: '1.0', request_id: id },
  });
}

export function requireOrigin(req, res) {
  if (!isAllowedOrigin(req)) {
    sendError(res, 403, 'origin_forbidden', 'Request origin is not allowed');
    return false;
  }
  return true;
}

export function requireSession(req, res, { csrf = !SAFE_METHODS.has(String(req.method || 'GET').toUpperCase()) } = {}) {
  const session = getSession(req);
  if (!session) {
    sendError(res, 401, 'authentication_required', 'A valid QuantEdge session is required');
    return null;
  }
  if (csrf && !safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) {
    sendError(res, 403, 'csrf_invalid', 'CSRF token is missing or invalid');
    return null;
  }
  return session;
}

/** Backward-compatible guard used by all existing Vercel handlers. */
export function requireReferer(req, res) {
  if (!requireOrigin(req, res)) return false;
  const session = requireSession(req, res);
  if (!session) return false;
  req.quantedgeSession = session;
  return true;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

export function consumeRateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const current = RATE_BUCKETS.get(key);
  if (!current || current.resetAt <= now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  current.count += 1;
  const allowed = current.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - current.count),
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function resetRateLimit(key) {
  RATE_BUCKETS.delete(key);
}

export function enforceRateLimit(req, res, scope, options) {
  const session = req.quantedgeSession || getSession(req);
  const subject = session?.sid || clientIp(req);
  const result = consumeRateLimit(`${scope}:${subject}`, options);
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
    sendError(res, 429, 'rate_limited', 'Too many requests');
    return false;
  }
  return true;
}

/** Parse a JSON body with a hard byte limit. */
export async function readJson(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error('request body too large');
    error.statusCode = 413;
    throw error;
  }
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxBytes) {
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export const isAllowedReferer = isAllowedOrigin;
