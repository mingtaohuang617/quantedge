import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLang } from "../../i18n.jsx";

/**
 * BottomSheet — 从底部升起的面板，替代移动端居中弹窗。
 * 设计原则（v6 移动端）：单手可达、可下滑关闭、不打断上下文。
 *
 *  <BottomSheet open={open} onClose={()=>setOpen(false)} title={t("筛选标的")}
 *     footer={<button>显示 9 只标的</button>}>
 *     …内容…
 *  </BottomSheet>
 *
 * 行为：背景遮罩点击 / ESC / 向下拖拽手柄 关闭；body 滚动锁定；进出动画（尊重 reduce-motion）。
 */
const DUR = 280;

export default function BottomSheet({
  open,
  onClose,
  title,
  headerRight,
  children,
  footer,
  maxHeight = "88vh",
  showHandle = true,
  closeOnBackdrop = true,
  ariaLabel,
  contentClassName = "",
}) {
  const { t } = useLang();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef(null);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      );
      return () => cancelAnimationFrame(r);
    }
    if (mounted) {
      setVisible(false);
      const tm = setTimeout(() => setMounted(false), reduce.current ? 0 : DUR);
      return () => clearTimeout(tm);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mounted, onClose]);

  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchMove = (e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDrag(dy);
  };
  const onTouchEnd = () => {
    if (drag > 90) onClose?.();
    setDrag(0);
    startY.current = null;
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || (typeof title === "string" ? title : t("面板"))}
    >
      <div
        onClick={closeOnBackdrop ? onClose : undefined}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${reduce.current ? 0 : DUR}ms ease` }}
      />
      <div
        className="relative w-full max-w-xl mx-auto rounded-t-[22px] border border-b-0 flex flex-col"
        style={{
          maxHeight,
          background: "var(--bg-1)",
          borderColor: "var(--line-2)",
          boxShadow: "0 -20px 50px -10px rgba(0,0,0,.6)",
          transform: `translateY(${visible ? `${drag}px` : "100%"})`,
          transition: drag ? "none" : `transform ${reduce.current ? 0 : DUR}ms cubic-bezier(.2,.7,.1,1)`,
        }}
      >
        {/* grabber zone (drag to dismiss) */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="shrink-0 pt-2.5 px-[18px] cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          {showHandle && (
            <div className="mx-auto mb-3 h-[4.5px] w-10 rounded-full" style={{ background: "var(--line-2)" }} />
          )}
          {(title || headerRight) && (
            <div className="flex items-center justify-between mb-3.5">
              {typeof title === "string"
                ? <span className="text-[16px] font-semibold" style={{ color: "var(--fg-0)" }}>{title}</span>
                : title}
              {headerRight || (
                <button onClick={onClose} aria-label={t("关闭")} className="p-1 -mr-1 rounded active:scale-90 transition" style={{ color: "var(--fg-3)" }}>
                  <X size={18} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* scrollable body */}
        <div className={`flex-1 overflow-y-auto overscroll-contain px-[18px] ${contentClassName}`}>
          {children}
        </div>

        {/* footer (sticky) */}
        {footer && (
          <div
            className="shrink-0 px-[18px] pt-3"
            style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
        {!footer && <div style={{ height: "env(safe-area-inset-bottom)" }} />}
      </div>
    </div>,
    document.body
  );
}
