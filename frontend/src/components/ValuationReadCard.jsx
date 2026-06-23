// ─────────────────────────────────────────────────────────────
// 估值速读卡（B1 — 借鉴 anthropics/financial-services 的 comps + dcf 方法论）
// ─────────────────────────────────────────────────────────────
//
// 用法： <ValuationReadCard stock={sel} />
//
// 行为：
//   - 默认折叠；点「生成估值速读」才调 LLM（省 token）
//   - 调 POST /api/llm/valuation-read（本地 Vercel handler，DeepSeek 直连 + KV 缓存）
//   - 输出按当前界面语言（zh-CN / zh-TW / en）生成 —— 多语言一等公民
//   - 失败 / 无 key 时优雅降级，不影响主流程
//
// 与 AIStockSummaryCard 区分：那张是 3 句泛读；本卡是「估值专题」（相对估值 + 隐含预期）。
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { Scale, AlertCircle, Loader, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import { useLang } from "../i18n.jsx";
import { fmtMcap } from "../lib/formatters.js";

const LLM_ENDPOINT = "/llm/valuation-read";

// 用平台口径格式化基本面（单位与 ScoringDashboard 详情一致：roe/利润率/营收增长 为百分数）
function buildMetrics(s) {
  const p = [];
  if (s.pe != null && s.pe > 0) p.push(`PE ${s.pe.toFixed(1)}`);
  if (s.pb != null) p.push(`PB ${s.pb.toFixed(2)}`);
  if (s.roe != null) p.push(`ROE ${s.roe.toFixed(1)}%`);
  if (s.profitMargin != null) p.push(`利润率 ${s.profitMargin.toFixed(1)}%`);
  if (s.revenueGrowth != null) p.push(`营收增长 ${s.revenueGrowth.toFixed(1)}%`);
  if (s.dividend_yield != null) p.push(`股息率 ${s.dividend_yield.toFixed(1)}%`);
  if (s.momentum != null) p.push(`动量 ${s.momentum}`);
  if (s.rsi != null) p.push(`RSI ${typeof s.rsi === "number" ? s.rsi.toFixed(0) : s.rsi}`);
  if (s.marketCap != null) p.push(`市值 ${fmtMcap(s.marketCap)}`);
  if (s.score != null) p.push(`综合分 ${s.score}`);
  return p.join(" · ");
}

export default function ValuationReadCard({ stock }) {
  const { t, lang } = useLang();
  const [state, setState] = useState({ loading: false, data: null, cached: false, error: null, expanded: false });

  if (!stock || !stock.ticker) return null;

  const metrics = buildMetrics(stock);
  const thin = metrics.split(" · ").length < 3; // 基本面太少时提示可能不准

  const handleGenerate = async () => {
    setState((s) => ({ ...s, loading: true, error: null, expanded: true }));
    try {
      const json = await apiFetch(LLM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: stock.ticker,
          name: stock.name,
          sector: stock.sector || stock.industry,
          metrics,
          lang,
        }),
      });
      if (!json) throw new Error(t("后端无响应（检查 backend 是否启动）"));
      if (!json.ok) throw new Error(json.error || json.detail || t("AI 服务异常"));
      setState({ loading: false, data: json.read, cached: !!json.cached, error: null, expanded: true });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  };

  const hasData = !!state.data;
  const lean = hasData ? state.data["估值倾向_int"] : null;
  const leanLabel = lean === 1 ? t("偏低估") : lean === 3 ? t("偏高估") : t("合理");
  const leanColor = lean === 1 ? "text-up bg-up/10 border-up/20"
    : lean === 3 ? "text-down bg-down/10 border-down/20"
    : "text-amber-300 bg-amber-400/10 border-amber-400/20";

  return (
    <div className="rounded-xl border border-teal-500/20 bg-gradient-to-br from-teal-500/[0.06] to-transparent p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Scale size={12} className="text-teal-300" />
          <span className="text-[10.5px] font-semibold tracking-wider uppercase text-teal-200/90">{t("估值速读")}</span>
          {state.cached && (
            <span title={t("命中缓存（无 token 消耗）")} className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/80 ml-1">
              <Zap size={9} /> {t("缓存")}
            </span>
          )}
          {hasData && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ml-1 ${leanColor}`}>{leanLabel}</span>
          )}
        </div>
        {!hasData && !state.loading && (
          <button onClick={handleGenerate}
            className="px-2.5 py-0.5 text-[10px] rounded-md bg-teal-500/20 hover:bg-teal-500/30 text-teal-200 border border-teal-500/40 transition">
            {t("生成估值速读")}
          </button>
        )}
        {hasData && (
          <button onClick={handleGenerate} className="text-[9px] text-teal-300/70 hover:text-teal-200 transition">
            {t("重新生成")}
          </button>
        )}
      </div>

      {state.loading && (
        <div className="flex items-center gap-2 text-[11px] text-[#a0aec0] py-1">
          <Loader size={11} className="animate-spin text-teal-300" />
          <span>{t("正在生成估值速读…")}</span>
        </div>
      )}

      {state.error && !state.loading && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 py-1">
          <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="break-all">{state.error}</span>
        </div>
      )}

      {hasData && !state.loading && (
        <div className="space-y-1.5">
          <Row label={t("估值定位")} text={state.data["估值定位"]} />
          <Row label={t("倍数解读")} text={state.data["倍数解读"]} />
          <Row label={t("市场定价")} text={state.data["市场定价"]} />
          <Row label={t("多空区间")} text={state.data["多空区间"]} />
          <Row label={t("待核验")} text={state.data["待核验"]} />
          <Row label={t("结论")} text={state.data["结论"]} />
          <div className="text-[9px] text-[#667] pt-1.5 mt-0.5 border-t border-white/5">
            {t("机构估值框架（comps + 简化 DCF）· AI 草稿 · 非投资建议")}
          </div>
        </div>
      )}

      {!state.expanded && !state.loading && (
        <div className="text-[11px] text-[#a0aec0] py-0.5">
          {t("点「生成估值速读」用机构估值框架做一份相对估值 + 隐含预期分析")}
          {thin && <span className="block text-[9px] text-amber-300/70 mt-1">{t("⚠ 该标的基本面数据较少，结果可能不准")}</span>}
        </div>
      )}
    </div>
  );
}

function Row({ label, text }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-semibold tracking-wider uppercase text-teal-200/70 shrink-0 w-[64px] mt-0.5">{label}</span>
      <span className="flex-1 text-[12px] text-[#d0d7e2] leading-relaxed">{text || "—"}</span>
    </div>
  );
}
