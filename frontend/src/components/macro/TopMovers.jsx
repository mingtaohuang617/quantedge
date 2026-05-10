import React, { useMemo } from "react";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";
import { useLang } from "../../i18n.jsx";
import {
  PANEL, bullishContribution, directionalScore,
  CATEGORY_LABEL, CATEGORY_COLOR,
} from "./shared.js";

// 当前哪些因子在拉牛 / 拉熊 — 基于每个因子的 directional_score 偏离中性 50
//
// 三栏：
//   1. 拉动牛势 — 偏离 50 最多的正贡献因子（top 3）
//   2. 拉动熊势 — 偏离 50 最负的因子（bottom 3）
//   3. 极端反向 — contrarian 因子（如 VIX/SKEW）当前在极端区（pct<10 或 >90），
//      意味着情绪极端，按规则反向解读
//
// 数据需求：每个因子的 latest.percentile + direction + contrarian_at_extremes（已在 snapshot 中）
export default function TopMovers({ factors }) {
  const { t } = useLang();

  const { topBull, topBear, contrarianAlerts } = useMemo(() => {
    if (!factors || factors.length === 0) return { topBull: [], topBear: [], contrarianAlerts: [] };
    const enriched = factors
      .map(f => ({
        f,
        contrib: bullishContribution(f),
        score: directionalScore(f),
        pct: f.latest?.percentile,
      }))
      .filter(x => x.contrib != null);

    const topBull = [...enriched].sort((a, b) => b.contrib - a.contrib).slice(0, 3).filter(x => x.contrib > 0);
    const topBear = [...enriched].sort((a, b) => a.contrib - b.contrib).slice(0, 3).filter(x => x.contrib < 0);

    const contrarianAlerts = factors.filter(f =>
      f.contrarian_at_extremes &&
      f.latest?.percentile != null &&
      (f.latest.percentile < 10 || f.latest.percentile > 90)
    ).slice(0, 4);

    return { topBull, topBear, contrarianAlerts };
  }, [factors]);

  if (!topBull.length && !topBear.length && !contrarianAlerts.length) return null;

  const Row = ({ x, mode }) => {
    const f = x.f || x;
    const pct = (x.f ? x.pct : f.latest?.percentile);
    const score = x.score ?? directionalScore(f);
    return (
      <div className="flex items-center gap-2 text-[11px] py-0.5">
        <span className={`px-1 py-0.5 rounded text-[9px] font-medium border ${CATEGORY_COLOR[f.category] || ""}`}>
          {t(CATEGORY_LABEL[f.category] || f.category)}
        </span>
        <span className="font-mono text-white/85 truncate flex-1" title={f.name}>{f.factor_id}</span>
        <span className="font-mono tabular-nums text-white/55 text-[10px]">
          {pct != null ? `${pct.toFixed(0)}%` : "—"}
        </span>
        {mode !== "contrarian" && score != null && (
          <span className={`font-mono tabular-nums w-9 text-right text-[10px] font-semibold ${
            mode === "bull" ? "text-emerald-300" : "text-rose-300"
          }`}>
            {mode === "bull" ? "+" : ""}{(score - 50).toFixed(0)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={PANEL.secondary}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-white/85">{t("当下推动力")}</span>
        <span className="text-[10px] text-white/40">{t("基于每个因子的方向化分数偏离 50")}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 拉牛 */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300 font-medium mb-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{t("拉动牛势")}</span>
            <span className="text-white/35 font-mono ml-auto text-[10px]">+ score</span>
          </div>
          {topBull.length > 0 ? (
            topBull.map(x => <Row key={`${x.f.factor_id}@${x.f.market}`} x={x} mode="bull" />)
          ) : (
            <div className="text-[10px] text-white/35 italic py-1">{t("无明显拉牛因子")}</div>
          )}
        </div>
        {/* 拉熊 */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300 font-medium mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            <span>{t("拉动熊势")}</span>
            <span className="text-white/35 font-mono ml-auto text-[10px]">− score</span>
          </div>
          {topBear.length > 0 ? (
            topBear.map(x => <Row key={`${x.f.factor_id}@${x.f.market}`} x={x} mode="bear" />)
          ) : (
            <div className="text-[10px] text-white/35 italic py-1">{t("无明显拉熊因子")}</div>
          )}
        </div>
        {/* 极端反向 */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-300 font-medium mb-1">
            <Zap className="w-3.5 h-3.5" />
            <span>{t("极端反向警示")}</span>
            <span className="text-white/35 font-mono ml-auto text-[10px]">|pct|&gt;90 / &lt;10</span>
          </div>
          {contrarianAlerts.length > 0 ? (
            contrarianAlerts.map(f => <Row key={`${f.factor_id}@${f.market}`} x={f} mode="contrarian" />)
          ) : (
            <div className="text-[10px] text-white/35 italic py-1">{t("情绪未到极端")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
