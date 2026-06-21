import React, { useEffect } from "react";
import { KeyRound, X } from "lucide-react";
import { useLang } from "../i18n.jsx";

/**
 * ShortcutsModal — 全局快捷键速查
 * 由按 `?` 键唤出（Shift+/），ESC 关闭
 *
 * tab 切换快捷键从 `tabs`（= TAB_CFG）派生，与 quant-platform.jsx 的键盘
 * handler 共用同一份顺序 —— 避免硬编码漂移（曾因 Smart Beta/Mining Alpha
 * 插到位置 3-4 导致这里的标签与实际按键行为不符）。
 * 映射：前 9 个 tab → 数字键 1-9，第 10 个 → 数字键 0。
 */
export function buildShortcuts(tabs) {
  const tabRows = tabs.map((tab, i) => ({
    keys: [i < 9 ? String(i + 1) : "0"],
    desc: `切换到 ${tab.label}`,
  })).slice(0, 10);
  return [
    { keys: ["Ctrl", "K"], altKeys: ["⌘", "K"], desc: "打开命令面板（搜索 / 跳转）" },
    ...tabRows,
    { keys: ["J"], desc: "下一只标的（评分页）" },
    { keys: ["K"], desc: "上一只标的（评分页）" },
    { keys: ["W"], desc: "加入 / 移出自选（评分页当前标的）" },
    { keys: ["C"], desc: "加入 / 移出对比（评分页当前标的）" },
    { keys: ["R"], desc: "刷新所有标的行情" },
    { keys: ["/"], desc: "聚焦主搜索框" },
    { keys: ["?"], desc: "打开本面板" },
    { keys: ["Esc"], desc: "关闭当前模态 / 取消" },
  ];
}

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono text-white/90 shadow-sm">
      {children}
    </kbd>
  );
}

export default function ShortcutsModal({ open, onClose, tabs = [] }) {
  const { t } = useLang();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose?.(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const SHORTCUTS = buildShortcuts(tabs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        className="w-full max-w-md glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-cyan-500/15 border border-cyan-500/30">
            <KeyRound size={14} className="text-cyan-300" />
          </span>
          <h2 id="shortcuts-title" className="text-[13px] font-semibold text-white flex-1">
            {t('键盘快捷键')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#a0aec0] hover:text-white hover:bg-white/10 transition"
            aria-label={t("关闭")}
          >
            <X size={13} />
          </button>
        </div>
        {/* Body */}
        <div className="px-4 py-3 max-h-[60vh] overflow-auto">
          <ul className="space-y-2">
            {SHORTCUTS.map((s, i) => {
              const keys = isMac && s.altKeys ? s.altKeys : s.keys;
              return (
                <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-[#d0d7e2]">{s.desc}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className="text-[#7a8497] text-[10px]">+</span>}
                        <Kbd>{k}</Kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/8 bg-white/[0.02] text-[10px] text-[#7a8497]">
          {t('按')} <Kbd>Esc</Kbd> {t('关闭，或随时按')} <Kbd>?</Kbd> {t('重新打开')}
        </div>
      </div>
    </div>
  );
}
