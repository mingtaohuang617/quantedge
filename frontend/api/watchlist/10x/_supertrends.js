// /api/watchlist/10x/supertrends  —  GET (list) / POST (add user-defined)
import { requireReferer, readJson } from '../../_lib/auth.js';
import { KV_ENABLED } from '../../_lib/kv.js';
import { listAllSupertrends, addSupertrend } from '../../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const strategy = req.query?.strategy;   // "growth" | "value" | undefined（全部）
    let sts = await listAllSupertrends();
    if (strategy === 'growth' || strategy === 'value') {
      sts = sts.filter(s => (s.strategy || 'growth') === strategy);
    }
    return res.status(200).json(sts);
  }

  if (req.method === 'POST') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：在 Vercel Settings → Storage 启用',
      });
    }
    const body = await readJson(req);
    try {
      const item = await addSupertrend(
        body.id, body.name, body.note,
        body.keywords_zh, body.keywords_en,
        body.strategy || 'growth',
      );
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
