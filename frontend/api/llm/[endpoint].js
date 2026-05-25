// /api/llm/[endpoint]  —  v0.8 单点路由
//
// 路由顺序：
//   1) endpoint 命中本地 KNOWN_HANDLERS → 在 Vercel 内运行（DeepSeek 直连 + KV 缓存）
//   2) 兜底反向代理到 Render 后端 FastAPI /api/llm/{endpoint}
//
// 本地 handler（不走代理，独立 lambda 上限不变）：
//   - generate-keywords / match-supertrend / rank-candidates / 10x-thesis
//   handler 文件 _*.js 同目录，Vercel 自动忽略不当 function
//
// 代理（后端已实现，本地无 handler 的）：
//   summary / backtest-narrate / journal-structure / explain-score / monthly-review /
//   parse-strategy / value-thesis / health / stats
//
// 设计选择回顾：原本 4 个独立 lambda + 1 catch-all proxy（合计 5）。v0.8 整合到 1 个
// 文件（这个）+ 4 个 _*.js handler（被 import 不当 function），共 1 个 lambda。
//
// 不覆盖（不在 /api/llm/* 路径下）：
//   - /api/macro/narrative       — 宏观画像
//   - /api/stock-gene/explain    — Stock Gene 解读
//
// 环境变量（仅 proxy 路径需要）：
//   QUANTEDGE_BACKEND_URL  Render 后端 URL，如 https://quantedge-xxx.onrender.com

import { requireReferer } from '../_lib/auth.js';
import generateKeywords from './_generate-keywords.js';
import matchSupertrend from './_match-supertrend.js';
import rankCandidates from './_rank-candidates.js';
import tenXThesis from './_10x-thesis.js';

const KNOWN_HANDLERS = {
  'generate-keywords': generateKeywords,
  'match-supertrend': matchSupertrend,
  'rank-candidates': rankCandidates,
  '10x-thesis': tenXThesis,
};

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

  // 1) 本地 handler 优先：generate-keywords / match-supertrend / rank-candidates / 10x-thesis
  const localFn = KNOWN_HANDLERS[endpoint];
  if (localFn) return localFn(req, res);

  // 2) 兜底反向代理 — 后端 /api/llm/{endpoint}
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
