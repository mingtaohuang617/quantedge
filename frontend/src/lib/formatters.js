// ─────────────────────────────────────────────────────────────
// formatters — 显示用数值格式化共享 helper
// ─────────────────────────────────────────────────────────────
//
// 提取自 Screener10x.jsx + StockDetailPanel.jsx 重复实现（PR #163）。
// 都对 null/undefined/NaN/Infinity 安全：返回 "—" 占位符（中文 emdash）。
//
// 复合规则（不在 fmt* 范围内的）：
//   - fmtMcap 千亿/十亿/百万自动选档；marketCap 单位是美元（不是 B）
//   - fmtNum / fmtPct 默认 prec=2，保留精度无歧义；调用方需要 1 位手动传
// ─────────────────────────────────────────────────────────────

const DASH = "—";

/**
 * 市值格式化。
 *   - 1T+ → "1.23T"（trillion）
 *   - 1B+ → "150.20B"（billion）
 *   - 1M+ → "500M"（million, 整数）
 *   - 其他 → "12345"（整数）
 *   - null/undefined → "—"
 *
 * @param {number|null|undefined} mc 市值（美元）
 * @returns {string}
 */
export function fmtMcap(mc) {
  if (mc == null) return DASH;
  if (typeof mc !== "number" || !isFinite(mc)) return DASH;
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `${(mc / 1e6).toFixed(0)}M`;
  return `${mc.toFixed(0)}`;
}

/**
 * 一般数值格式化。默认 2 位小数。非有限值返回 "—"。
 *
 * @param {number|null|undefined} v
 * @param {number} [prec=2] 小数位数
 * @returns {string}
 */
export function fmtNum(v, prec = 2) {
  return typeof v === "number" && isFinite(v) ? v.toFixed(prec) : DASH;
}

/**
 * 百分比格式化。输入是 0.123 这种比例，输出 "12.3%"。
 * 1 位小数，非有限值返回 "—"。
 *
 * @param {number|null|undefined} v 比例值（0.05 = 5%）
 * @returns {string}
 */
export function fmtPct(v) {
  return typeof v === "number" && isFinite(v) ? `${(v * 100).toFixed(1)}%` : DASH;
}
