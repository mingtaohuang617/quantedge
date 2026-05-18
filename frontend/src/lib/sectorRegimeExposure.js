// Sector × regime 暴露分析
//
// 把组合的 sector 集中度 × 各 sector 平均风格 Δ 结合，告诉用户：
// "你在 tech 仓位很重，当前是 bear regime，这个 sector 整体逆风 — 注意。"
//
// 算法：
//   1. 每只持仓 → 其 sector 标签 + position value + macroDelta
//   2. 按 sector 分组 → 计算 weight%、avgDelta（value-weighted）、stockCount
//   3. risk score = weight% × |avgDelta|（值越大表示越值得关注）
//   4. 排序：risk score 降序
//
// 不渲染：temp 缺、entries 空、liveStocks 空、所有 sector 都没有 sub-scores
import { macroDelta } from "./macroAdjust.js";

export function sectorRegimeExposure(entries, liveStocks, temp) {
  if (temp == null) return null;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!Array.isArray(liveStocks)) liveStocks = [];

  const stockByTicker = new Map(liveStocks.map(s => [s.ticker, s]));

  let totalValue = 0;
  const sectorAgg = new Map();  // sector → { value, weightedDelta, valueWithDelta, count, stocks }

  for (const e of entries) {
    const shares = Number(e?.shares) || 0;
    if (shares <= 0) continue;
    const price = Number(e?.currentPrice) || Number(e?.anchorPrice) || 0;
    if (price <= 0) continue;
    const stk = stockByTicker.get(e.ticker);
    if (!stk) continue;
    const sector = (stk.sector || e.sector || "未分类").split("/")[0];  // 取主 sector（"Tech/AI" → "Tech"）
    const value = shares * price;
    totalValue += value;
    const delta = macroDelta(stk, temp);
    const agg = sectorAgg.get(sector) || {
      sector, value: 0, weightedDelta: 0, valueWithDelta: 0,
      count: 0, stocks: [],
    };
    agg.value += value;
    agg.count += 1;
    agg.stocks.push({ ticker: e.ticker, name: e.name || stk.name, value, delta });
    if (delta != null) {
      agg.weightedDelta += value * delta;
      agg.valueWithDelta += value;
    }
    sectorAgg.set(sector, agg);
  }

  if (totalValue === 0 || sectorAgg.size === 0) return null;

  const sectors = Array.from(sectorAgg.values()).map(s => {
    const weight = s.value / totalValue;
    const avgDelta = s.valueWithDelta > 0 ? s.weightedDelta / s.valueWithDelta : null;
    const riskScore = avgDelta != null ? weight * Math.abs(avgDelta) : 0;
    return {
      sector: s.sector,
      weight: Number((weight * 100).toFixed(1)),
      avgDelta: avgDelta != null ? Number(avgDelta.toFixed(2)) : null,
      riskScore: Number(riskScore.toFixed(3)),
      count: s.count,
      // 排序每个 sector 内部的票 by |delta|
      stocks: s.stocks.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)).slice(0, 3),
    };
  });

  // 按 risk score 降序（最值得关注的在前）
  sectors.sort((a, b) => b.riskScore - a.riskScore);

  // 整体警示：最大 risk 的 sector
  const top = sectors[0];
  const flag = top && top.avgDelta != null && Math.abs(top.avgDelta) >= 3 && top.weight >= 20
    ? {
        sector: top.sector,
        weight: top.weight,
        avgDelta: top.avgDelta,
        direction: top.avgDelta < 0 ? "headwind" : "tailwind",
      }
    : null;

  return { sectors, flag, currentTemp: temp };
}
