// /api/llm/generate-keywords  —  根据赛道名 + 注释，生成 sector_mapping 关键词列表
//
// 用途：用户加新自定义赛道时，让 LLM 起草 keywords_zh / keywords_en，免去手填
// 输入: { name, note? }
// 输出: { keywords_zh: [...], keywords_en: [...], reason }

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';

const ENDPOINT = 'generate-keywords';
const TTL_SEC = 7 * 86400;
const MAX_KEYWORDS = 25;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const note = String(body.note || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });

  const prompt = [
    "你是产业研究助手。给定一个 '超级赛道' 名称和注释，请生成用于行业字符串匹配的关键词列表（中英文都要）。",
    '',
    `赛道名: ${name}`,
    `注释: ${note || '（无）'}`,
    '',
    '要求：',
    '- 中文关键词：用中国 A 股研报常见行业词，如"光伏"、"储能"、"半导体"、"新型电力"。一些大类（如"通讯设备"）会带噪音，谨慎放入',
    '- 英文关键词：用 yfinance / GICS 行业分类常见英文词，如 "Solar"、"Battery"、"Semiconductors"、"Communication Equipment"',
    `- 各语言不超过 ${MAX_KEYWORDS} 个；越精准的关键词越好，避免过于宽泛的词`,
    '',
    '请严格输出 JSON：',
    '{',
    '  "keywords_zh": ["<>", ...],',
    '  "keywords_en": ["<>", ...],',
    '  "reason": "<≤80 字 解释你为什么选这些>"',
    '}',
  ].join('\n');

  const cached = await llmCacheGet(ENDPOINT, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ...cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 600, temperature: 0.3 }
    );
    const parsed = safeJsonParse(content);
    parsed.keywords_zh = (Array.isArray(parsed.keywords_zh) ? parsed.keywords_zh : [])
      .map(k => String(k).trim()).filter(Boolean).slice(0, MAX_KEYWORDS);
    parsed.keywords_en = (Array.isArray(parsed.keywords_en) ? parsed.keywords_en : [])
      .map(k => String(k).trim()).filter(Boolean).slice(0, MAX_KEYWORDS);
    parsed.reason = String(parsed.reason || '').slice(0, 200);

    await llmCachePut(ENDPOINT, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ...parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
