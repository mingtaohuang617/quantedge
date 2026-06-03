import React from "react";
import { ChevronLeft } from "lucide-react";

/**
 * MobileAppBar — 下钻页面（全屏个股卡 / 研究报告 / 时间线详情…）的顶部栏。
 * 返回箭头 + 标题（可带 chips）+ 右侧操作；sticky，毛玻璃。
 */
export default function MobileAppBar({
  onBack,
  title,
  chips,
  actions,
  backLabel = "返回",
  className = "",
}) {
  return (
    <div
      className={`sticky top-0 z-20 flex items-center gap-2.5 h-[46px] px-3 border-b ${className}`}
      style={{
        borderColor: "var(--line)",
        background: "color-mix(in srgb, var(--bg-1) 78%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          aria-label={backLabel}
          className="-ml-1 p-1 active:scale-90 transition"
          style={{ color: "var(--fg-1)" }}
        >
          <ChevronLeft size={22} />
        </button>
      )}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {typeof title === "string"
          ? <span className="text-[15px] font-bold truncate" style={{ color: "var(--fg-0)" }}>{title}</span>
          : title}
        {chips}
      </div>
      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
