import React from "react";
import { MiniSparkline } from "../../quant-platform.jsx";
import {
  CATEGORY_LABEL, CATEGORY_COLOR, PCT_BAR_BG, PCT_TEXT,
  DIRECTION_BADGE, fmtRaw, daysSince,
} from "./shared.js";

// 单因子卡片：分类徽章 + 方向徽章 + 原值 + sparkline + 分位条 + 描述
// React.memo 避免 filter 切换时全量重渲（23 卡 × DOM）
function FactorCard({ f }) {
  const pct = f.latest?.percentile;
  const sparkValues = f.sparkline?.values || [];
  const since = daysSince(f.latest?.value_date);
  const dirBadge = DIRECTION_BADGE(f.direction, f.contrarian_at_extremes);

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 hover:border-indigo-400/30 transition-colors flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLOR[f.category] || ""}`}>
            {CATEGORY_LABEL[f.category] || f.category}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${dirBadge.cls} cursor-help select-none`}
            title={dirBadge.title}
          >
            <span className="font-mono mr-0.5">{dirBadge.icon}</span>
            {dirBadge.label}
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono shrink-0">
          {f.market} · {f.freq}
        </span>
      </div>

      <div className="text-sm font-mono font-semibold text-white/90 mb-1">
        {f.factor_id}
      </div>
      <div className="text-[11px] text-white/55 mb-3 line-clamp-2 leading-relaxed min-h-[28px]">
        {f.name}
      </div>

      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="text-2xl font-mono font-semibold text-white tabular-nums">
          {fmtRaw(f.latest?.raw_value)}
        </div>
        {sparkValues.length >= 2 && (
          <MiniSparkline data={sparkValues} w={92} h={30} />
        )}
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/50">历史分位</span>
          <span className={`font-mono ${PCT_TEXT(pct)} font-semibold`}>
            {pct != null ? `${pct.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
          {pct != null && (
            <div
              className={`h-full rounded-full ${PCT_BAR_BG(pct)}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          )}
        </div>
      </div>

      <div className="text-[10px] text-white/40 mb-2 font-mono">
        最后值: {f.latest?.value_date || "—"}
        {since != null && ` (${since}天前)`}
      </div>
      <div className="text-[11px] text-white/55 line-clamp-3 leading-relaxed flex-1">
        {f.description}
      </div>
    </div>
  );
}

export default React.memo(FactorCard);
