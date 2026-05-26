// /api/stock-gene  —  v0.8 唯一 stock-gene serverless function
//
// 经验教训：Vercel 纯 Functions（非 Next.js）的 filesystem 路由不识别 [...slug].js
// catch-all 写法。之前用 [...slug].js 导致整个 stock-gene/ 目录都没被 Vercel 收集成
// function，所有子路径全部 404。
//
// 现方案：单一 index.js + vercel.json rewrites 把所有子路径 rewrite 到 index.js + ?path=...
//
// 路由表（来自 req.query.path）：
//   ""(空 / 没 path)                       → 原 GET/POST 逻辑（list items / add item）
//   "alerts"                              → _alerts.js          评分变化预警
//   "export"                              → _export.js          JSON 导出
//   "import"                              → _import.js          JSON 导入
//   "unavailable"                         → _unavailable.js     503 stub
//   "lists"                               → _lists.js           列出 / 新增 list
//   "lists/{id}"                          → _handle-lists-id.js 编辑 / 删除 list
//   "scheduler/status"                    → _handle-scheduler-status.js
//   "{ticker}"                            → _handle-ticker.js   单只股票 PUT/DELETE
//   "{ticker}/move"                       → _handle-ticker-move.js
//   "{ticker}/score"                      → _handle-ticker-score.js
//   "{ticker}/value-score"                → _handle-ticker-score.js（直跑评分逻辑）
//   "{ticker}/signal-score"               → 同上
//   "{ticker}/risk-score"                 → 同上
//   其它无法处理路径                       → 503 unavailable

import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadData, addItem } from '../_lib/stockGene.js';

import alertsHandler from './_alerts.js';
import exportHandler from './_export.js';
import importHandler from './_import.js';
import unavailableHandler from './_unavailable.js';
import listsHandler from './_lists.js';
import listsIdHandler from './_handle-lists-id.js';
import schedulerStatusHandler from './_handle-scheduler-status.js';
import tickerHandler from './_handle-ticker.js';
import tickerMoveHandler from './_handle-ticker-move.js';
import tickerScoreHandler from './_handle-ticker-score.js';

const STATIC_TOP = {
  alerts: alertsHandler,
  export: exportHandler,
  import: importHandler,
  unavailable: unavailableHandler,
};

// 双段路由里前缀是 "value" | "signal" | "risk" 后跟 "score-all" | "compare-peers" 之类的
// 都映射到 unavailable（503 stub，跟原 vercel.json rewrites 等价）
const UNAVAILABLE_PATHS = new Set([
  'compare-peers',
  'explain',
  'score-all',
  'value/score-all',
  'value/compare-peers',
  'signal/score-all',
  'signal/compare-peers',
  'risk/score-all',
  'risk/compare-peers',
  'scheduler/enabled',
  'scheduler/schedule',
  'scheduler/run-now',
]);

function dispatchSubpath(req, res, path) {
  // 把 path 拆成段
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return null;
  const [first, second] = segs;

  // 单段静态路由
  if (segs.length === 1) {
    if (STATIC_TOP[first]) return STATIC_TOP[first](req, res);
    if (first === 'lists') return listsHandler(req, res);
    if (UNAVAILABLE_PATHS.has(first)) return unavailableHandler(req, res);
    // 兜底：当 ticker 处理（PUT/DELETE）
    req.query.ticker = first;
    return tickerHandler(req, res);
  }

  // 双段路由
  if (segs.length === 2) {
    if (UNAVAILABLE_PATHS.has(path)) return unavailableHandler(req, res);
    if (first === 'lists') {
      req.query.id = second;
      return listsIdHandler(req, res);
    }
    if (first === 'scheduler' && second === 'status') {
      return schedulerStatusHandler(req, res);
    }
    // {ticker}/move | score | value-score | signal-score | risk-score
    req.query.ticker = first;
    if (second === 'move') return tickerMoveHandler(req, res);
    if (second === 'score' || second === 'value-score' || second === 'signal-score' || second === 'risk-score') {
      return tickerScoreHandler(req, res);
    }
  }

  // 没匹配到 — 404
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({
    ok: false,
    error: 'stock-gene route not found',
    path: '/api/stock-gene/' + path,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  // 子路径走 dispatcher（vercel.json rewrite 提供 ?path=...）
  const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (path) {
    return dispatchSubpath(req, res, path);
  }

  // 根路径 — 保留原 GET/POST 逻辑
  if (req.method === 'GET') {
    const data = await loadData();
    return res.status(200).json({
      version: data.version,
      lists: data.lists,
      items: data.items,
    });
  }

  if (req.method === 'POST') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：Vercel Settings → Storage → Create Database → KV → Connect 后即可使用',
      });
    }
    const body = await readJson(req);
    try {
      const item = await addItem(body.ticker, body);
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
