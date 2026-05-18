// /api/stock-gene/scheduler/status — Vercel 没有长驻进程，调度器始终禁用
import { requireReferer } from '../../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  // 返回禁用状态，前端按这个 enabled=false 渲染
  return res.status(200).json({
    enabled: false,
    schedule: { hour_utc: 6, minute_utc: 0 },
    last_run_at: null,
    last_summary: null,
    next_run_at: null,
    manual_run_at: null,
    serverless: true,   // 提示前端：当前是 serverless 部署，调度器不可用
  });
}
