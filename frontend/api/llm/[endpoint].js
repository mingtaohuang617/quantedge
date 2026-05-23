// /api/llm/[endpoint]  —  通用反向代理 → Render 后端 FastAPI 的 /api/llm/*
//
// 解决问题：backend/llm.py 有 11 个高阶 LLM 函数（server.py 暴露 12 个 endpoint），
// 但 frontend/api/llm/ 里只有 4 个独立 lambda（10x-thesis / generate-keywords /
// match-supertrend / rank-candidates）。其余 8 个在 production 调不通。
//
// 设计选择：catch-all 反向代理而不是再写 8 个独立 lambda。原因：
//   1) Vercel Hobby plan 12 lambda 上限；现在 4 个，再加 8 个就挤满；
//   2) 后端 prompt 修改可立即生效，避免前后端 prompt 双份维护；
//   3) 复用后端的 30 分钟 LLM cache（db.llm_cache_*）。
//
// 已有独立 lambda 不受影响（Vercel 静态路由优先于动态路由）：
//   - /api/llm/10x-thesis        → frontend/api/llm/10x-thesis.js
//   - /api/llm/generate-keywords → frontend/api/llm/generate-keywords.js
//   - /api/llm/match-supertrend  → frontend/api/llm/match-supertrend.js
//   - /api/llm/rank-candidates   → frontend/api/llm/rank-candidates.js
//
// 经过本 proxy（后端已实现，前端原本调不通的）：
//   - /api/llm/summary           — 个股摘要
//   - /api/llm/backtest-narrate  — 回测 AI 解读
//   - /api/llm/journal-structure — 一句话日志 → 结构化
//   - /api/llm/explain-score     — 评分解读
//   - /api/llm/monthly-review    — 月度复盘
//   - /api/llm/parse-strategy    — NL 策略 → portfolio
//   - /api/llm/value-thesis      — 价值型 thesis（不通过 10x-thesis 路由的旧调用）
//   - /api/llm/health            — DeepSeek 探活
//   - /api/llm/stats             — token 用量
//
// 不覆盖（不在 /api/llm/* 路径下，需独立 proxy/lambda）：
//   - /api/macro/narrative       — 宏观画像
//   - /api/stock-gene/explain    — Stock Gene 解读
//
// 环境变量（必填）：
//   QUANTEDGE_BACKEND_URL  Render 后端 URL，如 https://quantedge-xxx.onrender.com
//   后端 .env 里需配置 DEEPSEEK_API_KEY（Render dashboard → Environment）

import { requireReferer } from '../_lib/auth.js';

export const config = {
  // Hobby plan 上限 60s；Render free tier cold start ~30s + DeepSeek 调用 ~5-10s 可能逼近。
  // 后端命中 30min LLM cache 后秒回。
  maxDuration: 60,
};

const BACKEND_URL = process.env.QUANTEDGE_BACKEND_URL;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (!BACKEND_URL) {
    return res.status(503).json({
      ok: false,
      error: 'QUANTEDGE_BACKEND_URL not configured',
      hint: '在 Vercel dashboard → Settings → Environment Variables 设置 '
          + 'QUANTEDGE_BACKEND_URL = <Render 后端 URL>，然后重新部署。',
    });
  }

  const { endpoint } = req.query;
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ ok: false, error: 'missing endpoint name in path' });
  }

  // 透传到后端 /api/llm/{endpoint}
  let url;
  try {
    url = new URL(`/api/llm/${encodeURIComponent(endpoint)}`, BACKEND_URL);
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'QUANTEDGE_BACKEND_URL is malformed',
      detail: BACKEND_URL,
    });
  }
  // 透传剩余 query 参数（排除动态路由参数本身）
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'endpoint') continue;
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  const init = {
    method: req.method,
    // 留 5s 给响应处理，避免触发 Vercel 60s 硬超时
    signal: AbortSignal.timeout(55000),
    headers: { Accept: 'application/json' },
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(req.body || {});
  }

  try {
    const upstream = await fetch(url.toString(), init);
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (e) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(isTimeout ? 504 : 502).json({
      ok: false,
      error: isTimeout ? 'Backend timeout' : 'Backend proxy failed',
      detail: String(e?.message || e),
      hint: isTimeout
        ? '后端冷启动中（Render free tier 15min sleep 唤醒约 30s）。30s 后重试 — '
        + '首次成功后 30 min 内 LLM cache 命中，会秒回。'
        : `请检查 QUANTEDGE_BACKEND_URL：${BACKEND_URL}`,
    });
  }
}
