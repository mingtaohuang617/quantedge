// /api/stock-gene/[ticker]  —  PUT (update metadata) / DELETE
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { updateItem, removeItem } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (!KV_ENABLED) {
    return res.status(503).json({ ok: false, detail: 'KV 未配置' });
  }

  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'missing ticker' });

  if (req.method === 'PUT') {
    const body = await readJson(req);
    try {
      const item = await updateItem(ticker, body);
      if (!item) return res.status(404).json({ ok: false, detail: `${ticker} 不在观察列表中` });
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  if (req.method === 'DELETE') {
    const ok = await removeItem(ticker);
    if (!ok) return res.status(404).json({ ok: false, detail: `${ticker} 不在观察列表中` });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).json({ error: 'method not allowed' });
}
