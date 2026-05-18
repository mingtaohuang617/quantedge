// ─────────────────────────────────────────────────────────────
// Stock Gene 共享工具：引擎配置 / 综合分 / verdict 配色 / 格式化
// ─────────────────────────────────────────────────────────────

export const VERDICT_STYLE = {
  strong: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300" },
  moderate: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300" },
  neutral: { bg: "bg-slate-500/15", border: "border-slate-500/40", text: "text-slate-300" },
  weak: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300" },
  unknown: { bg: "bg-white/5", border: "border-white/15", text: "text-[#a0aec0]" },
};

// ─── 引擎配置 ──────────────────────────────────────────────
// 添加新引擎时：1) 加一行配置  2) 后端注册对应路由
export const ENGINES = {
  trend: {
    id: "trend",
    label: "趋势 · 牛股",
    short: "T",
    framework: "牛股趋势",
    featurePrefix: "F",
    featureCount: 8,
    resultKey: "last_result",
    checkedAtKey: "last_checked_at",
    scoreRoute: "score",
    scoreAllRoute: "score-all",
    comparePeersRoute: "compare-peers",
    activeBg: "bg-emerald-500/20",
    activeText: "text-emerald-100",
    btnBg: "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40",
    badgeRing: "ring-emerald-400/50",
    headerTagline: "8 个牛股特征 — 趋势/动量/相对强度",
    verdictLabels: {
      strong: "牛股潜质", moderate: "中性偏强", neutral: "中性", weak: "待观察",
    },
  },
  value: {
    id: "value",
    label: "价值 · 健康度",
    short: "V",
    framework: "价值健康度",
    featurePrefix: "V",
    featureCount: 6,
    resultKey: "last_value_result",
    checkedAtKey: "last_value_checked_at",
    scoreRoute: "value-score",
    scoreAllRoute: "value/score-all",
    comparePeersRoute: "value/compare-peers",
    activeBg: "bg-cyan-500/20",
    activeText: "text-cyan-100",
    btnBg: "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/40",
    badgeRing: "ring-cyan-400/50",
    headerTagline: "6 个价值特征 — 估值/盈利/现金流/负债",
    verdictLabels: {
      strong: "优质标的", moderate: "质量合格", neutral: "中性", weak: "不推荐",
    },
  },
  signal: {
    id: "signal",
    label: "短期 · 信号",
    short: "S",
    framework: "短期信号",
    featurePrefix: "S",
    featureCount: 6,
    resultKey: "last_signal_result",
    checkedAtKey: "last_signal_checked_at",
    scoreRoute: "signal-score",
    scoreAllRoute: "signal/score-all",
    comparePeersRoute: "signal/compare-peers",
    activeBg: "bg-amber-500/20",
    activeText: "text-amber-100",
    btnBg: "bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40",
    badgeRing: "ring-amber-400/50",
    headerTagline: "6 个短期信号 — 突破/量能/MACD/RSI",
    verdictLabels: {
      strong: "入场窗口", moderate: "可关注", neutral: "观望", weak: "暂避",
    },
  },
  risk: {
    id: "risk",
    label: "风险 · 画像",
    short: "R",
    framework: "风险画像",
    featurePrefix: "R",
    featureCount: 6,
    resultKey: "last_risk_result",
    checkedAtKey: "last_risk_checked_at",
    scoreRoute: "risk-score",
    scoreAllRoute: "risk/score-all",
    comparePeersRoute: "risk/compare-peers",
    activeBg: "bg-violet-500/20",
    activeText: "text-violet-100",
    btnBg: "bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border-violet-500/40",
    badgeRing: "ring-violet-400/50",
    headerTagline: "6 个风险维度 — 回撤/波动/Beta/流动性",
    verdictLabels: {
      strong: "低风险", moderate: "风险可控", neutral: "中等风险", weak: "高风险",
    },
  },
};
export const ENGINE_IDS = Object.keys(ENGINES);
export const eng = (id) => ENGINES[id] || ENGINES.trend;
export const engResult = (item, id) => item?.[eng(id).resultKey];
export const engCheckedAt = (item, id) => item?.[eng(id).checkedAtKey];

// ─── 综合分（4 引擎加权平均，0-100）──────────────────────
export const DEFAULT_WEIGHTS = { trend: 30, value: 30, signal: 10, risk: 30 };
export const WEIGHTS_STORAGE_KEY = "stockgene.weights";

/**
 * 计算综合分（0-100）。
 *   - 每个引擎归一化到 0-1：r.score / r.max_score
 *   - 加权平均（仅计入有评分的引擎）
 *   - 返回：{ composite: 0-100 整数, scored: 评分引擎数 }；全无评分时 composite = null
 */
export function compositeScore(item, weights = DEFAULT_WEIGHTS) {
  let weightedSum = 0;
  let weightTotal = 0;
  let scoredCount = 0;
  for (const id of ENGINE_IDS) {
    const r = engResult(item, id);
    if (!r || r.max_score === 0 || r.score == null) continue;
    const w = weights[id] ?? 0;
    if (w <= 0) continue;
    weightedSum += w * (r.score / r.max_score);
    weightTotal += w;
    scoredCount += 1;
  }
  if (weightTotal === 0) return { composite: null, scored: 0 };
  return { composite: Math.round((weightedSum / weightTotal) * 100), scored: scoredCount };
}

/** 综合分配色：80+ 绿 / 60+ 琥珀 / 40+ 灰 / <40 红 */
export function compositeStyle(composite) {
  if (composite == null) return VERDICT_STYLE.unknown;
  if (composite >= 80) return VERDICT_STYLE.strong;
  if (composite >= 60) return VERDICT_STYLE.moderate;
  if (composite >= 40) return VERDICT_STYLE.neutral;
  return VERDICT_STYLE.weak;
}

export function verdictStyle(verdict) {
  return VERDICT_STYLE[verdict?.level] || VERDICT_STYLE.unknown;
}

// ─── 时间格式化 ──────────────────────────────────────────
export function formatChecked(iso) {
  if (!iso) return "未评分";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** 评分新鲜度：相对时间标签，一眼知道数据多旧 */
export function formatFreshness(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMin = (Date.now() - t) / 60000;
  if (diffMin < 60) return `${Math.max(1, Math.round(diffMin))}分钟前`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}小时前`;
  if (diffMin < 60 * 24 * 30) return `${Math.round(diffMin / (60 * 24))}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

// ─── 多 watchlist 配色 ───────────────────────────────────
export const LIST_COLORS = [
  { id: "indigo", text: "text-indigo-300", bg: "bg-indigo-500/15", border: "border-indigo-500/40", active: "bg-indigo-500/20 text-indigo-100" },
  { id: "emerald", text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/40", active: "bg-emerald-500/20 text-emerald-100" },
  { id: "amber", text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/40", active: "bg-amber-500/20 text-amber-100" },
  { id: "cyan", text: "text-cyan-300", bg: "bg-cyan-500/15", border: "border-cyan-500/40", active: "bg-cyan-500/20 text-cyan-100" },
  { id: "rose", text: "text-rose-300", bg: "bg-rose-500/15", border: "border-rose-500/40", active: "bg-rose-500/20 text-rose-100" },
  { id: "violet", text: "text-violet-300", bg: "bg-violet-500/15", border: "border-violet-500/40", active: "bg-violet-500/20 text-violet-100" },
  { id: "slate", text: "text-slate-300", bg: "bg-slate-500/15", border: "border-slate-500/40", active: "bg-slate-500/20 text-slate-100" },
];
export const listColor = (id) => LIST_COLORS.find(c => c.id === id) || LIST_COLORS[6];

// ─── localStorage keys ──────────────────────────────────
export const ACTIVE_LIST_STORAGE_KEY = "stockgene.activeListId";
export const LAST_SEEN_ALERTS_KEY = "stockgene.lastSeenAlertsAt";
export const NOTIFY_PERMISSION_KEY = "stockgene.notifyPermission";
