// /api/watchlist/10x/export — GET 完整导出 watchlist
//
// 返回 JSON：{ version, exported_at, user_supertrends, items }
// 用户可以保存为 .json 文件做备份；导入端在 /api/watchlist/10x/import。

import { requireReferer } from '../../_lib/auth.js';
import { exportData } from '../../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const data = await exportData();
  return res.status(200).json(data);
}
