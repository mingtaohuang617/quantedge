import { beforeEach, describe, expect, it } from 'vitest';
import handler from './[...path].js';

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

function request(path, overrides = {}) {
  return {
    method: 'GET',
    query: { path: path.split('/') },
    headers: {
      host: 'quantedge.example.com',
      origin: 'https://quantedge.example.com',
      'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
    },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.QUANTEDGE_ALLOWED_HOSTS = 'quantedge.example.com';
  process.env.QUANTEDGE_INVITE_CODE = 'MintoQuant';
  process.env.QUANTEDGE_SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
});

describe('single BFF dispatcher auth routes', () => {
  it('serves the session endpoint without proxying to Render', async () => {
    const res = response();
    await handler(request('auth/session'), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('authentication_required');
  });

  it('serves invite login and issues the secure session cookie', async () => {
    const res = response();
    await handler(request('auth/invite', { method: 'POST', body: { code: 'MintoQuant' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('Secure');
    expect(res.body.data.user.workspace_id).toBe('private-default');
  });

  it('serves logout locally and enforces the session boundary', async () => {
    const res = response();
    await handler(request('auth/logout', { method: 'POST' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('authentication_required');
  });
});
