import React from "react";
import { Briefcase, ArrowRightLeft } from "lucide-react";
import { useLang } from "../i18n.jsx";
import { TEMP_TEXT, TEMP_LABEL } from "./macro/shared.js";
import { portfolioMacroSensitivity, sensitivityLabel } from "../lib/macroPortfolio.js";

// 组合宏观敏感度卡 — 当前 regime 下加权 Δ + 翻转后模拟 + 最敏感持仓
//
// 用户场景：journal 里有几只票，想知道"如果牛市突然转熊，组合理论上会怎样"
// 这卡不是真实回测（只用 sub-score 风格契合度做粗估），但能高亮哪些票最暴露在
// 风格因子上，便于做 hedging / 调仓决策。
//
// 不渲染条件：temp 缺、无持仓、所有持仓都是 ETF（无 sub-scores）
export default function PortfolioMacroSensitivity({ entries, liveStocks, temp }) {
  const { t } = useLang();
  const r = portfolioMacroSensitivity(entries, liveStocks, temp);
  if (!r) return null;
  if (r.portfolioDelta == null) return null;  // 全是 ETF，无意义

  const cur = r.portfolioDelta;
  const flip = r.portfolioDeltaFlipped;
  const sens = r.sensitivity;
  const tempLabel = t(TEMP_LABEL(temp));
  const flippedLabel = t(TEMP_LABEL(r.flippedTemp));
  const sensKey = sensitivityLabel(sens);

  return (
    <div className="glass-card p-3 md:p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Briefcase size={12} className="text-indigo-400" />
          <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>
            {t('组合宏观敏感度')}
          </span>
          <span className="text-[10px] text-[#a0aec0]">
            {r.holdingCount} {t('个有股数持仓')} · {t('覆盖率')} {Math.round(r.coverage * 100)}%
          </span>
        </div>
      </div>

      {/* 双列：当前 vs flipped */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
          <div className="text-[9px] text-[#a0aec0] uppercase">{t('当前 regime')}</div>
          <div className={`text-base font-bold font-mono ${TEMP_TEXT(temp)}`}>
            {temp.toFixed(0)} <span className="text-[10px] font-normal">{tempLabel}</span>
          </div>
          <div className="text-[10px] text-[#a0aec0] mt-0.5">{t('组合加权 Δ')}</div>
          <div className={`text-lg font-mono tabular-nums font-bold ${cur > 0 ? 'text-emerald-400' : cur < 0 ? 'text-rose-400' : 'text-white/60'}`}>
            {cur > 0 ? '+' : ''}{cur.toFixed(1)}
          </div>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
          <div className="text-[9px] text-[#a0aec0] uppercase flex items-center gap-1">
            <ArrowRightLeft size={9} /> {t('翻转模拟')}
          </div>
          <div className={`text-base font-bold font-mono ${TEMP_TEXT(r.flippedTemp)}`}>
            {r.flippedTemp.toFixed(0)} <span className="text-[10px] font-normal">{flippedLabel}</span>
          </div>
          <div className="text-[10px] text-[#a0aec0] mt-0.5">{t('翻转后 Δ')}</div>
          <div className={`text-lg font-mono tabular-nums font-bold ${flip > 0 ? 'text-emerald-400' : flip < 0 ? 'text-rose-400' : 'text-white/60'}`}>
            {flip > 0 ? '+' : ''}{flip.toFixed(1)}
          </div>
        </div>
      </div>

      {/* 敏感度结论 */}
      {sens != null && sensKey && (
        <div className={`text-[11px] mb-2 px-2 py-1 rounded ${
          sens >= 5 ? 'bg-rose-500/10 text-rose-200' :
          sens >= 2 ? 'bg-amber-500/10 text-amber-200' :
          'bg-emerald-500/10 text-emerald-200'
        }`}>
          {t(sensKey)} · |Δ_flip − Δ_cur| = {sens.toFixed(1)}
        </div>
      )}

      {/* Top contributors */}
      {r.contributors.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[10px] text-[#a0aec0] mb-1">{t('风格因子最大暴露')}</div>
          {r.contributors.slice(0, 3).map(c => (
            <div key={c.ticker} className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-white/80 w-16 truncate">{c.ticker}</span>
              <span className="text-white/50 flex-1 truncate text-[9px]">{c.name}</span>
              <span className={`tabular-nums ${c.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {c.delta > 0 ? '+' : ''}{c.delta.toFixed(1)}
              </span>
              <span className="text-white/40 tabular-nums w-12 text-right">
                {(c.value / r.contributors.reduce((s, x) => s + x.value, 0) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="text-[9px] text-white/30 mt-2">
        {t('翻转模拟 = temp 围绕 50 镜像；不是真实回测，仅做风格因子敞口粗估')}
      </div>
    </div>
  );
}
