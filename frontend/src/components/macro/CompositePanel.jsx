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

// v5 编辑式：L1-L5 阶梯 — 5 段分级映射，让"regime 跃迁"成为可读信号
// 按 QuantEdge 现有 bull-bear 线性语义（与 TEMP_LABEL 一致）：
//   L1 [0,20)  极熊  red
//   L2 [20,40) 偏熊  orange/amber
//   L3 [40,60) 中性  slate
//   L4 [60,80) 偏牛  lime
//   L5 [80,100] 极牛 emerald
const LADDER = [
  { id: "L1", lo: 0,  hi: 20,  label: "极熊", color: "rgba(255,107,107", textColor: "text-red-300",    border: "rgba(255,107,107,0.4)" },
  { id: "L2", lo: 20, hi: 40,  label: "偏熊", color: "rgba(251,146,60",  textColor: "text-orange-300", border: "rgba(251,146,60,0.4)"  },
  { id: "L3", lo: 40, hi: 60,  label: "中性", color: "rgba(148,163,184", textColor: "text-slate-300",  border: "rgba(148,163,184,0.4)" },
  { id: "L4", lo: 60, hi: 80,  label: "偏牛", color: "rgba(132,204,22",  textColor: "text-lime-300",   border: "rgba(132,204,22,0.4)"  },
  { id: "L5", lo: 80, hi: 100, label: "极牛", color: "rgba(30,211,149",  textColor: "text-emerald-300",border: "rgba(30,211,149,0.4)"  },
];

function findLadderIdx(temp) {
  if (temp == null) return -1;
  for (let i = 0; i < LADDER.length; i++) {
    if (temp >= LADDER[i].lo && temp < LADDER[i].hi) return i;
  }
  return temp >= 100 ? LADDER.length - 1 : -1;
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
  // v5 L1-L5 阶梯定位 + 跃迁预警（接近边界 5 内 → 提示"可能进入下一阶"）
  const ladderIdx = findLadderIdx(temp);
  const nearBoundary = temp != null && ladderIdx >= 0 && ladderIdx < LADDER.length - 1
    && (LADDER[ladderIdx].hi - temp) <= 5;

  return (
    <div className={PANEL.primary}>
      <div className="flex items-start gap-6 flex-wrap">
        {/* 市场温度大数字 — v5 编辑式 60px serif */}
        <div className="flex-1 min-w-[240px]">
          <div className="t-eyebrow mb-2">{t("市场温度（综合 17 因子方向化加权）")}</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`text-6xl font-serif font-semibold tabular-nums leading-none ${TEMP_TEXT(temp)}`}>
              {temp != null ? temp.toFixed(0) : "—"}
            </span>
            <span className="text-white/40 text-sm">/ 100</span>
            <span className={`text-sm font-medium ${TEMP_TEXT(temp)}`}>
              {t(TEMP_LABEL(temp))}
            </span>
            <WowBadge delta={tempDelta} t={t} />
          </div>
          {/* v5 L1-L5 阶梯（替换平面 progress） */}
          <div className="mt-4 flex gap-1">
            {LADDER.map((seg, i) => {
              const active = i === ladderIdx;
              return (
                <div
                  key={seg.id}
                  className="flex-1 rounded-md text-center transition-all"
                  style={{
                    padding: "6px 2px",
                    background: active ? `${seg.color},0.18)` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? seg.border : "rgba(255,255,255,0.05)"}`,
                    boxShadow: active ? `0 0 14px ${seg.color},0.22)` : "none",
                  }}
                  title={`${seg.id} · ${t(seg.label)} · ${seg.lo}–${seg.hi}`}
                >
                  <div className={`text-[10px] font-mono font-bold ${active ? seg.textColor : "text-white/30"}`}>{seg.id}</div>
                  <div className={`text-[9px] mt-0.5 ${active ? "text-white/85" : "text-white/30"}`}>{t(seg.label)}</div>
                </div>
              );
            })}
          </div>
          {/* 跃迁预警 — v5 "可能进入 L4" 范式 */}
          {nearBoundary && (
            <div
              className="mt-2 px-2.5 py-1.5 rounded-md text-[10.5px] flex items-center gap-2"
              style={{
                background: "rgba(245,181,60,0.06)",
                border: "1px solid rgba(245,181,60,0.18)",
                color: "var(--accent-amber)",
              }}
            >
              <span className="live-dot" style={{ background: "var(--accent-amber)" }} />
              <span>
                {t("接近边界")} · {temp.toFixed(1)} → {t("可能进入")} <b>{LADDER[ladderIdx + 1].id} {t(LADDER[ladderIdx + 1].label)}</b>
              </span>
            </div>
          )}
        </div>

        {/* 4 类子分 — min-w-0 + min-w-[280px] sm 让窄屏不溢出（原 400px 在 320 屏会横向滚动） */}
        <div className="flex-[2] min-w-0 sm:min-w-[280px] grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
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
