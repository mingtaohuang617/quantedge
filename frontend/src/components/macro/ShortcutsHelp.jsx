import React, { useEffect, useRef } from "react";
import { X, Keyboard } from "lucide-react";
import { useLang } from "../../i18n.jsx";

// 键盘快捷键帮助弹窗 — `?` 触发
export default function ShortcutsHelp({ open, onClose }) {
  const { t } = useLang();
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => closeBtnRef.current?.focus(), 0);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose?.(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const Section = ({ title, items }) => (
    <div>
      <div className="text-[10px] font-medium text-white/55 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1.5">
        {items.map(([keys, desc]) => (
          <div key={keys} className="flex items-center gap-2 text-[12px]">
            <span className="font-mono text-white/85 bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 min-w-[40px] text-center text-[10px]">
              {keys}
            </span>
            <span className="text-white/65">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-indigo-300" />
          <span id="shortcuts-help-title" className="text-sm font-medium text-white/90">
            {t("键盘快捷键")}
          </span>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="ml-auto p-1.5 rounded hover:bg-white/[0.06] text-white/50 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
            title={t("关闭 (Esc)")}
            aria-label={t("关闭 (Esc)")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <Section title={t("看板操作")} items={[
            ["r", t("刷新数据")],
            ["c", t("切换紧凑视图")],
            ["s / /", t("聚焦搜索框")],
            ["?", t("显示本帮助")],
          ]} />
          <Section title={t("搜索框内")} items={[
            ["Esc", t("清空搜索")],
          ]} />
          <Section title={t("因子详情弹窗")} items={[
            ["← / →", t("上一个 / 下一个因子")],
            ["Esc", t("关闭弹窗")],
            ["Tab", t("循环聚焦")],
          ]} />
          <div className="text-[10px] text-white/35 pt-3 border-t border-white/[0.04]">
            {t("仅在宏观看板页生效；输入框内的键不消费")}
          </div>
        </div>
      </div>
    </div>
  );
}
