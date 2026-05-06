// ─────────────────────────────────────────────────────────────
// 回测 AI 总结卡（B4 - DeepSeek）
// ─────────────────────────────────────────────────────────────
//
// 用法：
//   <BacktestNarrationCard btResult={btResult} portfolio={portfolio} benchMetrics={benchMetrics} />
//
// 显示：4-5 句中文总结（表现、风险时点、改进建议）
// 折叠默认；点 "AI 总结" 触发，缓存 30min（参数变化会自动 miss）
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { Sparkles, AlertCircle, Loader, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

export default function BacktestNarrationCard({ btResult, portfolio, benchMetrics }) {
  const [state, setState] = useState({
    loading: false,
    text: null,
    cached: false,
    error: null,
    expanded: false,
  });

  // btResult 变化时清空（新回测应重新生成）
  const cacheKey = useMemo(() => {
    if (!btResult?.metrics) return "";
    const m = btResult.metrics;
    return `${Object.keys(portfolio || {}).sort().join(",")}|${m.annReturn}|${m.sharpe}|${m.maxDD}`;
  }, [btResult, portfolio]);

  useEffect(() => {
    setState({ loading: false, text: null, cached: false, error: null, expanded: false });
  }, [cacheKey]);

  if (!btResult?.metrics || !portfolio) return null;

  const handleGenerate = async () => {
    setState((s) => ({ ...s, loading: true, error: null, expanded: true }));
    try {
      const m = btResult.metrics;
      // 找最差单月
      const monthly = btResult.monthlyReturns || [];
      let worstMonth = null, worstRet = null;
      for (const r of monthly) {
        if (worstRet === null || r.ret < worstRet) {
          worstRet = r.ret;
          worstMonth = r.month;
        }
      }
      // 归一化 portfolio weights
      const totalW = Object.values(portfolio).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
      const weights = {};
      for (const [t, w] of Object.entries(portfolio)) weights[t] = Number(w) / totalW;

      const payload = {
        tickers: Object.keys(portfolio),
        weights,
        annualReturn: m.annReturn ?? null,        // BacktestEngine 字段名是 annReturn
        sharpe: m.sharpe ?? null,
        maxDD: m.maxDD ?? null,
        vol: m.vol ?? null,
        worstMonth,
        worstMonthReturn: worstRet,
        benchAnnualReturn: benchMetrics?.annReturn ?? null,
      };

      const json = await apiFetch("/llm/backtest-narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok) throw new Error(json.error || json.detail || "AI 服务异常");
      setState({
        loading: false,
        text: json.narration || "",
        cached: !!json.cached,
        error: null,
        expanded: true,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  };

  return (
    <div className="glass-card p-3 border border-violet-500/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-violet-400" />
          <span className="text-[11px] font-medium text-violet-300">AI 回测总结</span>
          {state.cached && (
            <span title="命中缓存" className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/80">
              <Zap size={9} /> 缓存
            </span>
          )}
        </div>
        {!state.text && !state.loading && (
          <button
            onClick={handleGenerate}
            className="px-2 py-0.5 text-[10px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition"
          >
            生成总结
          </button>
        )}
        {state.text && (
          <button
            onClick={handleGenerate}
            className="text-[9px] text-violet-300/70 hover:text-violet-200 transition"
          >
            重新生成
          </button>
        )}
      </div>

      {state.loading && (
        <div className="flex items-center gap-2 text-[10px] text-[#a0aec0] py-2">
          <Loader size={11} className="animate-spin text-violet-400" />
          <span>正在分析回测结果...</span>
        </div>
      )}

      {state.error && !state.loading && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 py-1">
          <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="break-all">{state.error}</span>
        </div>
      )}

      {state.text && !state.loading && (
        <div className="text-[10px] text-[#d0d7e2] leading-relaxed whitespace-pre-line">{state.text}</div>
      )}

      {!state.expanded && !state.loading && !state.error && (
        <div className="text-[10px] text-[#778]">
          点"生成总结"让 DeepSeek 用 4-5 句话评价回测表现和风险
        </div>
      )}
    </div>
  );
}
