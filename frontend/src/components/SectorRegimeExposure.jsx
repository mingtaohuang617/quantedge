import React from "react";
import { Layers, AlertTriangle } from "lucide-react";
import { useLang } from "../i18n.jsx";
import { sectorRegimeExposure } from "../lib/sectorRegimeExposure.js";

// Sector × regime 暴露 — 按板块聚合持仓，每个板块算 weight + avg Δ + 风险分
//
// 警示触发：单板块权重 ≥ 20% 且 |avg Δ| ≥ 3 → 顶部高亮"集中暴露"
// 表格按 risk score 降序，最值得关注的在最上面
export default function SectorRegimeExposure({ entries, liveStocks, temp }) {
  const { t } = useLang();
  const r = sectorRegimeExposure(entries, liveStocks, temp);
  if (!r || r.sectors.length === 0) return null;

  return (
    <div className="glass-card p-3 md:p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers size={12} className="text-indigo-400" />
          <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>
            {t('板块 × Regime 暴露')}
          </span>
          <span className="text-[10px] text-[#a0aec0]">
            {r.sectors.length} {t('个板块')}
          </span>
        </div>
      </div>

      {/* 集中暴露警示 */}
      {r.flag && (
        <div className={`flex items-start gap-2 mb-2 px-2 py-1.5 rounded text-[10px] leading-relaxed border ${
          r.flag.direction === 'headwind'
            ? 'bg-rose-500/10 border-rose-400/30 text-rose-200'
            : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
        }`}>
          <AlertTriangle size={11} className="shrink-0 mt-0.5 opacity-80" />
          <div className="min-w-0">
            <span className="font-medium">{t(r.flag.sector)}</span>
            <span className="opacity-85"> {t('占组合')} </span>
            <span className="font-mono font-bold">{r.flag.weight.toFixed(0)}%</span>
            <span className="opacity-85"> · </span>
            <span className="font-mono font-bold">
              {r.flag.avgDelta > 0 ? '+' : ''}{r.flag.avgDelta.toFixed(1)}
            </span>
            <span className="opacity-85">
              {' · '}
              {r.flag.direction === 'headwind'
                ? t('当前 regime 不利，考虑分散')
                : t('当前 regime 顺风，仓位结构良好')}
            </span>
          </div>
        </div>
      )}

      {/* 表头 */}
      <div className="grid grid-cols-[1fr_3rem_3rem_3rem] gap-2 text-[9px] text-[#a0aec0] uppercase mb-1 px-1">
        <span>{t('板块')}</span>
        <span className="text-right">{t('权重')}</span>
        <span className="text-right">{t('平均 Δ')}</span>
        <span className="text-right">{t('风险分')}</span>
      </div>

      {/* 行 */}
      <div className="space-y-0.5">
        {r.sectors.slice(0, 8).map(s => (
          <div
            key={s.sector}
            className="grid grid-cols-[1fr_3rem_3rem_3rem] gap-2 text-[10px] font-mono items-center px-1 py-0.5 hover:bg-white/[0.02] rounded"
            title={s.stocks.map(st => `${st.ticker} ${st.delta != null ? (st.delta > 0 ? '+' : '') + st.delta.toFixed(1) : '—'}`).join("\n")}
          >
            <span className="text-white/85 truncate font-sans">{t(s.sector)}</span>
            <span className="text-white/55 text-right tabular-nums">{s.weight.toFixed(0)}%</span>
            <span className={`text-right tabular-nums ${
              s.avgDelta == null ? 'text-white/30'
              : s.avgDelta > 0 ? 'text-emerald-400'
              : s.avgDelta < 0 ? 'text-rose-400' : 'text-white/60'
            }`}>
              {s.avgDelta == null ? '—' : `${s.avgDelta > 0 ? '+' : ''}${s.avgDelta.toFixed(1)}`}
            </span>
            <span className="text-white/45 text-right tabular-nums">
              {s.riskScore > 0 ? s.riskScore.toFixed(2) : '—'}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[9px] text-white/30 mt-2">
        {t('风险分 = 板块权重 × |平均 Δ|，反映该板块对组合表现的潜在拉动')}
      </div>
    </div>
  );
}
