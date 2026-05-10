// 宏观看板共用常量 + 工具（无 JSX，纯函数 + 配色映射）

// 面板 3 级风格：primary=渐变核心卡 / secondary=次级实色卡 / inline=嵌入分隔
export const PANEL = {
  primary: "bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-xl p-5 mb-4",
  secondary: "bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4",
  ai: "bg-gradient-to-br from-indigo-500/[0.07] to-violet-500/[0.04] border border-indigo-400/[0.18] rounded-xl p-4 mb-4",
  inline: "mt-3 pt-3 border-t border-white/[0.04]",
};

// L4 HMM 三态独立配色（区别于 L3 温度的 emerald/orange/red 系，避免视觉混淆）
//   bull → cyan（冷蓝绿，"稳定上行"）
//   neutral → violet（紫，"不确定/震荡"）
//   bear → rose（暖红粉，区别于 L3 的纯 red）
export const HMM_COLOR = {
  bull:    { bg: "bg-cyan-400/80",   text: "text-cyan-300",    label: "牛" },
  neutral: { bg: "bg-violet-400/70", text: "text-violet-300",  label: "震荡" },
  bear:    { bg: "bg-rose-400/80",   text: "text-rose-300",    label: "熊" },
};

export const CATEGORY_LABEL = {
  valuation: "估值",
  liquidity: "流动性",
  breadth: "宽度",
  sentiment: "情绪",
  macro: "宏观",
  technical: "技术",
};

export const CATEGORY_COLOR = {
  valuation: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  liquidity: "text-cyan-300 bg-cyan-500/10 border-cyan-400/30",
  breadth: "text-violet-300 bg-violet-500/10 border-violet-400/30",
  sentiment: "text-pink-300 bg-pink-500/10 border-pink-400/30",
  macro: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  technical: "text-slate-300 bg-slate-500/10 border-slate-400/30",
};

// 5 段配色：低 = 冷蓝；高 = 暖红；中性 = 灰（因子卡片"分位"维度）
export const PCT_BAR_BG = (pct) => {
  if (pct == null) return "bg-slate-500/30";
  if (pct < 20) return "bg-blue-400/70";
  if (pct < 40) return "bg-cyan-400/70";
  if (pct < 60) return "bg-slate-400/70";
  if (pct < 80) return "bg-orange-400/70";
  return "bg-red-400/80";
};

export const PCT_TEXT = (pct) => {
  if (pct == null) return "text-slate-400";
  if (pct < 20) return "text-blue-300";
  if (pct < 40) return "text-cyan-300";
  if (pct < 60) return "text-slate-200";
  if (pct < 80) return "text-orange-300";
  return "text-red-300";
};

// 0-100 牛熊温度配色（方向化的 sub-score / market_temperature 维度）
export const TEMP_BAR = (s) => {
  if (s == null) return "bg-slate-500/30";
  if (s < 20) return "bg-red-400/80";
  if (s < 40) return "bg-orange-400/70";
  if (s < 60) return "bg-slate-400/70";
  if (s < 80) return "bg-lime-400/70";
  return "bg-emerald-400/80";
};

export const TEMP_TEXT = (s) => {
  if (s == null) return "text-slate-400";
  if (s < 20) return "text-red-300";
  if (s < 40) return "text-orange-300";
  if (s < 60) return "text-slate-200";
  if (s < 80) return "text-lime-300";
  return "text-emerald-300";
};

export const TEMP_LABEL = (s) => {
  if (s == null) return "—";
  if (s < 15) return "极熊";
  if (s < 35) return "偏熊";
  if (s < 50) return "中性偏熊";
  if (s < 65) return "中性偏牛";
  if (s < 85) return "偏牛";
  return "极牛";
};

// 因子方向 badge：让"高=牛 vs 高=熊"一目了然
export const DIRECTION_BADGE = (direction, contrarian) => {
  if (direction === "higher_bullish") {
    return {
      icon: "↑", label: "高=牛", title: "分位越高越利好（如 ERP/200MA 占比/Fed 扩表）",
      cls: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
    };
  }
  if (direction === "lower_bullish" && contrarian) {
    return {
      icon: "↕", label: "低=牛·极端反向", title: "正常区低分位利好；极端区（<10/>90%）反向。VIX/SKEW/HY 这类。",
      cls: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/30",
    };
  }
  if (direction === "lower_bullish") {
    return {
      icon: "↓", label: "低=牛", title: "分位越低越利好（如 PE/CAPE/Buffett，估值越便宜越好）",
      cls: "text-sky-300 bg-sky-500/10 border-sky-400/30",
    };
  }
  return {
    icon: "─", label: "中性", title: "无明确单调方向",
    cls: "text-slate-300 bg-slate-500/10 border-slate-400/30",
  };
};

export function fmtRaw(x) {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1000) return x.toFixed(0);
  if (abs >= 100) return x.toFixed(1);
  if (abs >= 10) return x.toFixed(2);
  if (abs >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.now() - d.getTime()) / 86400000);
}

// 因子级"数据滞后"阈值：按频率分级，超过阈值视为陈旧
//   daily=7d / weekly=14d / monthly=45d
// 用于 FactorCard 滞后徽章 + DataStatusBanner 滞后聚合统计。
export const FACTOR_LAG_THRESHOLD = { daily: 7, weekly: 14, monthly: 45 };

export function factorLagThreshold(freq) {
  return FACTOR_LAG_THRESHOLD[freq] ?? 14;
}

// Snapshot 陈旧度分级：根据 generated_at 距今天数返回配色 + 文案
//   ≤1d  → fresh (绿)；≤3d → recent (青)；≤7d → stale (琥珀)；>7d → very_stale (红)
// 用在 MacroDashboard 顶部 snapshot badge，让用户一眼知道线上数据有多旧。
export function snapshotStaleness(generatedAt) {
  const days = daysSince(generatedAt);
  if (days == null) {
    return { tier: "unknown", days: null, icon: "·", label: "未知",
             cls: "bg-slate-500/10 border-slate-400/30 text-slate-300" };
  }
  if (days <= 1) {
    return { tier: "fresh", days, icon: "●", label: "新鲜",
             cls: "bg-emerald-500/10 border-emerald-400/30 text-emerald-300" };
  }
  if (days <= 3) {
    return { tier: "recent", days, icon: "●", label: "近期",
             cls: "bg-cyan-500/10 border-cyan-400/30 text-cyan-300" };
  }
  if (days <= 7) {
    return { tier: "stale", days, icon: "◐", label: "1 周内",
             cls: "bg-amber-500/10 border-amber-400/30 text-amber-300" };
  }
  return { tier: "very_stale", days, icon: "○", label: "陈旧",
           cls: "bg-red-500/10 border-red-400/30 text-red-300" };
}
