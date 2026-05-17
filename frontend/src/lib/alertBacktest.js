// L5 双重确认告警回测 — 用 composite_history 重放过去 5Y 触发点，统计前向收益
//
// 限制：composite_history 只有 daily market_temperature + by_category 子分 +
// benchmark；没有逐日 per-factor percentile。因此可以精确重放的规则有限：
//
//   ✓ rule_temp_low (temp ≤ 20)        — 底部接近极端
//   ✓ rule_temp_high (temp ≥ 80)       — 顶部接近极端
//   ✓ rule_top_breadth_div (temp ≥ 55 + breadth ≤ 40)  — 顶背离（== alerts.py Rule 3）
//   ✓ rule_neutral (35 < temp < 65)    — 中性区间（== alerts.py Rule 6 info）
//   ~ rule_val_extreme_approx (val_score ≤ 20) — 估值极端的简化版（缺 2+ ≥90 校验）
//
// 跳过的规则（需要 per-factor 历史）：信用 panic (HY/Baa)、VIX 恐慌、原 alerts.py
// Rule 1 完整版（要求 2+ valuation factor ≥ 90 percentile）。这些可以等后端
// 持久化逐日 per-factor 后再补。

export const HORIZONS = [21, 63, 252];  // 1m / 3m / 1y trading days

// 单日规则评估：返回触发的 rule_id 数组
export function evaluateDay({ temp, valuation, breadth }) {
  const ids = [];
  if (temp == null) return ids;
  if (temp <= 20) ids.push("rule_temp_low");
  if (temp >= 80) ids.push("rule_temp_high");
  if (temp >= 55 && breadth != null && breadth <= 40) ids.push("rule_top_breadth_div");
  if (temp > 35 && temp < 65) ids.push("rule_neutral");
  if (valuation != null && valuation <= 20) ids.push("rule_val_extreme_approx");
  return ids;
}

// 前向收益：从 bench[idx] 到 bench[idx+h]
function forwardReturn(bench, idx, h) {
  const base = bench[idx];
  const future = bench[idx + h];
  if (base == null || future == null || base === 0) return null;
  return (future / base - 1) * 100;
}

function statsOf(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const winRate = arr.filter(x => x > 0).length / arr.length;
  return {
    n: arr.length,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    winRate: Number(winRate.toFixed(3)),
  };
}

// 主入口：composite_history → 每条规则的聚合统计
export function backtestAlerts(history, horizons = HORIZONS) {
  if (!history?.dates?.length) return null;
  const dates = history.dates;
  const temp = history.market_temperature || [];
  const valuation = history.by_category?.valuation || [];
  const breadth = history.by_category?.breadth || [];
  const bench = history.benchmark?.values || [];
  if (bench.length !== dates.length) return null;

  // 收集 trigger idx
  const triggers = {};  // rule_id → [idx, idx, ...]
  for (let i = 0; i < dates.length; i++) {
    const ids = evaluateDay({
      temp: temp[i],
      valuation: valuation[i],
      breadth: breadth[i],
    });
    for (const id of ids) {
      if (!triggers[id]) triggers[id] = [];
      triggers[id].push(i);
    }
  }

  // 去抖：连续触发只保留首日（避免一段熊市 100 天每天都计一次）
  // 注意 last 仅在 push 时更新，否则 [0,1,2,...] 只会留下第一个
  function dedup(idxs, gap = 5) {
    const out = [];
    let last = -Infinity;
    for (const i of idxs) {
      if (i - last >= gap) {
        out.push(i);
        last = i;
      }
    }
    return out;
  }

  // 聚合
  const aggregate = {};
  for (const id of Object.keys(triggers)) {
    const dedupedIdxs = dedup(triggers[id]);
    const byHorizon = {};
    for (const h of horizons) {
      const rets = dedupedIdxs
        .map(i => forwardReturn(bench, i, h))
        .filter(v => v != null);
      byHorizon[h] = statsOf(rets);
    }
    aggregate[id] = {
      count: dedupedIdxs.length,
      countRaw: triggers[id].length,
      first: dedupedIdxs.length > 0 ? dates[dedupedIdxs[0]] : null,
      last: dedupedIdxs.length > 0 ? dates[dedupedIdxs[dedupedIdxs.length - 1]] : null,
      forward: byHorizon,
    };
  }

  return {
    rules: aggregate,
    period: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
    horizons,
  };
}

// 规则元数据：human-readable name + 解读 + level
export const RULE_META = {
  rule_temp_low: {
    label: "温度极低（≤20）",
    kind: "bottom",
    desc: "综合温度跌到极端区，历史上常为中期底部信号",
  },
  rule_temp_high: {
    label: "温度极高（≥80）",
    kind: "top",
    desc: "综合温度冲到极端区，历史上常为中期顶部信号",
  },
  rule_top_breadth_div: {
    label: "温度高 + 宽度走弱（顶背离）",
    kind: "top",
    desc: "指数偏强但宽度不跟，少数大票拖动指数",
  },
  rule_neutral: {
    label: "中性区间（35-65）",
    kind: "neutral",
    desc: "无极端信号，做对照基线",
  },
  rule_val_extreme_approx: {
    label: "估值极端（简化版）",
    kind: "top",
    desc: "估值子分 ≤ 20；缺 2+ 因子 ≥ 90 校验，仅供参考",
  },
};
