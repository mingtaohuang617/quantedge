import React from "react";
import { useLang } from "../../i18n.jsx";
import { PANEL, HMM_COLOR } from "./shared.js";

// L4 持续期预测面板（Kaplan-Meier）
export default function SurvivalPanel({ s }) {
  const { t } = useLang();
  if (!s || s.error) return null;
  const cn = s.current_regime === "bull" ? t(HMM_COLOR.bull.label)
    : s.current_regime === "bear" ? t(HMM_COLOR.bear.label) : s.current_regime;
  const tone = s.current_regime === "bull" ? HMM_COLOR.bull.text
    : s.current_regime === "bear" ? HMM_COLOR.bear.text : "text-slate-300";
  const probs = s.prob_continue || {};

  const probBar = (p) => {
    if (p == null) return null;
    const pct = Math.round(p * 100);
    let color = "bg-slate-400";
    if (pct >= 70) color = "bg-emerald-400/70";
    else if (pct >= 40) color = "bg-amber-400/70";
    else if (pct > 0) color = "bg-orange-400/70";
    return (
      <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    );
  };

  return (
    <div className={PANEL.secondary}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/85">{t("L4 持续期预测")}</span>
          <span className="text-[10px] text-white/45">Kaplan-Meier · {s.n_past_same_segments} {t("段历史")} {cn} {t("市")}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        {/* 当前 + 历史对比 */}
        <div className="flex-1 min-w-[260px]">
          <div className="text-[11px] text-white/55 mb-1">{t("当前")} {cn} {t("市已持续")}</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-mono font-bold tabular-nums ${tone}`}>
              {s.current_duration_days}
            </span>
            <span className="text-xs text-white/45">{t("交易日 ≈")} {(s.current_duration_days / 252).toFixed(1)} {t("年")}</span>
          </div>
          <div className="text-[11px] text-white/55 mt-2">
            {t("历史同类分位")} <span className="font-mono text-white/85">{s.current_duration_pct_rank}%</span>
            <span className="text-white/40"> · {t("中位数")} </span>
            <span className="font-mono text-white/75">{s.median_past_days}d</span>
            <span className="text-white/40"> · {t("最长")} </span>
            <span className="font-mono text-white/75">{s.max_past_days}d</span>
          </div>
        </div>

        {/* 3 个 horizon 条件概率 */}
        <div className="flex-1 min-w-[280px]">
          <div className="text-[11px] text-white/55 mb-2">{t("再持续 N 期的条件概率")}</div>
          <div className="space-y-2">
            {[["3M", "3 个月"], ["6M", "6 个月"], ["12M", "1 年"]].map(([k, label]) => {
              const p = probs[k];
              return (
                <div key={k}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-white/55">{t(label)}</span>
                    <span className="font-mono tabular-nums text-white/85">
                      {p != null ? `${(p * 100).toFixed(0)}%` : "—"}
                    </span>
                  </div>
                  {probBar(p)}
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-white/35 mt-2">
            注：n={s.n_past_same_segments + 1} 小样本，仅供参考；下一拐点需新 event 确认
          </div>
        </div>
      </div>
    </div>
  );
}
