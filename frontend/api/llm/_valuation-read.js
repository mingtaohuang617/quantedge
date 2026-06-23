// /api/llm/valuation-read  —  机构级「估值速读」（本地 handler，DeepSeek 直连 + KV 缓存）
//
// 方法论借鉴 anthropics/financial-services 的 comps + dcf 命令（Apache-2.0）：
//   只借「框架」，不拉外部付费数据 —— 用平台已有的基本面 + 估值倍数，让模型做一份
//   institutional 风格的相对估值速读：
//     倍数 vs 质量/增长（comps）→ 当前价隐含了什么预期（reverse-DCF 直觉）
//     → 多/空估值区间框架 → 关键待核验假设 → 一句话结论（不给买卖建议）
//
// 输出字段「值」按 body.lang（zh-CN / zh-TW / en）语言生成；字段「名」固定中文，前端按 key 读。
// 与已有卡片区分：summary=3 句泛读、value-thesis=10x 价值赛道专用；本卡=任意个股的估值专题。
//
// 缓存：KV，TTL 24h。prompt 内含 lang 指令，故不同语言天然分桶，无需改 cache key。

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, clampInt, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';

const TTL_SEC = 86400;

const LANG_LABEL = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en': 'English' };

function buildPrompt(stock) {
  const ticker = stock.ticker || '?';
  const name = stock.name || '';
  const sector = stock.sector || stock.industry || '';
  const metrics = (stock.metrics || '').slice(0, 400) || '（基本面数据缺失）';
  const lang = LANG_LABEL[stock.lang] || '简体中文';

  return [
    "你是卖方股票研究助手，按机构估值方法论给一份客观的「估值速读」。",
    "方法论（comps + 简化 DCF 框架，只做定性框架、不要编造没给的精确数字）：",
    "1) 相对估值：把给定的 PE/PB 倍数与该公司的 ROE / 利润率 / 增长对照 —— 倍数是否与质量/增长匹配，相对行业是溢价还是折价。",
    "2) 市场定价（reverse-DCF 直觉）：当前倍数隐含了市场对未来增长 / 利润率 / 资本回报的什么预期？这种预期偏乐观还是偏保守？",
    "3) 多空区间：给一个粗略的估值框架 —— 乐观情形（增长/利润率兑现）与保守情形（不及预期）下，估值大致会怎么移动。用倍数语言，不要伪造目标价。",
    "4) 待核验：要让这份判断成立，最需要去核实的 2 个假设 / 数据点。",
    "",
    `标的: ${ticker}${name ? `（${name}）` : ''}`,
    `行业/分类: ${sector || '未知'}`,
    `基本面: ${metrics}`,
    "",
    `请严格输出 JSON；所有字段的【值】用 ${lang} 书写（字段名保持中文 key 不变）：`,
    '{',
    '  "估值定位": "<一句话：相对其质量/增长，当前估值偏低 / 合理 / 偏高，给核心理由，≤45 字>",',
    '  "倍数解读": "<PE/PB 与 ROE/利润率/增长是否匹配、相对行业溢价或折价，≤70 字>",',
    '  "市场定价": "<reverse-DCF 直觉：当前价隐含了什么增长/利润率预期，偏乐观还是保守，≤70 字>",',
    '  "多空区间": "<乐观 vs 保守情形下估值大致如何移动，用倍数语言，不要伪造目标价，≤70 字>",',
    '  "待核验": "<最该核实的 2 个假设/数据点，≤50 字>",',
    '  "结论": "<一句话结论，不给买卖建议，≤40 字>",',
    '  "估值倾向_int": <1=偏低估，2=合理，3=偏高估；不确定填 2>',
    '}',
    "要求：客观、不夸张；数据缺失就明说不确定，不要编造精确数字；绝不给出买入/卖出/持有建议。",
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
  if (!ticker) {
    return res.status(400).json({ ok: false, error: 'ticker required' });
  }

  const prompt = buildPrompt(body);
  const cached = await llmCacheGet('valuation-read', DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ticker, read: cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 700, temperature: 0.3 }
    );
    const parsed = safeJsonParse(content);
    for (const k of ['估值定位', '倍数解读', '市场定价', '多空区间', '待核验', '结论']) {
      if (!(k in parsed)) parsed[k] = '';
    }
    parsed['估值倾向_int'] = clampInt(parsed['估值倾向_int'], 1, 3, 2);

    await llmCachePut('valuation-read', DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      ticker, prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ticker, read: parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
