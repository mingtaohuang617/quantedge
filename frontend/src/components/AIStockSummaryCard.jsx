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
import { useLang } from "../i18n.jsx";

const LLM_ENDPOINT = "/llm/summary";

export default function AIStockSummaryCard({ stock }) {
  const { t } = useLang();
  const [state, setState] = useState({
    loading: false,
    data: null,           // { 看点, 风险, 估值 }
    cached: false,
    error: null,
    expanded: false,
    generatedAt: null,    // v5.3：生成时间戳，用于"更新于 N 分钟前"
  });

  if (!stock || !stock.ticker) return null;

  // v5.3：相对时间（生成解读的鲜度）
  const relTime = (ts) => {
    if (!ts) return null;
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return t('刚刚');
    if (mins < 60) return t('{n} 分钟前', { n: mins });
    return t('{n} 小时前', { n: Math.floor(mins / 60) });
  };

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
        generatedAt: Date.now(),
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

  // v5 编辑式：AI 从"附属解读"升级为"主导论点 lead paragraph"
  // 容器改用 .lead-paragraph（紫色 3px 左边线 + 渐变 bg），body 字号 10→12.5px serif
  return (
    <div className="lead-paragraph">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-violet-400" />
          <span className="text-[10.5px] font-semibold tracking-wider uppercase text-violet-300/90">{t('AI 解读 · 主导论点')}</span>
          {state.cached && (
            <span
              title={t('命中缓存（无 token 消耗）')}
              className="inline-flex items-center gap-0.5 text-[9px] text-amber-300/80 ml-1"
            >
              <Zap size={9} /> {t('缓存')}
            </span>
          )}
        </div>
        {!hasData && !state.loading && (
          <button
            onClick={handleGenerate}
            className="px-2.5 py-0.5 text-[10px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition"
          >
            {t('生成解读')}
          </button>
        )}
        {hasData && (
          <button
            onClick={handleGenerate}
            className="text-[9px] text-violet-300/70 hover:text-violet-200 transition"
          >
            {t('重新生成')}
          </button>
        )}
      </div>

      {/* 加载态 */}
      {state.loading && (
        <div className="flex items-center gap-2 text-[11px] text-[#a0aec0] py-1">
          <Loader size={11} className="animate-spin text-violet-400" />
          <span>{t('正在调用 DeepSeek...')}</span>
        </div>
      )}

      {/* 错误态 */}
      {state.error && !state.loading && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 py-1">
          <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span className="break-all">{state.error}</span>
        </div>
      )}

      {/* 数据态 — 编辑式 body：大字号 + 行高 1.7 + 三段并列 */}
      {hasData && !state.loading && (
        <div className="space-y-2">
          <Row icon="📈" label={t('看点')} text={state.data["看点"]} />
          <Row icon="⚠️" label={t('风险')} text={state.data["风险"]} />
          <Row icon="💎" label={t('估值')} text={state.data["估值"]} />
          {/* v5.3：模型置信度量表 — 由数据覆盖度诚实推导（6 因子覆盖越全，AI 判断越可信），
              把 AI 论点从"黑箱断言"变成"带可信度与鲜度的判断" */}
          {(() => {
            const factors = [stock.pe, stock.roe, stock.momentum, stock.rsi, stock.revenueGrowth, stock.profitMargin];
            const covered = factors.filter((v) => v != null && Number.isFinite(Number(v))).length;
            const pct = Math.round((covered / factors.length) * 100);
            const level = pct >= 80 ? t('高') : pct >= 50 ? t('中') : t('低');
            const lvColor = pct >= 80 ? "text-up" : pct >= 50 ? "text-amber-300" : "text-down";
            const segColor = pct >= 80 ? "#1ED395" : pct >= 50 ? "#F5B53C" : "#FF6B6B";
            const filled = Math.round(pct / 20); // 5 段量表
            return (
              <div className="flex items-center gap-2 flex-wrap pt-2 mt-0.5 border-t border-white/5">
                <span className="text-[9px] text-[#778] uppercase tracking-wider shrink-0">{t('模型置信度')}</span>
                <div className="flex items-center gap-0.5" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span key={i} className="w-3 h-1.5 rounded-sm transition-colors" style={{ background: i < filled ? segColor : "rgba(255,255,255,0.1)" }} />
                  ))}
                </div>
                <span className={`text-[10px] font-mono font-bold ${lvColor}`}>{pct}% · {level}</span>
                <span className="text-[9px] text-[#778] ml-auto">{t('数据覆盖 {c}/{n} 因子', { c: covered, n: factors.length })}{covered === factors.length ? ` · ${t('无缺失')}` : ""}</span>
              </div>
            );
          })()}
          <div className="lead-paragraph__based-on">{t('based on · PE · ROE · 营收 · RSI · 52W 区间')}{state.generatedAt ? ` · ${t('更新于 {ago}', { ago: relTime(state.generatedAt) })}` : ""}</div>
        </div>
      )}

      {/* 默认提示 */}
      {isCollapsed && !state.loading && !state.error && (
        <div className="text-[11px] text-[#a0aec0] py-0.5">
          {t('点"生成解读"让 DeepSeek 用 3 句话总结看点 / 风险 / 估值')}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, text }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[12px] shrink-0 select-none mt-0.5" aria-hidden>{icon}</span>
      <div className="flex-1">
        <span className="text-[10px] font-semibold tracking-wider uppercase text-violet-300/80 mr-2">{label}</span>
        <span className="lead-paragraph__body text-[12.5px]">{text || "—"}</span>
      </div>
    </div>
  );
}
