// DeepSeek API helper — OpenAI 兼容格式
// 端点：https://api.deepseek.com/v1/chat/completions
// 环境变量：DEEPSEEK_API_KEY（在 Vercel 项目 Settings → Environment Variables 设置）
//
// 模型：
//   deepseek-chat       —— 通用对话，速度快
//   deepseek-reasoner   —— 慢但深度推理（thesis 类适合）

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
export const DEFAULT_MODEL = 'deepseek-chat';

/**
 * 调 DeepSeek chat completion。
 * @param {Array<{role,content}>} messages
 * @param {{model?, temperature?, max_tokens?, json_mode?, timeout?}} opts
 * @returns {Promise<{content: string, prompt_tokens: number, completion_tokens: number, model: string}>}
 */
export async function chat(messages, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const e = new Error('DEEPSEEK_API_KEY 未配置（Vercel Settings → Environment Variables）');
    e.code = 'NO_KEY';
    throw e;
  }

  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.max_tokens ?? 600,
  };
  if (opts.json_mode) {
    body.response_format = { type: 'json_object' };
  }

  const r = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout || 30000),
  });

  if (!r.ok) {
    const text = await r.text();
    const e = new Error(`DeepSeek HTTP ${r.status}: ${text.slice(0, 300)}`);
    e.code = 'API_ERROR';
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content || '';
  const usage = j.usage || {};
  return {
    content,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    model: j.model || body.model,
  };
}

/** 容错 JSON parse — LLM 偶尔在 JSON 外加 ``` 包裹。 */
export function safeJsonParse(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // 尝试找第一个 { 到最后一个 }
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(s);
}

/** 把 LLM 返回的值强转 int 并夹到 [lo, hi]；非法或越界则取 default。 */
export function clampInt(v, lo, hi, dflt) {
  const i = Number.parseInt(v, 10);
  if (Number.isNaN(i)) return dflt;
  if (i < lo || i > hi) return dflt;
  return i;
}
