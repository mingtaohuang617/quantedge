import { readFile } from 'node:fs/promises';
import { requireOrigin, requireSession, sendError } from './auth.js';

// Private release snapshot: never put provider data or favorites in public/ assets.
export async function readDailySnapshot() {
  return JSON.parse(await readFile(new URL('./daily-data/snapshot.json', import.meta.url), 'utf8'));
}

export default async function dailySnapshots(req, res, load = readDailySnapshot) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!requireOrigin(req, res) || !requireSession(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed', 'Only GET is supported');
  }
  try {
    const data = await load();
    if (data?.timeframe !== '1D' || !Array.isArray(data.rows)) throw new Error('invalid_snapshot');
    return res.status(200).json({ data, meta: { schema_version: '1.0', source: 'tradingview', available_at: data.generated_at } });
  } catch {
    return sendError(res, 503, 'daily_snapshot_unavailable', '日线快照尚未就绪，可逐只更新');
  }
}
