// ─────────────────────────────────────────────────────────────
// 评分解读卡（B2 - DeepSeek）
// ─────────────────────────────────────────────────────────────
//
// 用法：
//   <ScoreExplainCard stock={sel} weights={weights} />
//
// 显示：1-2 句话解释为什么综合得这个分（哪个子项拉高/拉低）
// 折叠默认；点 "AI 解读评分" 触发，缓存 24h
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { Info, AlertCircle, Loader, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

export default function ScoreExplainCard({ stock, weights }) {
  const [state, setState] = useState({
    loading: false,
    text: null,
    cached: false,
    error: null,
    expanded: false,
  });

  // 当 ticker 变化时清空（避免显示上一只标的的解读）
  useEffect(() => {
    setState({ loading: false, text: null, cached: false, error: null, expanded: false });
  }, [stock?.ticker]);

  if (!stock || !stock.ticker || !stock.subScores) return null;

  const handleGenerate = async () => {
    setState((s) => ({ ...s, loading: true, error: null, expanded: true }));
    try {
      const json = await apiFetch("/llm/explain-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: stock.ticker,
          score: stock.score ?? null,
          isETF: !!stock.isETF,
          subScores: stock.subScores || {},
          weights: weights || { fundamental: 40, technical: 30, growth: 30 },
        }),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok) throw new Error(json.error || json.detail || "AI 服务异常");
      setState({
        loading: false,
        text: json.explanation || "",
        cached: !!json.cached,
        error: null,
        expanded: true,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  };

  return (
    <div className="glass-card p-2.5 border border-indigo-500/20">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Info size={11} className="text-indigo-400" />
          <span className="text-[10px] font-medium text-indigo-300">为什么 {stock.score?.toFixed(1)} 分？</span>
          {state.cached && (
            <span title="命中缓存" className="inline-flex items-center gap-0.5 text-[8px] text-amber-300/80">
              <Zap size={8} /> 缓存
            </span>
          )}
        </div>
        {!state.text && !state.loading && (
          <button
            onClick={handleGenerate}
            className="px-1.5 py-0.5 text-[9px] rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/30 transition"
          >
            AI 解读
          </button>
        )}
        {state.text && (
          <button
            onClick={handleGenerate}
            className="text-[8px] text-indigo-300/70 hover:text-indigo-200 transition"
          >
            重新解读
          </button>
        )}
      </div>

      {state.loading && (
        <div className="flex items-center gap-1.5 text-[9px] text-[#a0aec0] py-0.5">
          <Loader size={10} className="animate-spin text-indigo-400" />
          <span>正在分析...</span>
        </div>
      )}

      {state.error && !state.loading && (
        <div className="flex items-start gap-1 text-[9px] text-amber-300/90 py-0.5">
          <AlertCircle size={10} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="break-all">{state.error}</span>
        </div>
      )}

      {state.text && !state.loading && (
        <div className="text-[10px] text-[#d0d7e2] leading-relaxed">{state.text}</div>
      )}

      {!state.expanded && !state.loading && !state.error && (
        <div className="text-[9px] text-[#778]">
          点 AI 解读，1-2 句话告诉你为什么得这个分
        </div>
      )}
    </div>
  );
}
