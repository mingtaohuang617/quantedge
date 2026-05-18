// Stock Gene 弹层组件：ConfirmDialog / ShortcutsHelp / WeightsPanel / ListDialog / AlertsPanel
import React, { useState } from "react";
import { AlertCircle, Bell, BellOff, Layers, Loader, Sliders, X } from "lucide-react";
import { ENGINE_IDS, eng, LIST_COLORS, formatFreshness } from "./helpers.js";

// ─── ConfirmDialog — 不可逆操作确认弹层（替代 window.confirm）─────────
export function ConfirmDialog({ title, message, confirmLabel = "确认", danger = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-card border border-white/15 rounded-lg p-4 min-w-[300px] max-w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle size={14} className={danger ? "text-rose-400" : "text-amber-400"} />
          <span className="text-[12px] font-semibold text-white">{title}</span>
        </div>
        <div className="text-[11px] text-[#d0d7e2] leading-relaxed mb-3">{message}</div>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 disabled:opacity-40"
          >取消</button>
          <button
            onClick={handle}
            disabled={busy}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded border transition disabled:opacity-40 ${
              danger
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-500/40"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40"
            }`}
            autoFocus
          >
            {busy ? <Loader size={9} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ShortcutsHelp — 快捷键 overlay ──────────────────────────────────
export function ShortcutsHelp({ onClose }) {
  const rows = [
    { keys: ["j", "↓"], desc: "选择下一只" },
    { keys: ["k", "↑"], desc: "选择上一只" },
    { keys: ["/"], desc: "聚焦搜索框" },
    { keys: ["t"], desc: "切到趋势引擎" },
    { keys: ["v"], desc: "切到价值引擎" },
    { keys: ["r"], desc: "刷新列表" },
    { keys: ["Esc"], desc: "清过滤 / 关弹层" },
    { keys: ["?"], desc: "显示此帮助" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card border border-white/15 rounded-lg p-4 min-w-[280px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-semibold text-white">键盘快捷键</span>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white" title="关闭"><X size={12} /></button>
        </div>
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.desc} className="flex items-center justify-between text-[11px]">
              <span className="text-[#d0d7e2]">{r.desc}</span>
              <span className="flex items-center gap-1">
                {r.keys.map(k => (
                  <kbd key={k} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono text-white">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-white/10 text-[9px] text-[#7a8497]">
          ⓘ 焦点在输入框 / 弹层内时快捷键不触发
        </div>
      </div>
    </div>
  );
}

// ─── WeightsPanel — 综合分权重 ───────────────────────────────────────
export function WeightsPanel({ weights, onChange, onReset, onClose }) {
  const total = ENGINE_IDS.reduce((s, id) => s + (weights[id] || 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card border border-white/15 rounded-lg p-4 min-w-[340px] max-w-[440px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sliders size={13} className="text-indigo-300" />
            <span className="text-[12px] font-semibold text-white">综合分权重</span>
          </div>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white" title="关闭"><X size={12} /></button>
        </div>
        <div className="text-[10px] text-[#7a8497] mb-3 leading-relaxed">
          各引擎在综合分里的权重（总和不需等于 100，会自动归一化）。调整会立即重算所有综合分 + 重新排序。
        </div>
        <div className="space-y-2.5">
          {ENGINE_IDS.map(id => {
            const cfg = eng(id);
            const w = weights[id] || 0;
            return (
              <div key={id} className="flex items-center gap-2">
                <span className={`text-[10px] w-20 shrink-0 ${cfg.activeText || "text-white"}`}>{cfg.label}</span>
                <input
                  type="range" min={0} max={100} step={5}
                  value={w}
                  onChange={(e) => onChange({ ...weights, [id]: Number(e.target.value) })}
                  className="flex-1 h-1 accent-indigo-500 cursor-pointer"
                />
                <span className="font-mono text-[10px] text-white w-10 text-right">{w}</span>
                <span className="text-[9px] text-[#7a8497] w-10 text-right">
                  {total > 0 ? `${Math.round(w / total * 100)}%` : "0%"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
          <button onClick={onReset}
            className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10">
            恢复默认
          </button>
          <button onClick={onClose}
            className="px-3 py-1 text-[10px] rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/40">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ListDialog — 创建 / 重命名 / 删除 list 三态弹层 ─────────────────
export function ListDialog({ mode, list, onCreate, onRename, onDelete, onCancel }) {
  const [name, setName] = useState(list?.name || "");
  const [color, setColor] = useState(list?.color || "slate");
  const [busy, setBusy] = useState(false);
  const isDelete = mode === "delete";
  const title = isDelete ? `删除分组「${list?.name}」` :
                mode === "rename" ? "重命名分组" : "新建分组";
  const handleSubmit = async () => {
    if (isDelete) {
      setBusy(true);
      try { await onDelete(); } finally { setBusy(false); }
      return;
    }
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    try {
      if (mode === "create") await onCreate(v, color);
      else await onRename(v, color);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="glass-card border border-white/15 rounded-lg p-4 min-w-[320px] max-w-[420px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isDelete ? <AlertCircle size={13} className="text-rose-400" /> : <Layers size={13} className="text-emerald-300" />}
            <span className="text-[12px] font-semibold text-white">{title}</span>
          </div>
          <button onClick={onCancel} className="text-[#a0aec0] hover:text-white"><X size={12} /></button>
        </div>
        {isDelete ? (
          <div className="text-[11px] text-[#d0d7e2] mb-3 leading-relaxed">
            该分组下的所有 items 会被自动移到「默认」分组，评分历史 / tags / notes 全部保留。<br/>
            分组本身会被删除，操作不可撤销。
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <div className="text-[9px] text-[#7a8497] mb-1">名称</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：核心仓 / 投机仓 / 长持..."
                autoFocus
                className="w-full px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <div className="text-[9px] text-[#7a8497] mb-1">颜色</div>
              <div className="flex flex-wrap gap-1">
                {LIST_COLORS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setColor(c.id)}
                    className={`w-6 h-6 rounded border transition ${c.bg} ${c.border} ${
                      color === c.id ? "ring-2 ring-white/50" : ""
                    }`}
                    title={c.id}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-end gap-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 disabled:opacity-40"
          >取消</button>
          <button
            onClick={handleSubmit}
            disabled={busy || (!isDelete && !name.trim())}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded border transition disabled:opacity-40 ${
              isDelete
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-500/40"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40"
            }`}
            autoFocus={isDelete}
          >
            {busy ? <Loader size={9} className="animate-spin" /> : null}
            {isDelete ? "删除" : (mode === "create" ? "创建" : "保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AlertsPanel — 评分变化预警弹层 ─────────────────────────────────
export function AlertsPanel({ alerts, onSelect, onClose, onRequestNotify }) {
  const notifPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card border border-white/15 rounded-lg shadow-2xl w-[520px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-amber-400" />
            <span className="text-[12px] font-semibold text-white">评分变化预警</span>
            <span className="text-[10px] text-[#7a8497]">近 30 天 · {alerts.length} 条</span>
          </div>
          <div className="flex items-center gap-2">
            {notifPerm === "default" && (
              <button
                onClick={onRequestNotify}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40"
                title="允许浏览器在评分变化时主动推送"
              >
                <Bell size={10} /> 启用桌面通知
              </button>
            )}
            {notifPerm === "granted" && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/20" title="桌面通知已启用">
                <Bell size={10} /> 已启用
              </span>
            )}
            {notifPerm === "denied" && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-rose-500/10 text-rose-300/80 border border-rose-500/20" title="浏览器已拒绝通知权限。需要到浏览器设置手动开启">
                <BellOff size={10} /> 已拒绝
              </span>
            )}
            <button onClick={onClose} className="text-[#a0aec0] hover:text-white"><X size={12} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {alerts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-[11px] text-[#7a8497]">
              <Bell size={20} className="text-[#5a6477] mb-2" />
              <span>暂无评分变化</span>
              <span className="text-[9px] mt-1">每次评分会跟历史比对，分差 ≥1 时生成预警</span>
            </div>
          )}
          {alerts.map((a, idx) => {
            const cfg = eng(a.engine);
            const arrow = a.delta > 0 ? "▲" : "▼";
            const color = a.delta > 0 ? "text-emerald-300" : "text-rose-300";
            const bgColor = a.delta > 0 ? "bg-emerald-500/5" : "bg-rose-500/5";
            const verdictChanged = a.from_verdict !== a.to_verdict;
            return (
              <button
                key={`${a.ticker}-${a.engine}-${a.checked_at}-${idx}`}
                onClick={() => onSelect(a.ticker, a.list_id)}
                className={`w-full text-left p-2 mb-1 rounded border border-white/8 hover:border-white/20 transition ${bgColor}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[11px] font-semibold text-white">{a.ticker}</span>
                  {a.name && <span className="text-[10px] text-[#a0aec0] truncate flex-1">{a.name}</span>}
                  <span className={`text-[9px] px-1 py-px rounded border ${cfg.btnBg}`}>
                    {cfg.short} {cfg.framework}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`font-mono font-semibold ${color}`}>
                    {arrow} {a.from_score} → {a.to_score} <span className="text-[9px] opacity-70">/ {a.max_score}</span>
                  </span>
                  {verdictChanged && a.from_verdict && a.to_verdict && (
                    <span className="text-[9px] text-[#a0aec0]">
                      ({cfg.verdictLabels[a.from_verdict] || a.from_verdict}
                      {" → "}
                      {cfg.verdictLabels[a.to_verdict] || a.to_verdict})
                    </span>
                  )}
                  <span className="text-[9px] text-[#5a6477] ml-auto">
                    {formatFreshness(a.checked_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
