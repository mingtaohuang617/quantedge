import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSession,
  getSession,
  isAllowedOrigin,
  requireSession,
  verifySessionToken,
} from './auth.js';

const SECRET = 'test-session-secret-with-at-least-32-characters';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

beforeEach(() => {
  process.env.QUANTEDGE_SESSION_SECRET = SECRET;
  process.env.QUANTEDGE_ALLOWED_HOSTS = 'quantedge.example.com';
});

describe('origin boundary', () => {
  it('accepts an exact configured HTTPS origin', () => {
    expect(isAllowedOrigin({ headers: { origin: 'https://quantedge.example.com' } })).toBe(true);
  });

  it('rejects forged subdomains and protocol changes', () => {
    expect(isAllowedOrigin({ headers: { origin: 'https://quantedge.example.com.attacker.test' } })).toBe(false);
    expect(isAllowedOrigin({ headers: { origin: 'http://quantedge.example.com' } })).toBe(false);
  });
});

describe('signed session', () => {
  it('round-trips a valid session without exposing its secret', () => {
    const { token, payload } = createSession();
    expect(verifySessionToken(token)).toMatchObject({ sid: payload.sid, workspace_id: 'private-default' });
    expect(token).not.toContain(SECRET);
  });

  it('rejects tampering and expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    const { token } = createSession({ iat: now - 10, exp: now - 1 });
    expect(verifySessionToken(token, now)).toBeNull();
    expect(verifySessionToken(`${token}x`, now)).toBeNull();
  });

  it('requires CSRF for a mutation', () => {
    const { token, payload } = createSession();
    const base = { method: 'POST', headers: { cookie: `__Host-qe_session=${token}` } };
    const denied = response();
    expect(requireSession(base, denied)).toBeNull();
    expect(denied.statusCode).toBe(403);

    const allowedReq = { ...base, headers: { ...base.headers, 'x-csrf-token': payload.csrf } };
    expect(requireSession(allowedReq, response())).toMatchObject({ sid: payload.sid });
    expect(getSession(allowedReq)).toMatchObject({ sid: payload.sid });
  });
});
