import { beforeEach, expect, it, vi } from 'vitest';
import router from '../api/llm/[endpoint].js';
import sessionHandler from '../api/auth/_session.js';
import { createSession } from '../api/_lib/auth.js';
import { chat } from '../api/_lib/deepseek.js';
vi.mock('../api/_lib/deepseek.js', async original => ({ ...await original(), chat: vi.fn() }));
const response = () => ({ statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.QUANTEDGE_ALLOWED_HOSTS = 'quantedge.example.com';
  process.env.QUANTEDGE_SESSION_SECRET = 'test-score-session-secret-at-least-32-characters';
});
it.each([false, true])('uses real session/CSRF middleware before invalid-score rejection (csrf=%s)', async withCsrf => {
  const { token } = createSession();
  const headers = { host: 'quantedge.example.com', origin: 'https://quantedge.example.com', cookie: `__Host-qe_session=${token}` };
  const session = response();
  sessionHandler({ method: 'GET', headers }, session);
  expect(session.statusCode).toBe(200);
  const res = response();
  await router({ method: 'POST', query: { endpoint: 'explain-score' },
    headers: { ...headers, ...(withCsrf ? { 'x-csrf-token': session.body.data.csrf_token } : {}) },
    body: { ticker: 'SMOKE', assetType: 'crypto', score: null } }, res);
  expect(res.statusCode).toBe(withCsrf ? 400 : 403);
  if (withCsrf) expect(res.body.code).toBe('invalid_score_contract');
  else expect(res.body.error.code).toBe('csrf_invalid');
  expect(chat).not.toHaveBeenCalled();
});
