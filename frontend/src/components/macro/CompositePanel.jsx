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

// v5 编辑式：把综合温度映射到 L1-L5 阶梯
// 与 TEMP_LABEL 不同：这里是「稳定性 / regime risk」语义（两端都是风险，L3 中段是 sweet spot），
// 而 TEMP_LABEL 是「方向化牛熊」语义（高=牛，低=熊）。两个并存。
function tempLevel(t) {
  if (t == null) return null;
  if (t < 20) return 0;     // L1 冰冻
  if (t < 40) return 1;     // L2 偏冷
  if (t < 65) return 2;     // L3 温和（sweet spot）
  if (t < 85) return 3;     // L4 偏热
  return 4;                  // L5 过热
}
const LEVELS = [
  { id: "L1", label: "冰冻", color: "rgba(255,107,107,0.55)", textCls: "text-red-300" },
  { id: "L2", label: "偏冷", color: "rgba(245,181,60,0.55)", textCls: "text-amber-300" },
  { id: "L3", label: "温和", color: "rgba(30,211,149,0.65)", textCls: "text-emerald-300" },
  { id: "L4", label: "偏热", color: "rgba(245,181,60,0.55)", textCls: "text-amber-300" },
  { id: "L5", label: "过热", color: "rgba(255,107,107,0.55)", textCls: "text-red-300" },
];

// 跃迁预警：距下一级边界 ≤ 3 分时提示「可能进入 LX」
function nextBoundary(t) {
  if (t == null) return null;
  const bounds = [20, 40, 65, 85];
  for (const b of bounds) {
    if (t < b && b - t <= 3) {
      const nextL = bounds.indexOf(b) + 1; // 0->L2(idx1), 1->L3(idx2), ...
      return { dir: "up", nextLevelIdx: nextL };
    }
    if (t >= b && t - b <= 3) {
      const nextL = bounds.indexOf(b); // 0->L1(idx0), boundary just crossed
      return { dir: "down", nextLevelIdx: nextL };
    }
  }
  return null;
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

  const curLevel = tempLevel(temp);
  const boundary = nextBoundary(temp);

  return (
    <div className={PANEL.primary}>
      <div className="flex items-start gap-6 flex-wrap">
        {/* v5 编辑式：市场温度 hero — 大字号 serif + L1-L5 阶梯 + 跃迁预警 */}
        <div className="flex-1 min-w-[260px]">
          <div className="text-[10px] text-white/55 mb-2 uppercase tracking-wider font-mono">{t("市场温度（综合 17 因子方向化加权）")}</div>
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <span className={`t-hero-lg font-serif tabular-nums ${TEMP_TEXT(temp)}`}>
              {temp != null ? temp.toFixed(0) : "—"}
            </span>
            <span className="text-white/35 text-sm font-mono">/ 100</span>
            <span className={`text-sm font-medium ${TEMP_TEXT(temp)}`}>
              {t(TEMP_LABEL(temp))}
            </span>
            <WowBadge delta={tempDelta} t={t} />
          </div>

          {/* L1-L5 五段阶梯 — 当前段高亮 + glow */}
          {temp != null && (
            <div className="flex gap-1 mt-3">
              {LEVELS.map((lv, i) => {
                const active = i === curLevel;
                return (
                  <div
                    key={lv.id}
                    className="flex-1 py-1.5 px-1 text-center rounded-md border transition-all"
                    style={{
                      background: active ? lv.color : "rgba(255,255,255,0.03)",
                      borderColor: active ? lv.color.replace(/0\.\d+/, "0.6") : "rgba(255,255,255,0.06)",
                      boxShadow: active ? `0 0 14px ${lv.color}` : "none",
                    }}
                    title={`${lv.id} ${t(lv.label)}`}
                  >
                    <div className={`text-[10px] font-mono font-bold ${active ? lv.textCls : "text-white/35"}`}>{lv.id}</div>
                    <div className={`text-[9px] mt-0.5 ${active ? "text-white/85" : "text-white/30"}`}>{t(lv.label)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 跃迁预警 */}
          {boundary && temp != null && (
            <div className="mt-2 px-2 py-1 rounded-md bg-amber-500/8 border border-amber-400/25 text-[10px] text-amber-200 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-breathe" />
              <span>
                {t("距")} <b className="font-mono">{LEVELS[boundary.nextLevelIdx]?.id}</b>{" "}
                {t("边界仅")} <span className="font-mono">{Math.abs(temp - [20, 40, 65, 85][boundary.nextLevelIdx === 0 ? 0 : boundary.nextLevelIdx - 1]).toFixed(1)}</span>{" "}
                {t("分，可能进入")} <b>{t(LEVELS[boundary.nextLevelIdx]?.label || "")}</b>
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
