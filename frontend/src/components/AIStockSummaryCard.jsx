// ─────────────────────────────────────────────────────────────
// 个股 AI 摘要卡（B1 - DeepSeek 集成）
// ─────────────────────────────────────────────────────────────
//
// 用法：
//   <AIStockSummaryCard stock={sel} />
//
// 行为：
//   - 默认折叠（避免每次切换标的都自动调 LLM 浪费 token）
//   - 用户点 "AI 解读" 按钮才触发
//   - 调用 POST /api/llm/summary（后端命中缓存时 <50ms）
//   - 缓存命中显示 ⚡ 标记
//   - 失败时显示静态 fallback（不影响主流程）
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { Sparkles, AlertCircle, Loader, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

// 注意：apiFetch 内部已经拼 "/api" 前缀，且返回已 parse 的 JSON（不是 Response 对象）
const LLM_ENDPOINT = "/llm/summary";

export default function AIStockSummaryCard({ stock }) {
  const [state, setState] = useState({
    loading: false,
    data: null,           // { 看点, 风险, 估值 }
    cached: false,
    error: null,
    expanded: false,
  });

  if (!stock || !stock.ticker) return null;

  const handleGenerate = async () => {
    setState((s) => ({ ...s, loading: true, error: null, expanded: true }));
    try {
      const payload = {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        pe: stock.pe ?? null,
        roe: stock.roe ?? null,
        momentum: stock.momentum ?? null,
        rsi: stock.rsi ?? null,
        revenueGrowth: stock.revenueGrowth ?? null,
        profitMargin: stock.profitMargin ?? null,
        descriptionCN: stock.descriptionCN ?? null,
        week52High: stock.week52High ?? null,
        week52Low: stock.week52Low ?? null,
      };
      // apiFetch 已 parse JSON 并在网络失败时返回 null
      const json = await apiFetch(LLM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json) throw new Error("后端无响应（检查 backend 是否启动）");
      if (!json.ok) throw new Error(json.error || json.detail || "AI 服务异常");
      setState({
        loading: false,
        data: json.summary,
        cached: !!json.cached,
        error: null,
        expanded: true,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: String(e?.message || e),
      }));
    }
  };

  const isCollapsed = !state.expanded;
  const hasData = !!state.data;

  return (
    <div className="glass-card p-3 border border-violet-500/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-violet-400" />
          <span className="text-[11px] font-medium text-violet-300">AI 解读</span>
          {state.cached && (
            <span
              title="命中缓存（无 token 消耗）"
              className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/80"
            >
              <Zap size={9} /> 缓存
            </span>
          )}
        </div>
        {!hasData && !state.loading && (
          <button
            onClick={handleGenerate}
            className="px-2 py-0.5 text-[10px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition"
          >
            生成解读
          </button>
        )}
        {hasData && (
          <button
            onClick={handleGenerate}
            className="text-[9px] text-violet-300/70 hover:text-violet-200 transition"
          >
            重新生成
          </button>
        )}
      </div>

      {/* 加载态 */}
      {state.loading && (
        <div className="flex items-center gap-2 text-[10px] text-[#a0aec0] py-2">
          <Loader size={11} className="animate-spin text-violet-400" />
          <span>正在调用 DeepSeek...</span>
        </div>
      )}

      {/* 错误态 */}
      {state.error && !state.loading && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 py-1">
          <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="break-all">{state.error}</span>
        </div>
      )}

      {/* 数据态 */}
      {hasData && !state.loading && (
        <div className="space-y-1.5">
          <Row icon="📈" label="看点" text={state.data["看点"]} />
          <Row icon="⚠️" label="风险" text={state.data["风险"]} />
          <Row icon="💎" label="估值" text={state.data["估值"]} />
        </div>
      )}

      {/* 默认提示 */}
      {isCollapsed && !state.loading && !state.error && (
        <div className="text-[10px] text-[#778] py-1">
          点"生成解读"让 DeepSeek 用 3 句话总结看点 / 风险 / 估值
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, text }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[11px] shrink-0 select-none" aria-hidden>{icon}</span>
      <div className="flex-1">
        <span className="text-[9px] text-violet-300/70 mr-1.5">{label}</span>
        <span className="text-[10px] text-[#d0d7e2] leading-relaxed">{text || "—"}</span>
      </div>
    </div>
  );
}
