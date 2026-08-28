import crypto from 'node:crypto';
import { enforceRateLimit, MAX_JSON_BODY_BYTES, requireReferer, sendError } from './auth.js';

const ACTIVE = globalThis.__qeActiveRequests || new Map();
globalThis.__qeActiveRequests = ACTIVE;

const ALLOWED_ROOTS = new Set([
  'search', 'tickers', 'data', 'refresh', 'sync', 'db', 'intraday', 'smart-beta',
  'llm', 'transactions', 'positions', 'status', 'macro', 'universe', 'watchlist',
  'anomaly', 'mining-alpha', 'stock-gene',
]);

function requestId(req) {
  const supplied = String(req.headers['x-request-id'] || '');
  return /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function normalizeBackendPath(value) {
  const raw = Array.isArray(value) ? value.join('/') : String(value || '');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized || normalized.includes('\\') || normalized.split('/').some(part => !part || part === '.' || part === '..')) return null;
  if (!ALLOWED_ROOTS.has(normalized.split('/')[0])) return null;
  return normalized;
}

function policyFor(path) {
  if (path.startsWith('llm/')) return { scope: 'llm', limit: 30, windowMs: 60 * 60 * 1000, concurrency: 2 };
  if (path.startsWith('mining-alpha/run/')) return { scope: 'mining-run', limit: 12, windowMs: 24 * 60 * 60 * 1000, concurrency: 1 };
  if (path === 'smart-beta/backtest') return { scope: 'backtest', limit: 12, windowMs: 60 * 60 * 1000, concurrency: 1 };
  if (path.startsWith('stock-gene/scheduler/')) return { scope: 'scheduler', limit: 20, windowMs: 60 * 60 * 1000, concurrency: 1 };
  if (path === 'refresh' || path === 'sync') return { scope: 'refresh', limit: 8, windowMs: 60 * 60 * 1000, concurrency: 1 };
  return { scope: 'api', limit: 240, windowMs: 60 * 1000, concurrency: 8 };
}

function acquire(scope, limit) {
  const active = ACTIVE.get(scope) || 0;
  if (active >= limit) return false;
  ACTIVE.set(scope, active + 1);
  return true;
}

function release(scope) {
  const active = ACTIVE.get(scope) || 0;
  if (active <= 1) ACTIVE.delete(scope);
  else ACTIVE.set(scope, active - 1);
}

function bodyText(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  if (typeof req.body === 'string') return req.body;
  if (req.body == null) return '';
  return JSON.stringify(req.body);
}

function signHeaders({ secret, method, pathWithQuery, body, id }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = `${timestamp}\n${id}\n${method}\n${pathWithQuery}\n${bodyHash}`;
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
  return {
    'X-QuantEdge-Timestamp': timestamp,
    'X-QuantEdge-Request-Id': id,
    'X-QuantEdge-Body-SHA256': bodyHash,
    'X-QuantEdge-Signature': signature,
  };
}

function responseMeta(upstream, data, id) {
  const stale = upstream.headers.get('x-data-stale') === 'true';
  return {
    as_of: data?.as_of || data?.updated_at || upstream.headers.get('date') || new Date().toISOString(),
    source: upstream.headers.get('x-data-source') || 'quantedge-render',
    cache_status: (upstream.headers.get('x-cache-status') || 'bypass').toLowerCase(),
    stale,
    quality: stale ? 'stale' : 'validated',
    schema_version: '1.0',
    request_id: id,
  };
}

export async function proxyToBackend(req, res, rawPath, { timeoutMs = 55_000 } = {}) {
  if (!requireReferer(req, res)) return;
  const path = normalizeBackendPath(rawPath);
  const id = requestId(req);
  res.setHeader('X-Request-Id', id);
  if (!path) return sendError(res, 400, 'invalid_backend_path', 'Backend path is not allowed', undefined, id);

  const backendUrl = process.env.QUANTEDGE_BACKEND_URL;
  const secret = process.env.QUANTEDGE_BFF_SECRET || '';
  if (!backendUrl || secret.length < 32) {
    return sendError(res, 503, 'backend_not_configured', 'Secure backend proxy is not configured', undefined, id);
  }

  const policy = policyFor(path);
  if (!enforceRateLimit(req, res, policy.scope, policy)) return;
  if (!acquire(policy.scope, policy.concurrency)) {
    res.setHeader('Retry-After', '2');
    return sendError(res, 429, 'concurrency_limited', 'This operation is already at its concurrency limit', undefined, id);
  }

  try {
    const method = String(req.method || 'GET').toUpperCase();
    const body = bodyText(req);
    if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BODY_BYTES) {
      return sendError(res, 413, 'request_too_large', 'Request body exceeds the allowed size', undefined, id);
    }

    const url = new URL(`/api/${path}`, backendUrl);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === 'path' || value == null || value === '') continue;
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    const pathWithQuery = `${url.pathname}${url.search}`;
    const headers = {
      Accept: 'application/json',
      ...signHeaders({ secret, method, pathWithQuery, body, id }),
    };
    if (body) headers['Content-Type'] = 'application/json';

    const upstream = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await upstream.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* structured error below */ }

    if (!upstream.ok) {
      const message = json?.error?.message || json?.detail || json?.error || `Backend returned HTTP ${upstream.status}`;
      return sendError(res, upstream.status, json?.error?.code || 'backend_error', String(message), json?.error?.details, id);
    }
    if (json == null) return sendError(res, 502, 'invalid_backend_response', 'Backend returned a non-JSON response', undefined, id);
    res.setHeader('Cache-Control', 'private, no-store');
    if (json.data !== undefined && json.meta) {
      return res.status(upstream.status).json({ ...json, meta: { ...json.meta, request_id: id } });
    }
    return res.status(upstream.status).json({ data: json, meta: responseMeta(upstream, json, id) });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendError(res, timeout ? 504 : 502, timeout ? 'backend_timeout' : 'backend_unavailable', timeout ? 'Backend request timed out' : 'Backend request failed', undefined, id);
  } finally {
    release(policy.scope);
  }
}
