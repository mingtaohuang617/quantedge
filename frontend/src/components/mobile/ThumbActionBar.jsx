import React from "react";

/**
 * ThumbActionBar — 底部「拇指热区」常驻操作条。
 * 主操作用渐变实心按钮，次操作为方形图标按钮；安全区内边距。
 *
 *  <ThumbActionBar
 *    secondary={[{ icon:<Star/>, label:"自选", onClick }, { icon:<ArrowLeftRight/>, label:"切换", onClick }]}
 *    primary={{ icon:<Bell/>, label:"设置提醒", onClick }}
 *  />
 *
 * 也可直接传 children 完全自定义。sticky 默认贴在滚动容器底部。
 */
export default function ThumbActionBar({
  primary,
  secondary = [],
  children,
  sticky = true,
  className = "",
}) {
  return (
    <div
      className={`${sticky ? "sticky" : "fixed"} bottom-0 left-0 right-0 z-30 flex items-center gap-2.5 px-3.5 pt-2.5 border-t ${className}`}
      style={{
        borderColor: "var(--line)",
        background: "linear-gradient(180deg, transparent, var(--bg-0) 42%)",
        backdropFilter: "blur(14px)",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
      }}
    >
      {children || (
        <>
          {secondary.map((b, i) => (
            <button
              key={i}
              onClick={b.onClick}
              aria-label={b.label}
              disabled={b.disabled}
              className="w-[46px] h-[46px] shrink-0 rounded-xl border flex items-center justify-center active:scale-95 transition disabled:opacity-40"
              style={{ borderColor: "var(--line-2)", background: "rgba(255,255,255,.04)", color: "var(--fg-1)" }}
            >
              {b.icon}
            </button>
          ))}
          {primary && (
            <button
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="flex-1 h-[46px] rounded-xl text-white text-[14.5px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50"
              style={{
                background: "linear-gradient(180deg, var(--indigo-2), var(--indigo))",
                boxShadow: "0 8px 22px -6px rgba(99,102,241,.6)",
              }}
            >
              {primary.icon}{primary.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
