// ─────────────────────────────────────────────────────────────
// 月度复盘弹窗（B7 - DeepSeek + Sprint 3）
// ─────────────────────────────────────────────────────────────
//
// 自动从后端拉本月 transactions + positions，生成 markdown 复盘文档
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { X, Loader, FileText, Copy, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

function defaultMonth() {
  // 默认上月（YYYY-MM）
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function MonthlyReviewModal({ open, onClose }) {
  const [month, setMonth] = useState(defaultMonth());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);  // { review, cached, month }
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const json = await apiFetch(`/llm/monthly-review?month=${encodeURIComponent(month)}`, {
        method: "POST",
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok) throw new Error(json.error || json.detail || "生成失败");
      setResult(json);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.review) return;
    try {
      await navigator.clipboard.writeText(result.review);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 失败忽略 */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card p-4 w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col border border-violet-500/30" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <FileText size={14} className="text-violet-400" />
            <span className="text-sm font-semibold text-violet-300">月度复盘（DeepSeek 生成）</span>
            {result?.cached && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/80">
                <Zap size={9} /> 缓存
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#778] hover:text-white"><X size={14} /></button>
        </div>

        {/* 月份选择 + 生成 */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="px-2 py-1.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !month}
            className="px-3 py-1.5 text-xs rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold flex items-center gap-1 disabled:opacity-40"
          >
            {loading ? <Loader size={11} className="animate-spin" /> : <FileText size={11} />}
            {loading ? "正在生成..." : "生成复盘"}
          </button>
          {result && (
            <button
              onClick={handleCopy}
              className="px-2 py-1.5 text-[10px] rounded bg-white/5 text-[#a0aec0] hover:bg-white/10 hover:text-white transition flex items-center gap-1"
              title="复制 markdown"
            >
              <Copy size={10} /> {copied ? "已复制" : "复制"}
            </button>
          )}
        </div>

        {/* 状态 */}
        {error && (
          <div className="text-[11px] text-amber-300/90 mb-2 shrink-0">⚠ {error}</div>
        )}
        {loading && (
          <div className="text-[10px] text-[#a0aec0] py-1">分析本月交易和持仓中... (~5s)</div>
        )}

        {/* 复盘结果 */}
        {result?.review && (
          <div className="flex-1 overflow-auto pr-1">
            <pre className="text-[11px] text-[#d0d7e2] leading-relaxed whitespace-pre-wrap font-sans">
              {result.review}
            </pre>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-[10px] text-[#778] py-3 text-center">
            选择月份 → 点"生成复盘"<br />
            DeepSeek 会基于该月 SQLite transactions + 持仓 自动撰写 1000 字结构化复盘
          </div>
        )}
      </div>
    </div>
  );
}
