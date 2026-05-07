// /api/watchlist/10x/{ticker}  —  PUT (edit) / DELETE
//
// vercel dynamic route：req.query.ticker 自动解析自 URL path
import { requireReferer, readJson } from '../../_lib/auth.js';
import { KV_ENABLED } from '../../_lib/kv.js';
import { updateItem, removeItem } from '../../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  const ticker = String(req.query.ticker || '').trim();
  if (!ticker) {
    return res.status(400).json({ ok: false, detail: 'ticker 不能为空' });
  }

  if (!KV_ENABLED) {
    return res.status(503).json({
      ok: false,
      detail: 'KV 未配置：在 Vercel Settings → Storage 启用',
    });
  }

  if (req.method === 'PUT') {
    const body = await readJson(req);
    // 仅取非 null 字段（与 backend Pydantic 的 exclude_unset 行为一致）
    const fields = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v != null)
    );
    try {
      const item = await updateItem(ticker, fields);
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      if (e.code === 'NOT_FOUND') {
        return res.status(404).json({ ok: false, detail: `${ticker} not in watchlist` });
      }
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  if (req.method === 'DELETE') {
    const ok = await removeItem(ticker);
    if (ok) return res.status(200).json({ ok: true, ticker: ticker.toUpperCase() });
    return res.status(404).json({ ok: false, detail: `${ticker} not in watchlist` });
  }

  res.setHeader('Allow', 'PUT, DELETE');
  return res.status(405).json({ error: 'method not allowed' });
}
