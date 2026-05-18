// /api/stock-gene/lists/[id] — PUT (rename/color) / DELETE
import { requireReferer, readJson } from '../../_lib/auth.js';
import { KV_ENABLED } from '../../_lib/kv.js';
import { updateList, deleteList } from '../../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (!KV_ENABLED) return res.status(503).json({ ok: false, detail: 'KV 未配置' });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'missing list id' });

  if (req.method === 'PUT') {
    const body = await readJson(req);
    const out = await updateList(id, body);
    if (!out) return res.status(404).json({ ok: false, detail: `list 不存在: ${id}` });
    return res.status(200).json({ ok: true, list: out });
  }

  if (req.method === 'DELETE') {
    try {
      const moved = await deleteList(id);
      return res.status(200).json({ ok: true, items_moved: moved });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).json({ error: 'method not allowed' });
}
