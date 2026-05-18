// scheduler enable/disable — Vercel 无后台线程，永远 503
import { requireReferer } from '../../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  return res.status(503).json({
    ok: false,
    error: 'scheduler_not_available_on_serverless',
    detail: 'Vercel serverless 无长驻进程，定时刷新需 self-hosted backend。',
  });
}
