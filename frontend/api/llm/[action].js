// /api/llm/[action]  —  v0.8 单点 dispatcher（绕过 Vercel Hobby plan 12 函数上限）
//
// 路由：/api/llm/{action} → 调用对应 _{action}.js 中的 handler
// 支持的 action：
//   - generate-keywords        生成 sector_mapping 关键词
//   - match-supertrend         判断股票属于哪些超级赛道
//   - rank-candidates          对候选股按 strategy 打 1-5 分
//   - 10x-thesis               生成卡位 / 价值 thesis 草稿
//
// 添加新 action 时：1) 新建 _{name}.js 同目录文件 default export handler
//                  2) 在下面 ROUTES 表加一行
//
// 实际 handler 文件以 `_` 开头，Vercel 自动忽略不当成 serverless function。

import generateKeywords from "./_generate-keywords.js";
import matchSupertrend from "./_match-supertrend.js";
import rankCandidates from "./_rank-candidates.js";
import tenXThesis from "./_10x-thesis.js";

const ROUTES = {
  "generate-keywords": generateKeywords,
  "match-supertrend": matchSupertrend,
  "rank-candidates": rankCandidates,
  "10x-thesis": tenXThesis,
};

export default async function handler(req, res) {
  const action = String(req.query.action || "").trim();
  const fn = ROUTES[action];
  if (!fn) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({
      ok: false,
      error: `unknown action: ${action}`,
      available: Object.keys(ROUTES),
    });
  }
  return fn(req, res);
}
