// ─────────────────────────────────────────────────────────────
// screener10xPrefs — 10x 猎手 UI 偏好持久化（localStorage）
// ─────────────────────────────────────────────────────────────
// 让用户的筛选偏好跨会话保留：刷新 / 重新打开浏览器后回到上次状态。
//
// 不持久化：selectedTrends（赛道 ID 可能变）/ search（transient）/ 候选列表
//
// 设计：
//   - 单 JSON blob 存在 'quantedge_screener10x_prefs'
//   - 缺字段 / 解析失败 → 静默回退 default
//   - 写入失败（quota / disabled）静默忽略，不影响主流程
//   - 字段一律校验类型，不信任 localStorage 的内容（防止用户手动改坏）
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "quantedge_screener10x_prefs";

export const DEFAULT_PREFS = {
  markets: ["US", "HK", "CN"],
  includeETF: false,
  precise: false,
  maxMcapInput: 1000,
  activeStrategy: "growth",
  valueFilters: {
    max_pe: 25,
    max_pb: null,
    min_roe: null,
    min_dividend_yield: null,
    max_debt_to_equity: null,
  },
  showArchived: false,
};

const VALID_MARKETS = new Set(["US", "HK", "CN"]);
const VALID_STRATEGY = new Set(["growth", "value"]);

/** 类型保护：拿到任意 raw 对象 → 安全合并到默认值。 */
export function sanitizePrefs(raw) {
  const out = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== "object") return out;

  if (Array.isArray(raw.markets)) {
    const filtered = raw.markets.filter((m) => typeof m === "string" && VALID_MARKETS.has(m));
    if (filtered.length > 0) out.markets = filtered;
  }
  if (typeof raw.includeETF === "boolean") out.includeETF = raw.includeETF;
  if (typeof raw.precise === "boolean") out.precise = raw.precise;
  if (typeof raw.maxMcapInput === "number" && Number.isFinite(raw.maxMcapInput) && raw.maxMcapInput >= 0) {
    out.maxMcapInput = raw.maxMcapInput;
  }
  if (typeof raw.activeStrategy === "string" && VALID_STRATEGY.has(raw.activeStrategy)) {
    out.activeStrategy = raw.activeStrategy;
  }
  if (raw.valueFilters && typeof raw.valueFilters === "object") {
    const vf = { ...DEFAULT_PREFS.valueFilters };
    for (const k of Object.keys(vf)) {
      const v = raw.valueFilters[k];
      if (v == null) vf[k] = null;
      else if (typeof v === "number" && Number.isFinite(v)) vf[k] = v;
      // 其他类型一律视为 null（不信任 localStorage 内容）
    }
    out.valueFilters = vf;
  }
  if (typeof raw.showArchived === "boolean") out.showArchived = raw.showArchived;
  return out;
}

/** 从 localStorage 读偏好。缺失 / 失败 → 返回 DEFAULT_PREFS。 */
export function loadPrefs() {
  if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** 写偏好到 localStorage。quota / disabled / 序列化失败一律静默忽略。 */
export function savePrefs(prefs) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    // 静默忽略 — quota exceeded / serialize error / localStorage disabled
  }
}

/** 清空偏好（用于测试 / "重置默认" 按钮）。 */
export function clearPrefs() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}
