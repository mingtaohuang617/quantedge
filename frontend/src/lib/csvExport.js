// ─────────────────────────────────────────────────────────────
// csvExport — watchlist CSV 序列化（pure，可测）
// ─────────────────────────────────────────────────────────────
// 从 Screener10x.jsx 抽出便于单测。
//
// 用法：
//   import { serializeWatchlistCsv } from "../lib/csvExport.js";
//   const csv = serializeWatchlistCsv(json.items);
//   const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
// ─────────────────────────────────────────────────────────────

// CSV 字段顺序：ticker → 投资逻辑（用户最关心的列在前）
export const WATCHLIST_CSV_HEADERS = [
  "ticker", "name", "supertrend", "strategy",
  "bottleneck_layer", "moat_score",
  "target_price", "stop_loss",
  "thesis", "falsification_condition",
  "archived", "added_at", "llm_thesis_cached_at",
];

/**
 * 标准 RFC 4180 字段转义：
 *   - null/undefined → 空字符串
 *   - 含逗号/换行/双引号 → 包双引号 + 内部双引号 doubled
 *   - 多行（thesis 等）压成单行（\n → " | "），方便 Excel 浏览
 */
export function escapeCsvField(v) {
  if (v == null) return "";
  const s = String(v).replace(/\r?\n/g, " | ");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * watchlist items 数组 → CSV 字符串（首行 header + 行用 CRLF 分隔 + UTF-8 BOM）。
 * BOM 让 Excel 识别 UTF-8（否则中文乱码）。
 */
export function serializeWatchlistCsv(items, headers = WATCHLIST_CSV_HEADERS) {
  const safe = Array.isArray(items) ? items : [];
  const rows = [headers.join(",")];
  for (const it of safe) {
    rows.push(headers.map((h) => escapeCsvField(it?.[h])).join(","));
  }
  return "﻿" + rows.join("\r\n");
}
