// 组合宏观敏感度 — 把 macroDelta 从单股推广到整张持仓
//
// 输入：journal entries（持仓）+ liveStocks（sub-scores 在这里）+ 当前 temp
// 输出：当前 regime 下加权 Δ、flipped regime 模拟、最敏感的几只票
//
// "Flipped regime" = 100 - temp（围绕中性 50 镜像）。如果当前 bull (temp=70)，
// 翻转模拟假设 bear (temp=30)；反之亦然。这是粗粒度规模模拟，不是真实回测，
// 但能告诉用户"如果风向转，组合多大程度受影响"。
import { macroDelta } from "./macroAdjust.js";

export function portfolioMacroSensitivity(entries, liveStocks, temp) {
  if (temp == null) return null;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!Array.isArray(liveStocks)) liveStocks = [];

  const stockByTicker = new Map(liveStocks.map(s => [s.ticker, s]));
  const flippedTemp = 100 - temp;

  const rows = [];
  let totalValue = 0;
  let valueWithDelta = 0;     // 有 delta 的票的总仓位（按这个加权）
  let weightedDelta = 0;
  let weightedDeltaFlipped = 0;

  for (const e of entries) {
    const shares = Number(e?.shares) || 0;
    if (shares <= 0) continue;
    const price = Number(e?.currentPrice) || Number(e?.anchorPrice) || 0;
    if (price <= 0) continue;
    const stk = stockByTicker.get(e.ticker) || null;
    const value = shares * price;
    totalValue += value;
    const delta = stk ? macroDelta(stk, temp) : null;
    const deltaFlipped = stk ? macroDelta(stk, flippedTemp) : null;
    if (delta != null) {
      valueWithDelta += value;
      weightedDelta += value * delta;
      weightedDeltaFlipped += value * (deltaFlipped ?? 0);
    }
    rows.push({
      ticker: e.ticker,
      name: e.name,
      value,
      delta,        // null if ETF / no subScores
      deltaFlipped,
    });
  }

  if (totalValue === 0) return null;

  // 加权平均（只在"有 delta"的仓位上）
  const portfolioDelta = valueWithDelta > 0 ? weightedDelta / valueWithDelta : null;
  const portfolioDeltaFlipped = valueWithDelta > 0 ? weightedDeltaFlipped / valueWithDelta : null;
  const sensitivity = portfolioDelta != null && portfolioDeltaFlipped != null
    ? Math.abs(portfolioDeltaFlipped - portfolioDelta)
    : null;

  // 贡献度：value × delta 的绝对值，降序
  const contributors = rows
    .filter(r => r.delta != null && Math.abs(r.delta) >= 0.3)
    .map(r => ({
      ...r,
      contribution: (r.value / totalValue) * r.delta,  // 占组合的 Δ 贡献
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // 覆盖率：有 delta 的票占总仓位的比例（ETF 没有 sub-scores → 拉低覆盖）
  const coverage = totalValue > 0 ? valueWithDelta / totalValue : 0;

  return {
    portfolioDelta: portfolioDelta != null ? Number(portfolioDelta.toFixed(2)) : null,
    portfolioDeltaFlipped: portfolioDeltaFlipped != null ? Number(portfolioDeltaFlipped.toFixed(2)) : null,
    sensitivity: sensitivity != null ? Number(sensitivity.toFixed(2)) : null,
    contributors: contributors.slice(0, 5),
    coverage: Number(coverage.toFixed(2)),
    holdingCount: rows.length,
    currentTemp: temp,
    flippedTemp,
  };
}

// 敏感度 → 文案 key（让 UI 通过 t() 翻译）
export function sensitivityLabel(s) {
  if (s == null) return null;
  if (s < 2) return "组合对 regime 切换不敏感";
  if (s < 5) return "组合对 regime 切换中等敏感";
  return "组合对 regime 切换高度敏感";
}
