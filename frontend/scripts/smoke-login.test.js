import { expect, it, vi } from 'vitest';
import { loginForSmoke } from './smoke-login.mjs';
const base = new URL('https://quantedge-chi.vercel.app');
it('logs in normally without reading a signing secret', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'set-cookie': '__Host-qe_session=test; Path=/; Secure; HttpOnly' } }));
  expect(await loginForSmoke(base, 'test-invite', fetcher)).toBe('__Host-qe_session=test');
  expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  expect(fetcher.mock.calls[0][1].body).toBe(JSON.stringify({code:'test-invite'}));
});
it('does not send credentials to another host or accept placeholders', async () => {
  const fetcher = vi.fn();
  await expect(loginForSmoke(new URL('https://other.vercel.app'), 'test', fetcher)).rejects.toThrow('host');
  await expect(loginForSmoke(base, '[SENSITIVE]', fetcher)).rejects.toThrow('unavailable');
  expect(fetcher).not.toHaveBeenCalled();
});
it('sanitizes failures and requires a secure HttpOnly cookie', async () => {
  await expect(loginForSmoke(base, 'test', async()=>{throw Error('sensitive details');})).rejects.toThrow('transport failed');
  await expect(loginForSmoke(base, 'test', async()=>new Response('',{status:401}))).rejects.toThrow('HTTP 401');
  await expect(loginForSmoke(base, 'test', async()=>new Response('',{headers:{'set-cookie':'__Host-qe_session=x'}}))).rejects.toThrow('missing');
});
