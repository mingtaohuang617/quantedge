import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * ConfirmModal — 替代 window.confirm() 的统一确认对话框
 * 风格：与项目 .glass-card 深色玻璃保持一致
 *
 * 受控用法：
 *   const [open, setOpen] = useState(false);
 *   <ConfirmModal
 *     open={open}
 *     title="删除观察项"
 *     message="确定从观察列表删除 NVDA？"
 *     confirmLabel="删除"
 *     danger
 *     onConfirm={() => { ...; setOpen(false); }}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * 行为：
 *   - ESC 键 → 取消
 *   - 点击遮罩 → 取消
 *   - 自动 focus 取消按钮（避免误删）
 */
export default function ConfirmModal({
  open,
  title = "确认操作",
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    // 自动聚焦取消按钮（默认安全选项）
    const id = setTimeout(() => cancelRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm?.(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(id); document.removeEventListener("keydown", onKey); };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const confirmCls = danger
    ? "bg-red-500/20 hover:bg-red-500/30 text-red-200 border-red-500/40"
    : "bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border-indigo-500/40";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="w-full max-w-sm glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          {danger && (
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/15 border border-red-500/30">
              <AlertTriangle size={14} className="text-red-300" />
            </span>
          )}
          <h2 id="confirm-title" className="text-[13px] font-semibold text-white flex-1">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="p-1 rounded text-[#a0aec0] hover:text-white hover:bg-white/10 transition"
            aria-label="关闭"
          >
            <X size={13} />
          </button>
        </div>
        {/* Body */}
        <div className="px-4 py-3.5 text-[12px] text-[#d0d7e2] leading-relaxed">
          {message}
        </div>
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/8 bg-white/[0.02]">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] rounded-md text-[#a0aec0] hover:text-white hover:bg-white/5 border border-white/10 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-md border transition ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
