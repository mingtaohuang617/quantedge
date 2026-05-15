import React from "react";
import { useLang } from "../i18n.jsx";
import { macroDelta, macroAdjustExplain } from "../lib/macroAdjust.js";

// 在评分旁边显示宏观调整 Δ 徽章 — ▲+3.2 / ▼-2.1，hover 显示解读
// 三种 size：xs（列表内）/ sm（详情头）/ md（卡片）
//
// 不渲染条件：
//   - temp 缺失（snapshot 没数据）
//   - stock 缺 sub-scores（ETF / 数据残缺）
//   - |Δ| < 0.5（视为噪声）
export default function MacroAdjustBadge({ stock, temp, size = "xs" }) {
  const { t } = useLang();
  const delta = macroDelta(stock, temp);
  if (delta == null || Math.abs(delta) < 0.5) return null;

  const up = delta > 0;
  const explain = macroAdjustExplain(stock, temp);
  const title = explain
    ? `${t(explain)}（${up ? "+" : ""}${delta.toFixed(1)}）`
    : `${t("宏观调整")} ${up ? "+" : ""}${delta.toFixed(1)}`;

  const sizeCls = size === "xs"
    ? "text-[9px] gap-0.5"
    : size === "sm"
    ? "text-[10px] gap-1"
    : "text-[11px] gap-1 px-1 py-0.5 rounded border border-white/10";

  return (
    <span
      className={`inline-flex items-center font-mono tabular-nums ${sizeCls} ${
        up ? "text-emerald-400" : "text-rose-400"
      }`}
      title={title}
    >
      <span>{up ? "▲" : "▼"}</span>
      <span>{Math.abs(delta).toFixed(1)}</span>
    </span>
  );
}
