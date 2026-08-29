const baseUrl = String(process.argv[2] || process.env.QUANTEDGE_PRODUCTION_URL || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('Production URL is required');

const checks = [
  { path: '/', statuses: [200] },
  { path: '/sw.js', statuses: [200] },
  { path: '/api/auth/session', statuses: [401, 403] },
  { path: '/api/yahoo?path=%2Fv8%2Ffinance%2Fchart%2FSPY', statuses: [401, 403] },
  { path: '/api/mining-alpha/status', statuses: [401, 403] },
];

for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, {
    redirect: 'follow',
    headers: { 'User-Agent': 'QuantEdge-CI-Smoke/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  console.log(`${check.path} -> ${response.status}`);
  if (!check.statuses.includes(response.status) || response.status >= 500) {
    throw new Error(`${check.path} returned unexpected status ${response.status}`);
  }
}
