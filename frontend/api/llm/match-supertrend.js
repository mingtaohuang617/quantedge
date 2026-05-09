// /api/llm/match-supertrend  —  让 LLM 判断"这只股属于哪些超级赛道"
//
// 用途：sector_mapping 关键词未命中时的兜底（例如富途/yfinance 板块名不对齐）
// 输入: { ticker, name?, sector?, industry?, summary?, candidate_ids? }
// 输出: { matched: [supertrend_ids...], reason, confidence }

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const ENDPOINT = 'match-supertrend';
const TTL_SEC = 7 * 86400;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = await readJson(req);
  const { ticker, name, sector, industry, summary, candidate_ids } = body;
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  const allTrends = await listAllSupertrends();
  const candidates = Array.isArray(candidate_ids) && candidate_ids.length
    ? allTrends.filter(s => candidate_ids.includes(s.id))
    : allTrends;
  if (candidates.length === 0) {
    return res.status(400).json({ ok: false, error: 'no candidate supertrends' });
  }

  const candidateLines = candidates
    .map(s => `- ${s.id}: ${s.name}（${s.note || ''}）`)
    .join('\n');

  const prompt = [
    '你是产业研究助手。根据以下标的的行业、业务描述，从候选超级赛道里挑出它实际属于哪些（可多选，可一个都不选）。',
    '',
    `标的: ${ticker} (${name || '?'})`,
    `行业: ${sector || '未知'} / ${industry || '未知'}`,
    summary ? `业务描述: ${String(summary).slice(0, 300)}` : '业务描述: （未提供）',
    '',
    '候选赛道：',
    candidateLines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "matched": ["<supertrend_id_1>", "<supertrend_id_2>"],',
    '  "reason": "<≤80 字 简述判断依据>",',
    '  "confidence": <0-1 浮点 — 整体判断置信度>',
    '}',
    '若信息不足，matched 输出 []，confidence 给 0.3 以下。',
  ].join('\n');

  const cached = await llmCacheGet(ENDPOINT, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ticker, ...cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 300, temperature: 0.2 }
    );
    const parsed = safeJsonParse(content);
    if (!Array.isArray(parsed.matched)) parsed.matched = [];
    parsed.matched = parsed.matched.filter(id => candidates.some(c => c.id === id));
    parsed.reason = String(parsed.reason || '').slice(0, 200);
    const conf = Number(parsed.confidence);
    parsed.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;

    await llmCachePut(ENDPOINT, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      ticker, prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ticker, ...parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
