// ─────────────────────────────────────────────────────────────
// ValueScoreCard — 价值型 5 维评分详情卡（含雷达图 + LLM 解释）
// ─────────────────────────────────────────────────────────────
//
// 用法：
//   <ValueScoreCard ticker="AAPL" data={fullScoreResult} onClose={...} />
// data 形如 backend /api/watchlist/value/{ticker}/score 返回：
//   { ticker, metrics, score: {value_score, sub_scores, drivers, weights_used, coverage},
//     moat_llm, explain }
// ─────────────────────────────────────────────────────────────
import React from "react";
import { X, Award, Sparkles, Zap, AlertCircle } from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";

const SUB_LABELS = {
  moat: "护城河",
  financial: "财务",
  mgmt: "管理层",
  valuation: "估值",
  compound: "复利",
};

function fmtPct(v, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtBig(v) {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return `${v.toFixed(0)}`;
}

export default function ValueScoreCard({ ticker, data, onClose }) {
  if (!data) return null;
  const { metrics = {}, score = {}, moat_llm, explain } = data;
  const subs = score.sub_scores || {};
  const drivers = score.drivers || {};
  const radarData = Object.entries(SUB_LABELS).map(([k, label]) => ({
    dim: label,
    value: subs[k] != null ? Math.round(subs[k]) : 0,
  }));

  const valDrv = drivers.valuation || {};
  const finDrv = drivers.financial || {};
  const mgmtDrv = drivers.mgmt || {};

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-3">
            <Award size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-white font-mono">{ticker}</span>
            {metrics.industry && (
              <span className="text-[10px] text-[#a0aec0]">{metrics.industry}</span>
            )}
            {metrics.country && (
              <span className="text-[10px] text-[#7a8497]">{metrics.country}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-amber-300 font-mono">
                {score.value_score != null ? score.value_score.toFixed(1) : "—"}
              </span>
              <span className="text-[10px] text-[#a0aec0]">/ 100</span>
            </div>
            <button
              onClick={onClose}
              className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
          {/* coverage 警告 */}
          {score.coverage === "minimal" && (
            <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 px-2 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded">
              <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
              <span>数据覆盖不足（minimal），评分可能不准 — 这通常是新上市/小市值股 yfinance 财报缺失</span>
            </div>
          )}

          {/* 雷达图 + 子分 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3">
              <div className="text-[10px] text-[#a0aec0] mb-1">5 维评分雷达</div>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                  <Radar
                    name={ticker}
                    dataKey="value"
                    stroke="#fbbf24"
                    fill="#fbbf24"
                    fillOpacity={0.25}
                    strokeWidth={1.8}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="glass-card p-3">
              <div className="text-[10px] text-[#a0aec0] mb-2">子项评分（权重预设）</div>
              <div className="space-y-1.5">
                {Object.entries(SUB_LABELS).map(([k, label]) => {
                  const v = subs[k];
                  const w = (score.weights_used || {})[k];
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-[10px] text-[#d0d7e2] w-12">{label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-amber-300"
                          style={{ width: `${v != null ? Math.max(2, Math.min(100, v)) : 0}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-white w-10 text-right">
                        {v != null ? v.toFixed(0) : "—"}
                      </span>
                      <span className="text-[8px] text-[#7a8497] w-6 text-right">{w}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[9px] text-[#7a8497]">
                数据覆盖：{score.coverage || "—"}
              </div>
            </div>
          </div>

          {/* LLM moat */}
          {moat_llm && (
            <div className="glass-card p-3 border border-violet-500/20">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-violet-400" />
                <span className="text-[11px] font-medium text-violet-300">护城河 AI 评估（巴菲特四维）</span>
                <Zap size={9} className="text-amber-300" title="缓存 90 天" />
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { k: "brand", label: "品牌" },
                  { k: "network", label: "网络效应" },
                  { k: "switching", label: "转换成本" },
                  { k: "low_cost", label: "低成本" },
                ].map(({ k, label }) => (
                  <div key={k} className="text-center">
                    <div className="text-[9px] text-[#a0aec0]">{label}</div>
                    <div className="text-base font-mono font-semibold text-violet-200">
                      {moat_llm[k] != null ? moat_llm[k] : "—"}
                    </div>
                  </div>
                ))}
              </div>
              {moat_llm.narrative && (
                <div className="text-[10px] text-[#d0d7e2] leading-relaxed mt-1 whitespace-pre-line">
                  {moat_llm.narrative}
                </div>
              )}
              {moat_llm.dimensions && (
                <div className="text-[9px] text-violet-300/70 mt-1">{moat_llm.dimensions}</div>
              )}
            </div>
          )}

          {/* explain */}
          {explain && (
            <div className="glass-card p-3 border border-cyan-500/20">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-cyan-400" />
                <span className="text-[11px] font-medium text-cyan-300">为什么得这个分</span>
              </div>
              <div className="space-y-1 text-[10px] leading-relaxed">
                {[
                  ["📊 总评", explain["总评"]],
                  ["💪 强项", explain["强项"]],
                  ["⚠️ 弱项", explain["弱项"]],
                  ["👀 关注点", explain["关注点"]],
                ].map(([label, text]) => (
                  <div key={label} className="flex items-start gap-1.5">
                    <span className="text-[9px] text-[#7a8497] shrink-0 w-12">{label}</span>
                    <span className="text-[#d0d7e2] flex-1">{text || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关键指标 grid */}
          <div className="glass-card p-3">
            <div className="text-[10px] text-[#a0aec0] mb-2">关键指标</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-[10px]">
              <Stat label="市值" value={fmtBig(metrics.market_cap)} />
              <Stat label="PE TTM" value={metrics.pe_ttm != null ? metrics.pe_ttm.toFixed(1) : "—"} />
              <Stat label="PB" value={metrics.pb != null ? metrics.pb.toFixed(2) : "—"} />
              <Stat label="ROE" value={fmtPct(metrics.roe_ttm)} />
              <Stat label="毛利率" value={fmtPct(metrics.gross_margin)} />
              <Stat label="净利率" value={fmtPct(metrics.profit_margin)} />
              <Stat label="负债/权益" value={metrics.debt_to_equity != null ? `${metrics.debt_to_equity.toFixed(0)}%` : "—"} />
              <Stat label="FCF (TTM)" value={fmtBig(metrics.fcf_ttm)} />
              <Stat label="FCF 5y CAGR" value={fmtPct(metrics.fcf_5y_cagr, 2)} />
              <Stat label="净利 5y CAGR" value={fmtPct(metrics.profit_5y_cagr, 2)} />
              <Stat label="营收 5y CAGR" value={fmtPct(metrics.revenue_5y_cagr, 2)} />
              <Stat label="股息率" value={metrics.dividend_yield != null ? `${metrics.dividend_yield.toFixed(2)}%` : "—"} />
              <Stat label="连续分红" value={metrics.dividend_streak_years != null ? `${metrics.dividend_streak_years} 年` : "—"} />
              <Stat
                label="5 年股本变化"
                value={metrics.shares_change_5y_pct != null ? fmtPct(metrics.shares_change_5y_pct, 1) : "—"}
                color={metrics.shares_change_5y_pct != null && metrics.shares_change_5y_pct < 0 ? "text-emerald-300" : ""}
              />
              <Stat label="DCF 内在价值" value={fmtBig(valDrv.intrinsic_value)} />
            </div>
            {valDrv.mkt_to_intrinsic != null && (
              <div className="text-[9px] text-[#7a8497] mt-2">
                市值/内在价值 = {valDrv.mkt_to_intrinsic.toFixed(2)}
                {valDrv.mkt_to_intrinsic < 0.7 ? " · 深度低估" : valDrv.mkt_to_intrinsic > 1.3 ? " · 高估" : " · 合理区间"}
              </div>
            )}
          </div>

          {/* 业务描述 */}
          {metrics.business_summary && (
            <div className="glass-card p-3">
              <div className="text-[10px] text-[#a0aec0] mb-1">业务描述</div>
              <div className="text-[10px] text-[#d0d7e2] leading-relaxed">
                {metrics.business_summary}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color = "" }) {
  return (
    <div>
      <div className="text-[9px] text-[#7a8497]">{label}</div>
      <div className={`font-mono ${color || "text-white"}`}>{value}</div>
    </div>
  );
}
