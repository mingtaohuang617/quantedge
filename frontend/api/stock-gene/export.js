// /api/stock-gene/export — JSON 导出
import { requireReferer } from '../_lib/auth.js';
import { exportData } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const payload = await exportData();
  return res.status(200).json(payload);
}
