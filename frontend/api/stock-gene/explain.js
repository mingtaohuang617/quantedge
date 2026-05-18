// AI 解读 — Vercel 上需 DEEPSEEK_API_KEY 才能用，否则 503
import { requireReferer, readJson } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  // 暂未在 Vercel 端实现（需要 DeepSeek 调用 + 缓存），返回友好提示
  return res.status(503).json({
    ok: false,
    error: 'ai_explain_not_available_on_vercel_yet',
    detail: 'AI 解读暂未移植到 Vercel — 请使用 self-hosted backend。',
  });
}
