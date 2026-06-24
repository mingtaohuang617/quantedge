import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Minimize2 } from "lucide-react";
import { useLang } from "../../i18n.jsx";

/**
 * FullscreenChart — 「图表双态」的横屏全屏态。
 * 竖屏给迷你趋势够决策；点「全屏」后本组件升起：竖屏设备自动 CSS 旋转 90° 成横屏，
 * 上排标的/价格/区间切换 + 退出，中部图表（children 填满），底部指标行。
 *
 *  <FullscreenChart open={fs} onClose={()=>setFs(false)} title="NVDA"
 *     meta={<span className="chip chip-up">▲0.19%</span>}
 *     ranges={["1D","1M","3M","1Y","5Y","MAX"]} activeRange={r} onRangeChange={setR}
 *     indicators={<>…</>}>
 *     <svg width="100%" height="100%" preserveAspectRatio="none">…</svg>
 *  </FullscreenChart>
 */
export default function FullscreenChart({
  open,
  onClose,
  title,
  meta,
  ranges,
  activeRange,
  onRangeChange,
  indicators,
  footerNote,
  children,
}) {
  const { t } = useLang();
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    if (!open) return;
    const calc = () => setPortrait(window.innerHeight > window.innerWidth);
    calc();
    window.addEventListener("resize", calc);
    window.addEventListener("orientationchange", calc);
    // best-effort 原生锁定横屏（多数浏览器需 fullscreen + 手势，失败即回退 CSS 旋转）
    try { window.screen?.orientation?.lock?.("landscape").catch(() => {}); } catch { /* noop */ }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", calc);
      window.removeEventListener("orientationchange", calc);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      try { window.screen?.orientation?.unlock?.(); } catch { /* noop */ }
    };
  }, [open, onClose]);

  if (!open) return null;

  // 竖屏：把容器旋转 90° 填满视口（width=100vh, height=100vw, 以右上角为原点）
  const rotor = portrait
    ? { position: "fixed", top: 0, left: "100vw", width: "100vh", height: "100vw", transformOrigin: "0 0", transform: "rotate(90deg)" }
    : { position: "fixed", inset: 0 };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? t('{title} 全屏图表', { title }) : t("全屏图表")}
      style={{ zIndex: 90, background: "var(--bg-0)", ...rotor }}
    >
      <div className="w-full h-full flex flex-col px-5 py-3">
        {/* top bar */}
        <div className="flex items-center gap-3 mb-2">
          {title && (
            <span className="font-mono text-[16px] font-bold" style={{ color: "var(--fg-0)" }}>{title}</span>
          )}
          {meta}
          <span className="flex-1" />
          {ranges && (
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,.04)" }}>
              {ranges.map((r) => {
                const v = typeof r === "string" ? r : r.value;
                const l = typeof r === "string" ? r : r.label;
                const on = v === activeRange;
                return (
                  <button
                    key={v}
                    onClick={() => onRangeChange?.(v)}
                    className="px-2.5 py-1 rounded-md text-[11px] transition"
                    style={on
                      ? { background: "var(--bg-2)", color: "var(--fg-0)", fontWeight: 600 }
                      : { color: "var(--fg-3)" }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] active:scale-95 transition"
            style={{ background: "rgba(255,255,255,.04)", color: "var(--fg-2)" }}
          >
            <Minimize2 size={13} />退出
          </button>
        </div>

        {/* chart area */}
        <div className="flex-1 relative min-h-0">{children}</div>

        {/* indicators */}
        {indicators && <div className="flex gap-2 mt-2 flex-wrap items-center">{indicators}</div>}
        {footerNote && <div className="text-[10px] mt-1" style={{ color: "var(--fg-3)" }}>{footerNote}</div>}
      </div>
    </div>,
    document.body
  );
}
