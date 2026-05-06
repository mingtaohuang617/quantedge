// ─────────────────────────────────────────────────────────────
// BacktestModal — 价值型策略历史回测结果展示（V5）
// ─────────────────────────────────────────────────────────────
//
// 4 段呈现（用户决策）：
//   1. Top N 表格：ticker / value_score / 5 维子分 / 总回报
//   2. 等权策略净值 vs S&P 500 折线图
//   3. Quintile 分位平均回报 bar chart
//   4. 维度归因（Pearson r）bar chart
//
// 数据来源：POST /api/value/backtest
// ─────────────────────────────────────────────────────────────
import React from "react";
import { X, BarChart3, Loader, AlertCircle } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

const SUB_LABELS = {
  moat: "护城河",
  financial: "财务",
  mgmt: "管理层",
  valuation: "估值",
  compound: "复利",
};

const TOOLTIP_STYLE = {
  background: "rgba(20,24,32,0.96)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  fontSize: 11,
  color: "#fff",
};

function fmtPct(v, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export default function BacktestModal({ data, loading, error, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-white">价值型策略 — 历史回测</span>
            {data?.meta && (
              <span className="text-[10px] text-[#a0aec0]">
                · 扫描 {data.meta.scanned} / 评分 {data.meta.scored}
                · 回看 {data.meta.lookback_years} 年 vs {data.meta.benchmark}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white p-1 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {loading && (
            <div className="h-64 flex items-center justify-center gap-2 text-[#a0aec0]">
              <Loader className="animate-spin" /> 正在拉取过去 N 年价格 + 评分...
              <span className="text-[10px]">(每只票 ~3 个 yfinance 调用，约 1-3 分钟)</span>
            </div>
          )}
          {error && (
            <div className="m-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-300/90 flex items-start gap-1.5">
              <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* 1. Top N 表格 */}
              <Section title={`Top ${data.top_n} 评分排名 + 总回报`}>
                {data.ranked && data.ranked.length > 0 ? (
                  <div className="overflow-auto max-h-72">
                    <table className="w-full text-[10px]">
                      <thead className="text-[9px] text-[#7a8497] sticky top-0 bg-[var(--surface)]/95">
                        <tr>
                          <th className="text-left px-2 py-1">#</th>
                          <th className="text-left px-2 py-1">Ticker</th>
                          <th className="text-right px-2 py-1">总分</th>
                          <th className="text-right px-2 py-1">护城河</th>
                          <th className="text-right px-2 py-1">财务</th>
                          <th className="text-right px-2 py-1">管理</th>
                          <th className="text-right px-2 py-1">估值</th>
                          <th className="text-right px-2 py-1">复利</th>
                          <th className="text-right px-2 py-1 text-emerald-300">{data.meta.lookback_years}年回报</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ranked.map((r, i) => {
                          const ret = r.total_return;
                          const subs = r.sub_scores || {};
                          return (
                            <tr key={r.ticker} className="border-t border-white/5">
                              <td className="px-2 py-1 text-[#7a8497]">{i + 1}</td>
                              <td className="px-2 py-1 font-mono text-white">{r.ticker}</td>
                              <td className="px-2 py-1 text-right font-mono text-amber-300 font-semibold">{r.value_score?.toFixed(1)}</td>
                              {["moat","financial","mgmt","valuation","compound"].map((k) => (
                                <td key={k} className="px-2 py-1 text-right text-[#d0d7e2]">{subs[k] != null ? subs[k].toFixed(0) : "—"}</td>
                              ))}
                              <td className={`px-2 py-1 text-right font-mono font-semibold ${ret > 0 ? "text-emerald-300" : "text-red-300"}`}>
                                {fmtPct(ret, 1)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty msg="无数据 — 大概率所有 ticker 财务拉取失败" />
                )}
              </Section>

              {/* 2. 净值曲线 */}
              <Section title={`策略净值（等权 ${data.top_n} 月度再平衡）vs ${data.meta.benchmark}`}>
                {data.nav ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart
                      data={data.nav.dates.map((d, i) => ({
                        date: d,
                        strategy: data.nav.strategy[i],
                        benchmark: data.nav.benchmark[i],
                      }))}
                      margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 9 }} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={1} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="strategy" name="策略" stroke="#fbbf24" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="benchmark" name="基准" stroke="#06b6d4" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty msg="净值数据不足（需至少 1 只票有完整价格）" />
                )}
              </Section>

              {/* 3. Quintile 分位 */}
              <Section title="分位表现差（按 value_score 五等分各档平均回报）">
                {Object.keys(data.quintile_returns || {}).length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={Object.entries(data.quintile_returns).map(([q, r]) => ({
                        bucket: q.toUpperCase() + (q === "q5" ? " (最高分)" : q === "q1" ? " (最低分)" : ""),
                        avg_return: r * 100,
                      }))}
                    >
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="bucket" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} unit="%" />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="avg_return" fill="#fbbf24" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty msg="样本不足（< 5 只）无法分位" />
                )}
                <div className="text-[9px] text-[#7a8497] mt-1">
                  理想曲线：q5 (高分) 显著高于 q1 (低分) → 评分有效
                </div>
              </Section>

              {/* 4. 维度归因 */}
              <Section title="维度归因（Pearson r：每个子分与总回报的相关性）">
                {Object.keys(data.attribution || {}).filter((k) => data.attribution[k] != null).length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={Object.entries(data.attribution || {}).map(([k, r]) => ({
                        dim: SUB_LABELS[k] || k,
                        correlation: r != null ? r : 0,
                      }))}
                    >
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="dim" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} domain={[-1, 1]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => v.toFixed(3)} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                      <Bar
                        dataKey="correlation"
                        fill="#06b6d4"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty msg="样本不足" />
                )}
                <div className="text-[9px] text-[#7a8497] mt-1">
                  正相关 = 维度高分确实带来更高回报；负相关 = 该维度可能反向（高分反而表现差）
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="glass-card p-3">
      <div className="text-[11px] text-[#a0aec0] mb-2 font-medium">{title}</div>
      {children}
    </div>
  );
}

function Empty({ msg }) {
  return <div className="text-[10px] text-[#7a8497] py-4 text-center">{msg}</div>;
}
