// /api/stock-gene/[...slug]  —  v0.8 单点 dispatcher（绕过 Vercel Hobby plan 12 函数上限）
//
// Vercel API filesystem 路由只支持 [name] 和 [...name]，不支持 [[...name]]（Next.js 特性）。
// 所以根路径 /api/stock-gene/ 走单独 index.js；本文件只接 1+ 段 slug。
//
// 路由表（slug 是 path segments 数组）：
//   ["alerts"]                            → _alerts.js          评分变化预警
//   ["export"]                            → _export.js          JSON 导出
//   ["import"]                            → _import.js          JSON 导入
//   ["unavailable"]                       → _unavailable.js     503 stub
//   ["lists"]                             → _lists.js           列出 / 新增 list
//   ["lists", {id}]                       → _handle-lists-id.js 编辑 / 删除 list
//   ["scheduler", "status"]               → _handle-scheduler-status.js
//   [{ticker}]                            → _handle-ticker.js   单只股票 PUT/DELETE
//   [{ticker}, "move"]                    → _handle-ticker-move.js
//   [{ticker}, "score"]                   → _handle-ticker-score.js
//
// 兼容 vercel.json rewrites：value-score / signal-score / risk-score / score-all 等都通过 rewrite 落到 [ticker]/score。
//
// 实际 handler 文件以 `_` 开头，Vercel 自动忽略不当成 serverless function。

// 注意：根路径走单独 index.js，本文件无需 indexHandler
import alertsHandler from "./_alerts.js";
import exportHandler from "./_export.js";
import importHandler from "./_import.js";
import unavailableHandler from "./_unavailable.js";
import listsHandler from "./_lists.js";
import listsIdHandler from "./_handle-lists-id.js";
import schedulerStatusHandler from "./_handle-scheduler-status.js";
import tickerHandler from "./_handle-ticker.js";
import tickerMoveHandler from "./_handle-ticker-move.js";
import tickerScoreHandler from "./_handle-ticker-score.js";

// 静态 path（slug 第一段）→ handler 映射；末尾不能再有 segment
const STATIC_TOP = {
  alerts: alertsHandler,
  export: exportHandler,
  import: importHandler,
  unavailable: unavailableHandler,
};

export default async function handler(req, res) {
  const slug = req.query.slug;
  const segs = Array.isArray(slug) ? slug : (slug ? [slug] : []);

  // /api/stock-gene/ 走单独 index.js — 本文件至少 1 段
  if (segs.length === 0) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ ok: false, error: "missing path segment" });
  }

  const [first, second] = segs;

  // 单段静态路由：alerts / export / import / unavailable
  if (segs.length === 1) {
    if (STATIC_TOP[first]) return STATIC_TOP[first](req, res);
    if (first === "lists") return listsHandler(req, res);
    // 兜底：当 ticker 处理（PUT/DELETE 单只股票）
    req.query.ticker = first;
    return tickerHandler(req, res);
  }

  // 双段路由
  if (segs.length === 2) {
    if (first === "lists") {
      req.query.id = second;
      return listsIdHandler(req, res);
    }
    if (first === "scheduler" && second === "status") {
      return schedulerStatusHandler(req, res);
    }
    // [ticker]/{move|score}
    req.query.ticker = first;
    if (second === "move") return tickerMoveHandler(req, res);
    if (second === "score") return tickerScoreHandler(req, res);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({
    ok: false,
    error: "stock-gene route not found",
    path: "/api/stock-gene/" + segs.join("/"),
  });
}
