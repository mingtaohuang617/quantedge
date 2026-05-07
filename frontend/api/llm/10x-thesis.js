// /api/llm/10x-thesis  —  生成 10x 卡位分析草稿（5 段文字 + 2 个结构化数字）
//
// 移植自 backend/llm.py:tenx_thesis，新增：
//   - 业务描述兜底：当 body 未提供 description/summary 时，serverless 自调
//     /api/yahoo proxy 拉 longBusinessSummary 喂给 LLM（解决 P1 #6）
//
// 缓存：KV，TTL 24h，key 含 prompt 哈希（修改 prompt 即自动失效）

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, clampInt, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const ENDPOINT = '10x-thesis';
const TTL_SEC = 86400;

/** 通过 self-fetch /api/yahoo proxy 拉 longBusinessSummary。失败返回 null，不抛错。 */
async function fetchYahooSummary(ticker) {
  const u = process.env.VERCEL_URL || process.env.QUANTEDGE_PUBLIC_BASE;
  if (!u || !ticker) return null;
  const base = u.startsWith('http') ? u : `https://${u}`;
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
  const proxyUrl = `${base}/api/yahoo?host=query2&path=${encodeURIComponent(path)}`;
  try {
    const r = await fetch(proxyUrl, {
      headers: { Referer: `${base}/` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary || null;
  } catch {
    return null;
  }
}

function fmtMcap(mc) {
  if (mc == null) return '未知';
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`;
  return `${(mc / 1e6).toFixed(0)}M`;
}

function buildPrompt(stock, supertrend) {
  const ticker = stock.ticker || '?';
  const name = stock.name || '';
  const sector = stock.sector || stock.industry || '';
  const desc = (stock.descriptionCN || stock.description || stock.summary || '').slice(0, 300);
  const stName = supertrend.name || supertrend.id;
  const stNote = supertrend.note || '';

  return [
    "你是产业研究助手，按 '成长型十倍股' 策略给出客观分析。",
    "策略框架：超级趋势 → 双层瓶颈（共识层 / 深度认知层）→ 关键卡位公司（小市值 + 不可替代 + 未被完全理解）→ 第一性原理推演（订单概率 / 产能 / 管理层 / 瓶颈依赖度）。",
    "",
    `标的: ${ticker} (${name})`,
    `行业/分类: ${sector}`,
    `市值: ${fmtMcap(stock.marketCap)}`,
    `所属超级趋势: ${stName}（${stNote}）`,
    `业务描述: ${desc || '（缺失）'}`,
    "",
    "请严格输出 JSON，所有字段都要有：",
    '{',
    '  "超级趋势": "<这只票为什么属于这条超级趋势，≤30 字>",',
    '  "瓶颈层": "<判断它卡在共识层(1)还是深度认知层(2)，简述理由，≤40 字>",',
    '  "瓶颈层级_int": <1 或 2，与"瓶颈层"判断对应；不确定时填 2>,',
    '  "卡位逻辑": "<它在产业链什么位置、为什么不可替代，≤60 字>",',
    '  "卡位等级_int": <1-5 整数；3=普通供应链位置，4=有壁垒，5=独家或近垄断；不确定时填 3>,',
    '  "风险": "<最大风险点，≤30 字>",',
    '  "推演结论": "<基于第一性原理的概率性判断，不给买卖建议，≤60 字>"',
    '}',
    "要求：客观、不夸张；不知道就承认不确定，但 _int 字段必须给整数（不确定时给提示中的中位值）。",
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = await readJson(req);
  const ticker = body.ticker;
  const supertrend_id = body.supertrend_id;
  if (!ticker || !supertrend_id) {
    return res.status(400).json({ ok: false, error: 'ticker + supertrend_id required' });
  }

  const sts = await listAllSupertrends();
  const st = sts.find(s => s.id === supertrend_id);
  if (!st) {
    return res.status(400).json({ ok: false, error: `unknown supertrend_id: ${supertrend_id}` });
  }

  // 业务描述兜底
  const stockMeta = { ...body };
  if (!stockMeta.description && !stockMeta.descriptionCN && !stockMeta.summary) {
    const summary = await fetchYahooSummary(ticker);
    if (summary) stockMeta.summary = summary;
  }

  const prompt = buildPrompt(stockMeta, st);

  const cached = await llmCacheGet(ENDPOINT, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ticker, thesis: cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 600, temperature: 0.3 }
    );
    const parsed = safeJsonParse(content);
    for (const k of ['超级趋势', '瓶颈层', '卡位逻辑', '风险', '推演结论']) {
      if (!(k in parsed)) parsed[k] = '';
    }
    parsed['瓶颈层级_int'] = clampInt(parsed['瓶颈层级_int'], 1, 2, 2);
    parsed['卡位等级_int'] = clampInt(parsed['卡位等级_int'], 1, 5, 3);

    await llmCachePut(ENDPOINT, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      ticker, prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ticker, thesis: parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
