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
  TrendingUp, TrendingDown, ArrowRight, Info, Play,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis,
  YAxis, CartesianGrid, LineChart, Line, Legend,
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
  // SVG y 向下：sweep=1 走上半圆（视觉 CCW，math CW），large=0 总是短弧
  // 注意：endY 用 sin(angle) 计算 → r<1 时 endY < cy，端点在上方
  //       所以 from (26,90) 到 endpoint 的"短弧"已经在上半圆，不需要 large-arc

  return (
    <div className="flex flex-col items-center">
      <svg width={180} height={110} viewBox="0 0 180 110">
        <path
          d={`M ${startX} ${startY} A ${rad} ${rad} 0 0 1 ${cx + rad} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d={`M ${startX} ${startY} A ${rad} ${rad} 0 0 1 ${endX} ${endY}`}
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
    // w-full 关键：父 flex-col items-center 不带宽度时 ResponsiveContainer 100% 会坍缩成 0
    <div className="flex flex-col items-center w-full">
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
          <TrendingUp size={11} className="text-up mt-0.5 shrink-0" />
          <div>
            <span className="text-up">买入：</span>
            {added.map(t => (
              <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-up/10 text-up border border-up/30 font-mono">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div className="flex items-start gap-1">
          <TrendingDown size={11} className="text-down mt-0.5 shrink-0" />
          <div>
            <span className="text-down">卖出：</span>
            {removed.map(t => (
              <span key={t} className="ml-1 px-1.5 py-0.5 rounded bg-down/10 text-down border border-down/30 font-mono">
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
                <td className={`px-2 py-1.5 text-right ${c.rsi > 75 ? "text-down" : "text-[#a0aec0]"}`}>
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
  const [isDemoMode, setIsDemoMode] = useState(false);
  // 历史回测 — 月度再平衡 vs SPY
  const [btStart, setBtStart] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().slice(0, 10);
  });
  const [btResult, setBtResult] = useState(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState(null);

  const runBacktest = async () => {
    setBtLoading(true); setBtError(null);
    const params = new URLSearchParams({
      start_date: btStart,
      core_preset: config.core_preset,
      k: String(config.k),
      weight_mode: config.weight_mode,
    });
    const url = `/smart-beta/backtest?${params.toString()}`;
    // 首次回测计算量大（拉 16 ETF × 数年历史 + 月度滚动），Vercel 代理 ~55s 会超时，
    // 但后端不会中断、会跑完并写 1h 缓存。检测到超时就倒计时等后端落地，再重试一次秒回。
    const isTimeout = (data, err) =>
      /timeout|超时|abort|504/i.test(String(data?.error || data?.detail || err?.message || ""));
    const attempt = () => apiFetch(url);

    try {
      let data;
      try {
        data = await attempt();
      } catch (e) {
        if (!isTimeout(null, e)) throw e;
        data = { error: "timeout" };
      }

      if (isTimeout(data, null)) {
        // 后端首次约 60-90s 算完写缓存；等 35s 让它落地，再重试 → 命中缓存秒回
        for (let s = 35; s > 0; s--) {
          setBtError(`首次回测计算量大（16 ETF × 数年），后端计算中，${s}s 后自动重试…`);
          await new Promise(r => setTimeout(r, 1000));
        }
        setBtError(null);
        try {
          data = await attempt();
        } catch (e) {
          if (!isTimeout(null, e)) throw e;
          data = { error: "still_computing" };
        }
      }

      if (data && !data.detail && !data.error) {
        setBtResult(data);
      } else if (data?.error === "still_computing") {
        setBtError("回测仍在计算 — 请稍后再点「运行回测」，缓存就绪后会秒回。");
      } else {
        setBtError(typeof (data?.detail || data?.error) === "string"
          ? (data.detail || data.error)
          : "回测失败 — 后端未就绪");
        setBtResult(null);
      }
    } catch (e) {
      setBtError(String(e?.message || e));
    } finally {
      setBtLoading(false);
    }
  };

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
      if (data && !data.detail) {
        setSnapshot(data);
        setIsDemoMode(false);
      } else if (data && data.detail) {
        setError(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail));
      } else {
        // 后端不可达 → 灌 demo 数据让 Vercel 等纯前端部署也能展示完整功能。
        // Dynamic import 拆独立 chunk，只在 fallback 时下载，不污染本地 dev bundle。
        try {
          const mod = await import("../data/smartBetaDemo.js");
          setSnapshot(mod.demoSmartBeta);
          setIsDemoMode(true);
          setError(null);
        } catch {
          // demo 模块加载也失败（罕见）→ 友好文案
          setError("数据服务暂时无法连接，请稍后点击「重新计算」重试");
        }
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
    // v5 对齐：移除 bg-[#0d1117] 硬编码，让父 shell 的 theme bg 透出来
    <div className="h-full overflow-y-auto">
      {/* Header — sticky + glass-card 风（与其他 tab 一致） */}
      <div className="sticky top-0 z-10 backdrop-blur border-b border-white/8 px-4 py-2.5" style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Layers size={16} className="text-indigo-400" />
              <h2 className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Smart Beta · 指数 + 行业 ETF 动态轮动</h2>
              {isDemoMode && (
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/40"
                  title="后端未连接，展示静态示例快照。启动 backend/server.py 后点「重新计算」可拉真实数据。"
                >
                  DEMO 模式
                </span>
              )}
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
              三层：风险层（VIX/趋势/信用利差/实际利率）→ Core ETF 配比 → 行业 ETF 评分轮动
              {snapshot?.as_of && <span className="ml-2 font-mono">· 基准日 {snapshot.as_of.slice(0, 10)}</span>}
            </p>
          </div>
          <button
            onClick={fetchSnapshot}
            disabled={loading}
            aria-label={loading ? "正在计算" : "重新计算 Smart Beta 快照"}
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
        <div className="m-4 p-3 rounded-md bg-down/10 border border-down/30 text-down text-[11px] flex items-start gap-2">
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
            <div className="glass-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <Compass size={13} className="text-amber-400" />
                <h3 className="text-[11px] font-semibold text-white/90">L1 · 风险评分</h3>
              </div>
              <RiskDial score={riskScore} components={riskComponents} />
            </div>

            <div className="glass-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={13} className="text-indigo-400" />
                <h3 className="text-[11px] font-semibold text-white/90">L1 → 总比例</h3>
              </div>
              <CoreSectorPie coreWeight={coreWeight} sectorWeight={sectorWeight} />
            </div>

            <div className="glass-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <ArrowRight size={13} className="text-up" />
                <h3 className="text-[11px] font-semibold text-white/90">L3 · 调仓建议</h3>
              </div>
              <RebalanceHint selected={selected} currentHoldings={config.current_holdings} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="glass-card p-3">
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
            <div className="glass-card p-3">
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

          <div className="glass-card p-3">
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

          <div className="glass-card p-3">
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

          {/* §6 历史回测 — 月度再平衡 vs SPY benchmark */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Play size={13} className="text-emerald-400" />
                <span className="text-[11px] font-semibold text-white/90">历史回测</span>
                <span className="text-[10px] text-[#a0aec0]">月度再平衡 + K+2 缓冲带 vs SPY 100%</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-[#a0aec0]">起始日</label>
                <input
                  type="date"
                  value={btStart}
                  onChange={(e) => setBtStart(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-indigo-500/50"
                />
                <button
                  onClick={runBacktest}
                  disabled={btLoading}
                  className="px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-[11px] text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1"
                >
                  {btLoading ? <Loader size={11} className="animate-spin" /> : <Play size={11} />}
                  {btLoading ? "回测中…" : "运行回测"}
                </button>
              </div>
            </div>

            {btError && (
              <div className="rounded-md bg-rose-500/10 border border-rose-500/30 p-2 text-[10px] text-rose-300 flex items-start gap-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                <span>{btError}</span>
              </div>
            )}

            {btLoading && !btResult && (
              <div className="text-[10px] text-[#a0aec0] py-4 text-center">
                首次回测开销大（拉 ETF 历史 + 月度滚动重算）— 预计 30-60s，缓存后秒回
              </div>
            )}

            {btResult && (
              <>
                {/* v5「预期特征四卡」— serif 大数字，一眼读出这套倾斜值不值（真实回测派生）*/}
                {(() => {
                  const m = btResult.metrics, bm = btResult.benchmark_metrics || {};
                  const alpha = (m.annualized_return != null && bm.annualized_return != null) ? m.annualized_return - bm.annualized_return : null;
                  const ws = Object.values(finalWeights || {});
                  const hhi = ws.length ? ws.reduce((a, w) => a + w * w, 0) : null;
                  const effN = hhi ? 1 / hhi : null;
                  const cards = [
                    { l: "预期年化", v: m.annualized_return != null ? fmtPct(m.annualized_return, 1) : "—", c: "#1ED395" },
                    { l: "超额 α (vs SPY)", v: alpha != null ? `${alpha >= 0 ? "+" : ""}${fmtPct(alpha, 1)}` : "—", c: alpha != null && alpha >= 0 ? "#1ED395" : "#FF6B6B" },
                    { l: "集中度", v: effN != null ? `${effN.toFixed(1)}` : "—", c: "#818CF8", sub: effN != null ? `有效持仓 · HHI ${(hhi * 100).toFixed(0)}` : "" },
                    { l: "Sharpe", v: m.sharpe != null ? fmtNum(m.sharpe, 2) : "—", c: "#5EE6E6" },
                  ];
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                      {cards.map((c) => (
                        <div key={c.l} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                          <div className="text-[9px] uppercase tracking-wider text-[#778] mb-1">{c.l}</div>
                          <div className="font-serif font-semibold text-[22px] leading-none" style={{ color: c.c, letterSpacing: "-0.02em" }}>{c.v}</div>
                          {c.sub && <div className="text-[9px] text-[#778] mt-1">{c.sub}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* 指标卡 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: "策略总收益", val: btResult.metrics.total_return, bench: btResult.benchmark_metrics.total_return, isPct: true },
                    { label: "年化收益", val: btResult.metrics.annualized_return, bench: btResult.benchmark_metrics.annualized_return, isPct: true },
                    { label: "Sharpe", val: btResult.metrics.sharpe, bench: btResult.benchmark_metrics.sharpe, isPct: false },
                    { label: "最大回撤", val: btResult.metrics.max_dd, bench: btResult.benchmark_metrics.max_dd, isPct: true, negGood: true },
                  ].map((m) => {
                    const win = m.negGood ? m.val > m.bench : m.val > m.bench;
                    const fmt = m.isPct ? fmtPct : fmtNum;
                    return (
                      <div key={m.label} className="rounded border border-white/10 bg-white/[0.02] p-2">
                        <div className="text-[9px] text-[#a0aec0]">{m.label}</div>
                        <div className={`text-sm font-mono font-bold ${win ? "text-emerald-300" : "text-rose-300"}`}>
                          {fmt(m.val, 2)}
                        </div>
                        <div className="text-[9px] text-[#778] font-mono">SPY: {fmt(m.bench, 2)}</div>
                      </div>
                    );
                  })}
                </div>

                {/* 净值曲线 */}
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={btResult.dates.map((d, i) => ({
                      date: d, strategy: btResult.strategy_nav[i], benchmark: btResult.benchmark_nav[i],
                    }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" tick={{ fill: "#a0aec0", fontSize: 9 }} interval="preserveStartEnd" minTickGap={50} />
                      <YAxis tick={{ fill: "#a0aec0", fontSize: 9 }} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", fontSize: 10 }}
                        formatter={(v) => fmtNum(v, 3)}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="strategy" name="Smart Beta" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="benchmark" name="SPY" stroke="#a0aec0" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="text-[10px] text-[#a0aec0] flex items-center gap-3 flex-wrap">
                  <span>窗口：<span className="text-white/80 font-mono">{btResult.start_date} → {btResult.end_date}</span></span>
                  <span>再平衡：<span className="text-white/80 font-mono">{btResult.rebalances.length} 次</span></span>
                  <span>累计 alpha：
                    <span className={`font-mono ml-1 ${btResult.alpha_total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {btResult.alpha_total >= 0 ? "+" : ""}{fmtPct(btResult.alpha_total, 2)}
                    </span>
                  </span>
                  {btResult._cached && <span className="text-amber-300">· 缓存命中</span>}
                </div>
              </>
            )}
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
