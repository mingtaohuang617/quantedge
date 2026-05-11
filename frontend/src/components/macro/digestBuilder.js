// 生成宏观日报文本 — 把当前 dashboard 状态压成一段纯文本快照
//
// 输出格式（纯 ASCII / 中文，无表情符号、无 markdown，便于复制到邮件 / Slack）：
//
//   2026-05-11 宏观快照
//
//   市场温度：34.5 / 100（极熊，WoW -2.5）
//   HMM 三态：熊 76% · 震荡 15% · 牛 9%
//   持续期：当前熊市 280d（历史分位 65%，中位数 150d）
//
//   活跃告警 (2):
//     [严重] 顶部预警 · 估值历史性极端 — 估值子分 11/100…
//     [警示] 信用极度乐观 + 估值贵 — …
//
//   拉动牛势：US_FED_BAL +20 · CN_PBoC_OMO +15
//   拉动熊势：US_CAPE -49 · US_BUFFETT -50
//
//   数据：snapshot 2026-05-09 (2 天前)
import { TEMP_LABEL, HMM_COLOR, snapshotStaleness, wowDelta,
         bullishContribution, directionalScore } from "./shared.js";

const LEVEL = { critical: "严重", warning: "警示", info: "提示" };

function fmtDelta(d) {
  if (d == null || d === 0) return "";
  return ` · WoW ${d > 0 ? "+" : ""}${d.toFixed(1)}`;
}

function topMovers(factors, mode, n = 3) {
  if (!factors) return [];
  const enriched = factors
    .map(f => ({ f, contrib: bullishContribution(f), score: directionalScore(f) }))
    .filter(x => x.contrib != null);
  const sorted = mode === "bull"
    ? [...enriched].sort((a, b) => b.contrib - a.contrib).filter(x => x.contrib > 0)
    : [...enriched].sort((a, b) => a.contrib - b.contrib).filter(x => x.contrib < 0);
  return sorted.slice(0, n);
}

export function buildDigest({ composite, history, factors, generatedAt }) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`${today} 宏观快照`);
  lines.push("");

  // 综合温度 + WoW
  const temp = composite?.market_temperature;
  if (temp != null) {
    const tempDelta = wowDelta(history, "temp");
    lines.push(`市场温度：${temp.toFixed(1)} / 100（${TEMP_LABEL(temp)}${fmtDelta(tempDelta)}）`);
  }

  // HMM 三态分布
  const hmm = composite?.hmm?.current;
  if (hmm) {
    const parts = ["bull", "neutral", "bear"].map(s => {
      const pct = (hmm[s] || 0) * 100;
      return `${HMM_COLOR[s].label} ${pct.toFixed(0)}%`;
    });
    lines.push(`HMM 三态：${parts.join(" · ")}`);
  }

  // 持续期
  const surv = composite?.survival;
  if (surv && !surv.error && surv.current_duration_days != null) {
    const regime = surv.current_regime === "bull" ? "牛市" : surv.current_regime === "bear" ? "熊市" : surv.current_regime;
    lines.push(`持续期：当前${regime} ${surv.current_duration_days}d（历史分位 ${surv.current_duration_pct_rank ?? "—"}%，中位数 ${surv.median_past_days ?? "—"}d）`);
  }

  // 活跃告警
  const alerts = composite?.alerts;
  if (alerts && alerts.length > 0) {
    lines.push("");
    lines.push(`活跃告警 (${alerts.length}):`);
    const order = { critical: 0, warning: 1, info: 2 };
    [...alerts].sort((a, b) => (order[a.level] - order[b.level]))
      .forEach(a => {
        const tag = LEVEL[a.level] || a.level;
        const summary = a.summary ? ` — ${a.summary}` : "";
        lines.push(`  [${tag}] ${a.title}${summary}`);
      });
  }

  // Top movers
  const bull = topMovers(factors, "bull");
  const bear = topMovers(factors, "bear");
  if (bull.length > 0 || bear.length > 0) {
    lines.push("");
    if (bull.length > 0) {
      lines.push(`拉动牛势：${bull.map(x => `${x.f.factor_id} +${(x.score - 50).toFixed(0)}`).join(" · ")}`);
    }
    if (bear.length > 0) {
      lines.push(`拉动熊势：${bear.map(x => `${x.f.factor_id} ${(x.score - 50).toFixed(0)}`).join(" · ")}`);
    }
  }

  // 数据陈旧度
  if (generatedAt) {
    const st = snapshotStaleness(generatedAt);
    const days = st.days != null ? ` (${st.days} 天前)` : "";
    lines.push("");
    lines.push(`数据：snapshot ${generatedAt.slice(0, 10)}${days}`);
  }

  return lines.join("\n");
}
