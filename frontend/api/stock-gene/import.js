// /api/stock-gene/import — JSON 导入 (merge / replace)
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { importData } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!KV_ENABLED) return res.status(503).json({ ok: false, detail: 'KV 未配置' });
  const body = await readJson(req);
  try {
    const stats = await importData(
      { items: body.items, lists: body.lists, version: body.version },
      body.mode || 'merge',
    );
    return res.status(200).json(stats);
  } catch (e) {
    return res.status(400).json({ ok: false, detail: String(e.message || e) });
  }
}
