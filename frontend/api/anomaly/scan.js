// /api/anomaly/scan  —  GET (读最近一次扫描) / PUT (本地扫描脚本写入整快照)
//
// 关注股异动扫描结果。本地 futu_anomaly_scan.py 工作日 09:00 跑完 PUT 上来，
// 「实时监控」页 GET 展示。PUT 带 Referer 白名单头（本地脚本设成生产域名）。
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadScan, saveScan } from '../_lib/anomalyScan.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const data = await loadScan();
    return res.status(200).json({ ...data, kv: KV_ENABLED });
  }

  if (req.method === 'PUT') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：在 Vercel Settings → Storage → Create Database 启用 KV 后重试',
      });
    }
    const body = await readJson(req);
    try {
      const data = await saveScan(body);
      return res.status(200).json({ ok: true, ...data });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method not allowed' });
}
