import React from "react";
import { useLang } from "../../i18n.jsx";
import { CATEGORY_LABEL, TEMP_BAR, TEMP_TEXT, TEMP_LABEL, PANEL, wowDelta } from "./shared.js";

// 渲染 ±X.X 周环比 Δ 徽章；无数据 → 不渲染
function WowBadge({ delta, t }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={`text-[10px] font-mono tabular-nums ${up ? "text-emerald-300" : "text-rose-300"}`}
      title={t("近 5 个交易日 (WoW) 变化")}
    >
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
    </span>
  );
}

// L3 综合温度大数字 + 4 子分卡片（不再嵌入 HMM/Survival，那两个改成顶层 sibling panel）
// history 用于计算 WoW Δ；可选 — 不传则不渲染 Δ 徽章
export default function CompositePanel({ data, history }) {
  const { t } = useLang();
  if (!data) return null;
  const temp = data.market_temperature;
  const cats = data.by_category || {};
  const order = ["valuation", "liquidity", "sentiment", "breadth"];
  const tempDelta = wowDelta(history, "temp");

  return (
    <div className={PANEL.primary}>
      <div className="flex items-start gap-6 flex-wrap">
        {/* 市场温度大数字 */}
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-white/55 mb-1.5">{t("市场温度（综合 17 因子方向化加权）")}</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`text-5xl font-mono font-bold tabular-nums ${TEMP_TEXT(temp)}`}>
              {temp != null ? temp.toFixed(1) : "—"}
            </span>
            <span className="text-white/40 text-sm">/ 100</span>
            <span className={`text-sm font-medium ${TEMP_TEXT(temp)}`}>
              {t(TEMP_LABEL(temp))}
            </span>
            <WowBadge delta={tempDelta} t={t} />
          </div>
          <div className="mt-3 h-2 bg-white/[0.05] rounded-full overflow-hidden">
            {temp != null && (
              <div className={`h-full rounded-full ${TEMP_BAR(temp)}`} style={{ width: `${Math.max(2, temp)}%` }} />
            )}
          </div>
          <div className="mt-2 text-[10px] text-white/40 flex justify-between font-mono">
            <span>0 {t("极熊")}</span><span>50 {t("中性")}</span><span>100 {t("极牛")}</span>
          </div>
        </div>

        {/* 4 类子分 */}
        <div className="flex-[2] min-w-[400px] grid grid-cols-2 sm:grid-cols-4 gap-3">
          {order.map(cat => {
            const info = cats[cat];
            const score = info?.score;
            const w = data.weights?.[cat];
            const labelKey = CATEGORY_LABEL[cat] || cat;
            const catDelta = wowDelta(history, cat);
            return (
              <div key={cat} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-white/60 font-medium">{t(labelKey)}</span>
                  <span className="text-[10px] text-white/35 font-mono">w{w != null ? Math.round(w*100) : "?"}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <div className={`text-2xl font-mono font-semibold tabular-nums ${TEMP_TEXT(score)}`}>
                    {score != null ? score.toFixed(1) : "—"}
                  </div>
                  <WowBadge delta={catDelta} t={t} />
                </div>
                <div className="mt-1.5 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                  {score != null && (
                    <div className={`h-full rounded-full ${TEMP_BAR(score)}`} style={{ width: `${Math.max(2, score)}%` }} />
                  )}
                </div>
                <div className="text-[10px] text-white/40 mt-1.5">
                  {info?.factor_count ?? 0} {t("因子均值")}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
