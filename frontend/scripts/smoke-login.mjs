export async function loginForSmoke(base, code, fetcher = fetch) {
  if (base.origin !== 'https://quantedge-chi.vercel.app') throw new Error('Production login host not allowed');
  if (!code || code === '[SENSITIVE]') throw new Error('Smoke invite credential unavailable');
  let response;
  try {
    response = await fetcher(new URL('/api/auth/invite', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { origin: base.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch { throw new Error('Smoke login transport failed'); }
  if (response.status !== 200) throw new Error('Smoke login rejected: HTTP ' + response.status);
  const cookies = response.headers.getSetCookie();
  const session = cookies.find(value => value.startsWith('__Host-qe_session='));
  if (!session || !/;\s*Secure/i.test(session) || !/;\s*HttpOnly/i.test(session)) throw new Error('Secure smoke session missing');
  return session.split(';')[0];
}
