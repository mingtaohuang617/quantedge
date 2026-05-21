/**
 * Smart Beta — 三层策略可视化
 * ============================
 * L1 风险层 → Core/Sector 总比例
 * L2 Core 层 → 指数 ETF（三档预设）
 * L3 Sector 层 → 行业 ETF 评分 + 缓冲带选择
 *
 * 数据：GET /api/smart-beta/snapshot?core_preset=&k=&weight_mode=&current_holdings=
 */
import React, { useEffect, useState } from "react";
import {
  Activity, RefreshCw, Loader, AlertCircle, Settings, Layers, Compass,
  TrendingUp, TrendingDown, ArrowRight, Info,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis,
  YAxis, CartesianGrid,
} from "recharts";
import { apiFetch } from "../quant-platform.jsx";

// ─── 工具 ────────────────────────────────────────────────
const fmtPct = (v, digits = 1) =>
  v == null || isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v, digits = 1) =>
  v == null || isNaN(v) ? "—" : Number(v).toFixed(digits);

const CORE_PRESETS = [
  { id: "balanced", label: "平衡版 (SPY+QQQ+IWM)" },
  { id: "simple",   label: "简洁版 (SPY 100%)" },
  { id: "factor",   label: "因子版 (MTUM/QUAL/VLUE/USMV)" },
];

const WEIGHT_MODES = [
  { id: "equal",    label: "等权" },
  { id: "momentum", label: "动量加权" },
];

const CORE_COLORS = ["#6366f1", "#8b5cf6", "#0ea5e9", "#06b6d4"];
const SECTOR_COLORS = [
  "#f59e0b", "#ef4444", "#ec4899", "#10b981", "#84cc16",
  "#14b8a6", "#22d3ee", "#a855f7", "#eab308",
];

const riskColor = (r) => {
  if (r == null) return "#a0aec0";
  if (r >= 0.7) return "#10b981";
  if (r >= 0.4) return "#f59e0b";
  return "#ef4444";
};

// ─── 风险评分 dial（SVG）─────────────────────────────────
const RiskDial = ({ score, components }) => {
  const r = score ?? 0.5;
  const angle = -Math.PI + Math.PI * r;
  const cx = 90, cy = 90, rad = 64;
  const endX = cx + rad * Math.cos(angle);
  const endY = cy + rad * Math.sin(angle);
  const startX = cx - rad;
  const startY = cy;
  const largeArc = r > 0.5 ? 1 : 0;

  return (
    <div className="flex flex-col items-center">
      <svg width={180} height={110} viewBox="0 0 180 110">
        <path
          d={`M ${startX} ${startY} A ${rad} ${rad} 0 1 1 ${cx + rad} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d={`M ${startX} ${startY} A ${rad} ${rad} 0 ${largeArc} 1 ${endX} ${endY}`}
          fill="none" stroke={riskColor(r)} strokeWidth={10}
          strokeLinecap="round"
        />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#e2e8f0"
              fontSize={22} fontWeight={700} fontFamily="ui-monospace">
          {(r * 100).toFixed(0)}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#a0aec0" fontSize={10}>
          风险偏好
        </text>
      </svg>
      {components && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono mt-1">
          <span className="text-[#a0aec0]">VIX:     <span className="text-white">{fmtNum(components.vix, 2)}</span></span>
          <span className="text-[#a0aec0]">趋势:    <span className="text-white">{fmtNum(components.trend, 2)}</span></span>
          <span className="text-[#a0aec0]">信用:    <span className="text-white">{fmtNum(components.credit, 2)}</span></span>
          <span className="text-[#a0aec0]">实际利率:<span className="text-white">{fmtNum(components.real_rate, 2)}</span></span>
        </div>
      )}
    </div>
  );
};

// ─── Core/Sector pie ─────────────────────────────────────
const CoreSectorPie = ({ coreWeight, sectorWeight }) => {
  const data = [
    { name: "Core 指数",   value: coreWeight * 100,   color: "#6366f1" },
    { name: "Sector 行业", value: sectorWeight * 100, color: "#f59e0b" },
  ];
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={130}>
        <PieChart>
          <Pie
            data={data} dataKey="value" innerRadius={32} outerRadius={56}
            paddingAngle={2} stroke="none"
          >
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
            formatter={(v) => `${v.toFixed(1)}%`}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-3 text-[10px] font-mono">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-indigo-500" /> Core
          <span className="text-white">{fmtPct(coreWeight, 1)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-500" /> Sector
          <span className="text-white">{fmtPct(sectorWeight, 1)}</span>
        </span>
      </div>
    </div>
  );
};

// ─── 持仓 diff 提示 ─────────────────────────────────────
const RebalanceHint = ({ selected, currentHoldings }) => {
  const cur = (currentHoldings || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const sel = selected || [];
  const added = sel.filter(t => !cur.includes(t));
  const removed = cur.filter(t => !sel.includes(t));
  const kept = sel.filter(t => cur.includes(t));

  if (!cur.length) {
    return (
      <div className="text-[11px] text-[#a0aec0] leading-relaxed">
        <p className="mb-1">推荐持仓（首次配置）：</p>
        <div className="flex flex-wrap gap-1">
          {sel.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] opacity-70">在上方输入"当前持仓"可看到换仓建议</p>
      </div>
    );
  }
  return (
    <div className="text-[11px] space-y-1.5">
      {kept.length > 0 && (
        <div>
          <span className="text-[#a0aec0]">保留：</span>
          {kept.map(t => (
            <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/10 font-mono">
              {t}
            </span>
          ))}
        </div>
      )}
      {added.length > 0 && (
        <div className="flex items-start gap-1">
          <TrendingUp size={11} className="text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <span className="text-emerald-300">买入：</span>
            {added.map(t => (
              <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div className="flex items-start gap-1">
          <TrendingDown size={11} className="text-rose-400 mt-0.5 shrink-0" />
          <div>
            <span className="text-rose-300">卖出：</span>
            {removed.map(t => (
              <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {!added.length && !removed.length && (
        <div className="text-[#a0aec0]">无变化 — 当前持仓符合策略</div>
      )}
    </div>
  );
};

// ─── 行业 ETF 排名表 ────────────────────────────────────
const SectorRankTable = ({ ranked, selected }) => {
  const selSet = new Set(selected || []);
  if (!ranked || !ranked.length) {
    return <div className="text-[#a0aec0] text-xs">无数据</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead className="text-[10px] text-[#a0aec0] uppercase">
          <tr className="border-b border-white/10">
            <th className="px-2 py-1.5 text-left">#</th>
            <th className="px-2 py-1.5 text-left">ETF</th>
            <th className="px-2 py-1.5 text-left">名称</th>
            <th className="px-2 py-1.5 text-right">总分</th>
            <th className="px-2 py-1.5 text-right">趋势</th>
            <th className="px-2 py-1.5 text-right">相对</th>
            <th className="px-2 py-1.5 text-right">资金</th>
            <th className="px-2 py-1.5 text-right">夏普</th>
            <th className="px-2 py-1.5 text-right">RSI</th>
            <th className="px-2 py-1.5 text-right">费率</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, i) => {
            const sel = selSet.has(row.ticker);
            const c = row.components || {};
            return (
              <tr key={row.ticker}
                  className={`border-b border-white/5 ${sel ? "bg-indigo-500/[0.06]" : ""} hover:bg-white/[0.03]`}>
                <td className="px-2 py-1.5 text-[#a0aec0]">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded border ${
                    sel ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/40"
                        : "bg-white/[0.03] text-white/80 border-white/10"
                  }`}>
                    {row.ticker}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-white/70 truncate max-w-[180px]">{row.name}</td>
                <td className="px-2 py-1.5 text-right text-white font-semibold">{fmtNum(row.score, 1)}</td>
                <td className="px-2 py-1.5 text-right text-[#a0aec0]">{fmtNum(c.trend, 0)}</td>
                <td className="px-2 py-1.5 text-right text-[#a0aec0]">{fmtNum(c.relative, 0)}</td>
                <td className="px-2 py-1.5 text-right text-[#a0aec0]">{fmtNum(c.flow, 0)}</td>
                <td className="px-2 py-1.5 text-right text-[#a0aec0]">{fmtNum(c.sharpe, 0)}</td>
                <td className={`px-2 py-1.5 text-right ${c.rsi > 75 ? "text-rose-300" : "text-[#a0aec0]"}`}>
                  {fmtNum(c.rsi, 0)}
                </td>
                <td className="px-2 py-1.5 text-right text-[#a0aec0]">
                  {row.expense_ratio != null ? `${(row.expense_ratio * 100).toFixed(2)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ─── 最终权重 横向 bar ─────────────────────────────────
const FinalWeightsChart = ({ weights }) => {
  const data = Object.entries(weights || {})
    .map(([ticker, w]) => ({ ticker, weight: w * 100 }))
    .sort((a, b) => b.weight - a.weight);

  if (!data.length) return <div className="text-[#a0aec0] text-xs">—</div>;

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 28)}>
      <BarChart layout="vertical" data={data}
                margin={{ left: 36, right: 40, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis type="number" stroke="#6b7280" fontSize={10}
               tickFormatter={(v) => `${v.toFixed(0)}%`} />
        <YAxis type="category" dataKey="ticker" stroke="#a0aec0" fontSize={11}
               width={50} />
        <Tooltip
          contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
          formatter={(v) => `${v.toFixed(2)}%`}
        />
        <Bar dataKey="weight" fill="#6366f1" radius={[0, 3, 3, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={i < 5 ? CORE_COLORS[i % CORE_COLORS.length] : SECTOR_COLORS[i % SECTOR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ═════════════════════════════════════════════════════════
//  主组件
// ═════════════════════════════════════════════════════════
export default function SmartBeta() {
  const [config, setConfig] = useState({
    core_preset: "balanced",
    k: 3,
    weight_mode: "equal",
    current_holdings: "",
  });
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSnapshot = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        core_preset: config.core_preset,
        k: String(config.k),
        weight_mode: config.weight_mode,
      });
      if (config.current_holdings.trim()) {
        params.set("current_holdings", config.current_holdings.trim());
      }
      const data = await apiFetch(`/smart-beta/snapshot?${params.toString()}`);
      if (!data) {
        setError("API 不可用 — 请确认后端 server.py 在跑");
      } else if (data.detail) {
        setError(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail));
      } else {
        setSnapshot(data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSnapshot(); /* eslint-disable-next-line */ }, []);

  const coreWeight = snapshot?.core_weight ?? 0;
  const sectorWeight = 1 - coreWeight;
  const riskScore = snapshot?.risk?.risk_score;
  const riskComponents = snapshot?.risk?.components;
  const ranked = snapshot?.sector_ranked || [];
  const selected = snapshot?.sector_selected || [];
  const finalWeights = snapshot?.weights || {};
  const coreAlloc = snapshot?.core_alloc || {};
  const sectorAlloc = snapshot?.sector_alloc || {};

  return (
    <div className="h-full overflow-y-auto bg-[#0d1117] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-white/10 px-4 py-2.5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-indigo-400" />
              <h2 className="text-sm font-semibold tracking-tight">Smart Beta · 指数 + 行业 ETF 动态轮动</h2>
            </div>
            <p className="text-[10px] text-[#a0aec0] mt-0.5">
              三层：风险层（VIX/趋势/信用利差/实际利率）→ Core ETF 配比 → 行业 ETF 评分轮动
              {snapshot?.as_of && <span className="ml-2 font-mono">· 基准日 {snapshot.as_of.slice(0, 10)}</span>}
            </p>
          </div>
          <button
            onClick={fetchSnapshot}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 disabled:opacity-50"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {loading ? "计算中…" : "重新计算"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 mt-2.5">
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-1 block">Core 预设</label>
            <select
              value={config.core_preset}
              onChange={(e) => setConfig(c => ({ ...c, core_preset: e.target.value }))}
              className="w-full bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-500/50"
            >
              {CORE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-1 block">行业 ETF 选 K 只</label>
            <select
              value={config.k}
              onChange={(e) => setConfig(c => ({ ...c, k: Number(e.target.value) }))}
              className="w-full bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
            >
              {[2, 3, 4, 5, 6].map(k => <option key={k} value={k}>Top {k}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-1 block">权重模式</label>
            <select
              value={config.weight_mode}
              onChange={(e) => setConfig(c => ({ ...c, weight_mode: e.target.value }))}
              className="w-full bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
            >
              {WEIGHT_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-1 flex items-center gap-1">
              当前持仓行业 ETF
              <span className="text-[#6b7280]" title="逗号分隔，如 XLK,XLF,XLV — 用于缓冲带判断">
                <Info size={9} />
              </span>
            </label>
            <input
              type="text"
              value={config.current_holdings}
              onChange={(e) => setConfig(c => ({ ...c, current_holdings: e.target.value }))}
              placeholder="XLK,XLF,XLV"
              className="w-full bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-[11px] text-white font-mono placeholder:text-[#6b7280]"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="m-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">加载失败</div>
            <div className="font-mono">{error}</div>
          </div>
        </div>
      )}

      {snapshot && (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Compass size={13} className="text-amber-400" />
                <h3 className="text-[11px] font-semibold text-white/90">L1 · 风险评分</h3>
              </div>
              <RiskDial score={riskScore} components={riskComponents} />
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={13} className="text-indigo-400" />
                <h3 className="text-[11px] font-semibold text-white/90">L1 → 总比例</h3>
              </div>
              <CoreSectorPie coreWeight={coreWeight} sectorWeight={sectorWeight} />
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2 mb-2">
                <ArrowRight size={13} className="text-emerald-400" />
                <h3 className="text-[11px] font-semibold text-white/90">L3 · 调仓建议</h3>
              </div>
              <RebalanceHint selected={selected} currentHoldings={config.current_holdings} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <h3 className="text-[11px] font-semibold text-white/90 mb-1.5">
                L2 Core 内部配置 <span className="text-[#a0aec0] font-normal">· {config.core_preset}</span>
              </h3>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                {Object.entries(coreAlloc).map(([t, w]) => (
                  <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-200 border border-indigo-500/30">
                    {t} <span className="text-indigo-400">{fmtPct(w, 0)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <h3 className="text-[11px] font-semibold text-white/90 mb-1.5">
                L3 Sector 选中 ETF <span className="text-[#a0aec0] font-normal">· {config.weight_mode}</span>
              </h3>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                {Object.entries(sectorAlloc).map(([t, w]) => (
                  <span key={t} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/30">
                    {t} <span className="text-amber-400">{fmtPct(w, 0)}</span>
                  </span>
                ))}
                {!Object.keys(sectorAlloc).length && <span className="text-[#a0aec0]">—</span>}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-white/90 flex items-center gap-1.5">
                <Activity size={13} className="text-cyan-400" />
                行业 ETF 评分排名（蓝底为选中）
              </h3>
              <span className="text-[10px] text-[#a0aec0]">
                {ranked.length} 只候选 · 选 Top {config.k}
              </span>
            </div>
            <SectorRankTable ranked={ranked} selected={selected} />
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-white/90 flex items-center gap-1.5">
                <Settings size={13} className="text-indigo-400" />
                最终推荐权重 = Core × {fmtPct(coreWeight, 0)} + Sector × {fmtPct(sectorWeight, 0)}
              </h3>
              <span className="text-[10px] text-[#a0aec0] font-mono">
                合计 {fmtPct(Object.values(finalWeights).reduce((a, b) => a + b, 0), 1)}
              </span>
            </div>
            <FinalWeightsChart weights={finalWeights} />
          </div>

          {snapshot.fetch_errors && snapshot.fetch_errors.length > 0 && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-[10px] text-amber-300">
              <span className="font-semibold">数据警告：</span>
              以下 ETF 数据拉取失败，已从排名中排除：{snapshot.fetch_errors.join(", ")}
            </div>
          )}
        </div>
      )}

      {!snapshot && !error && (
        <div className="flex items-center justify-center h-[60vh] text-[#a0aec0] text-xs">
          <div className="flex items-center gap-2">
            {loading ? <Loader size={14} className="animate-spin" /> : <Layers size={14} />}
            {loading ? "首次计算需要 30-60s（拉取 SPY/VIX/行业 ETF 历史）…" : "点击「重新计算」开始"}
          </div>
        </div>
      )}
    </div>
  );
}
