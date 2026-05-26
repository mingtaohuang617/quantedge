// /api/watchlist/10x/[slug]  —  v0.8 单点 dispatcher（绕过 Vercel Hobby plan 12 函数上限）
//
// 路由（slug 取自 URL path 第一段）：
//   - /api/watchlist/10x/export            → _export.js
//   - /api/watchlist/10x/import            → _import.js
//   - /api/watchlist/10x/screen            → _screen.js
//   - /api/watchlist/10x/supertrends       → _supertrends.js
//   - /api/watchlist/10x/{ticker}          → _handle-ticker.js (兜底，把 slug 当 ticker)
//
// 实际 handler 文件以 `_` 开头，Vercel 自动忽略不当成 serverless function。

import exportHandler from "./_export.js";
import importHandler from "./_import.js";
import screenHandler from "./_screen.js";
import supertrendsHandler from "./_supertrends.js";
import tickerHandler from "./_handle-ticker.js";

const STATIC_ROUTES = {
  export: exportHandler,
  import: importHandler,
  screen: screenHandler,
  supertrends: supertrendsHandler,
};

export default async function handler(req, res) {
  const slug = String(req.query.slug || "").trim();
  if (!slug) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ ok: false, error: "missing slug" });
  }
  const staticFn = STATIC_ROUTES[slug];
  if (staticFn) return staticFn(req, res);
  // slug 看起来是 ticker — 把 slug 暴露成 ticker 供 handler 用
  req.query.ticker = slug;
  return tickerHandler(req, res);
}
