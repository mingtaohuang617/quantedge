// ─────────────────────────────────────────────────────────────
// MiningAlpha — 因子挖掘与策略构建主页面
// ─────────────────────────────────────────────────────────────
//
// 面板组成:
//   1) 流水线状态 + run_id 切换器（历史 runs 对比）
//   2) 回测指标卡片 + 多 Top-N 切片对比表
//   3) 策略净值曲线（含基准线 + HMM regime 色块 overlay）
//   4) 当前 Top 20 持仓（new/held/dropped 颜色标记）
//   5) 单因子 IC 排行 + ML 特征重要性
//   6) Walk-forward per-fold 测试集 IC 表
//
// 数据来源（FastAPI + CLI 产物）：
//   - GET /api/mining-alpha/status               流水线进度 + 历史 runs
//   - GET /api/mining-alpha/ic-report?top_n=20   IC 表
//   - GET /api/mining-alpha/feature-importance   特征重要性
//   - GET /api/mining-alpha/backtest             回测指标 + 净值 + 基准 + 多 Top-N
//   - GET /api/mining-alpha/top-holdings         Top N + 与上周差异
//   - GET /api/mining-alpha/regime               HMM regime 时序（overlay）
//   - GET /api/mining-alpha/fold-ic              per-fold IC
//   - POST /api/mining-alpha/switch-run/{id}     切换 latest run
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Zap, TrendingUp, Activity, Database, AlertCircle, Loader, RefreshCw, Target,
  Plus, Minus, ArrowRight, GitBranch, X, Play, Terminal, Grid3x3, Info,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar,
  CartesianGrid, ReferenceArea, Legend,
} from "recharts";
import { apiFetch } from "../quant-platform.jsx";
import { useMiningAlphaData } from "../hooks/useMiningAlphaData.js";

const fmtPct = (v, digits = 2) => (v === null || v === undefined || isNaN(v))
  ? "—" : `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v, digits = 3) => (v === null || v === undefined || isNaN(v))
  ? "—" : Number(v).toFixed(digits);

// ─── 流水线状态 chip ─────────────────────────────────────────
const StepChip = ({ label, done }) => (
  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${
    done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
         : "border-white/10 bg-white/[0.03] text-[#a0aec0]"
  }`}>
    <span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-white/20"}`} />
    {label}
  </div>
);

// ─── Run 切换器 ──────────────────────────────────────────────
const RunSwitcher = ({ status, onSwitch }) => {
  const [open, setOpen] = useState(false);
  // hook 必须在 early return 之前，避免 status 由空变非空时 hook 顺序变化
  if (!status?.history_runs?.length) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono bg-white/[0.03] border border-white/10 text-[#a0aec0] hover:text-white"
      >
        <GitBranch size={11} />
        run: <span className="text-cyan-300">{status.current_run_id || "—"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-[#0d1117] border border-white/10 rounded-md shadow-xl min-w-[220px]">
          <div className="px-2.5 py-1.5 text-[10px] text-[#a0aec0] border-b border-white/5">历史 runs ({status.history_runs.length})</div>
          <div className="max-h-[260px] overflow-y-auto">
            {status.history_runs.map(r => (
              <button
                key={r.run_id}
                onClick={() => { setOpen(false); onSwitch(r.run_id); }}
                className={`flex items-center justify-between w-full px-2.5 py-1.5 text-[10px] font-mono hover:bg-white/[0.05] text-left ${
                  r.run_id === status.current_run_id ? "text-cyan-300 bg-white/[0.04]" : "text-white/70"
                }`}
              >
                <span>{r.run_id}</span>
                <span className="text-[#a0aec0] text-[9px]">
                  {r.has_backtest ? "✓bt" : ""} {r.has_predictions ? "✓pred" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── IC 表 (rows clickable → 弹因子详情) ─────────────────────
const ICTable = ({ rows, onPickAlpha }) => {
  if (!rows || rows.length === 0) {
    return <div className="text-[#a0aec0] text-xs">IC 报告未生成。`mining_alpha.run ic-report`</div>;
  }
  return (
    <div className="overflow-auto max-h-[420px] rounded-lg border border-white/5">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[#0d1117] border-b border-white/10 text-[#a0aec0]">
          <tr>
            <th className="text-left px-3 py-2">Alpha</th>
            <th className="text-right px-3 py-2">IC mean</th>
            <th className="text-right px-3 py-2">ICIR</th>
            <th className="text-right px-3 py-2">t</th>
            <th className="text-right px-3 py-2">正胜率</th>
            <th className="text-right px-3 py-2">Top超额</th>
            <th className="text-right px-3 py-2">换手</th>
          </tr>
        </thead>
        <tbody className="text-white/90 tabular-nums font-mono">
          {rows.map((r, i) => (
            <tr key={i}
              onClick={() => onPickAlpha?.(r.alpha)}
              className="border-b border-white/5 hover:bg-cyan-500/10 cursor-pointer"
              title="点击查看因子公式 + 历史 IC"
            >
              <td className="px-3 py-1.5 text-left text-cyan-300 underline-offset-2 hover:underline">α{r.alpha}</td>
              <td className={`px-3 py-1.5 text-right ${r.ic_mean >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(r.ic_mean, 2)}</td>
              <td className={`px-3 py-1.5 text-right font-semibold ${Math.abs(r.ic_ir) >= 0.5 ? "text-amber-300" : "text-white/70"}`}>{fmtNum(r.ic_ir, 2)}</td>
              <td className="px-3 py-1.5 text-right text-white/60">{fmtNum(r.ic_t, 2)}</td>
              <td className="px-3 py-1.5 text-right text-white/60">{fmtPct(r.ic_pos_rate, 0)}</td>
              <td className="px-3 py-1.5 text-right text-white/60">{fmtPct(r.top_excess_mean, 2)}</td>
              <td className="px-3 py-1.5 text-right text-white/40">{fmtPct(r.turnover, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── IC 热力图 (factor × month) ──────────────────────────────
const IC_COLOR_SCALE = (ic) => {
  // ic in [-0.1, 0.1] → 红/灰/绿
  const v = Math.max(-0.1, Math.min(0.1, ic));
  const alpha = Math.abs(v) / 0.1;
  if (v >= 0) return `rgba(16,185,129,${alpha.toFixed(2)})`;  // emerald
  return `rgba(244,63,94,${alpha.toFixed(2)})`;                // rose
};

const ICHeatmap = ({ data, onPickAlpha }) => {
  // hook 必须在 early return 之前，避免 data 由空变非空时 hook 顺序变化
  const lookup = useMemo(() => {
    const m = new Map();
    (data?.cells || []).forEach(c => { m.set(`${c.alpha}|${c.month}`, c.ic); });
    return m;
  }, [data]);
  if (!data?.cells?.length) return <div className="text-[#a0aec0] text-xs">IC 热力图未生成。`mining_alpha.run ic-report` 后会自动产出 ic_monthly_heatmap.csv</div>;
  const { alphas, months } = data;
  return (
    <div className="overflow-auto max-h-[480px] rounded-lg border border-white/5">
      <table className="text-[10px] font-mono tabular-nums">
        <thead className="sticky top-0 bg-[#0d1117] z-10">
          <tr>
            <th className="text-left px-2 py-1.5 text-[#a0aec0] sticky left-0 bg-[#0d1117]">Alpha</th>
            {months.map(m => (
              <th key={m} className="text-center px-1.5 py-1.5 text-[#a0aec0] whitespace-nowrap" style={{ minWidth: 36 }}>
                {m.slice(2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alphas.map(a => (
            <tr key={a} className="hover:bg-white/[0.02]">
              <td onClick={() => onPickAlpha?.(a)}
                  className="text-left px-2 py-1 text-cyan-300 cursor-pointer hover:underline sticky left-0 bg-[#0d1117]">
                α{a}
              </td>
              {months.map(m => {
                const v = lookup.get(`${a}|${m}`);
                return (
                  <td key={m} className="text-center px-1 py-1"
                      style={{ background: v != null ? IC_COLOR_SCALE(v) : "transparent",
                               color: Math.abs(v ?? 0) > 0.05 ? "white" : "#a0aec0" }}
                      title={v != null ? `α${a} @ ${m}: IC = ${(v * 100).toFixed(2)}%` : "—"}
                  >
                    {v != null ? Math.abs(v * 100).toFixed(1) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── 因子详情 modal (点击 alpha 弹) ─────────────────────────
const FactorDetailModal = ({ alphaNum, runId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (alphaNum == null) return;
    let cancelled = false;
    setLoading(true);
    const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
    apiFetch(`/mining-alpha/factor-detail/${alphaNum}${qs}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [alphaNum, runId]);
  if (alphaNum == null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 max-w-[700px] w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-cyan-400" />
            <h3 className="text-sm font-bold text-white">α{alphaNum} 详情</h3>
            {data?.category && <span className="text-[10px] text-[#a0aec0] px-2 py-0.5 rounded bg-white/5">{data.category}</span>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-[#a0aec0]"><X size={14} /></button>
        </div>
        {loading && <div className="text-[#a0aec0] text-xs flex items-center gap-2"><Loader size={12} className="animate-spin" />加载中...</div>}
        {!loading && !data && <div className="text-rose-300 text-xs">未找到详情</div>}
        {!loading && data && (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-[#a0aec0] mb-1">公式描述</div>
              <div className="text-[12px] text-white/90 font-mono leading-relaxed bg-black/40 rounded px-3 py-2 border border-white/5">{data.description || "—"}</div>
            </div>
            {data.stats && Object.keys(data.stats).length > 0 && (
              <div>
                <div className="text-[10px] text-[#a0aec0] mb-1">IC 统计</div>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
                  {["ic_mean", "ic_ir", "ic_t", "ic_pos_rate", "top_excess_mean", "top_excess_ir", "turnover", "n_obs"].map(k => (
                    data.stats[k] != null && (
                      <div key={k} className="bg-white/[0.02] border border-white/5 rounded px-2 py-1.5">
                        <div className="text-[9px] text-[#a0aec0]">{k}</div>
                        <div className="text-[11px] font-mono text-white">
                          {k === "n_obs" ? Math.round(data.stats[k]) :
                           k.includes("pct") || k === "ic_pos_rate" || k === "turnover" ?
                           `${(data.stats[k] * 100).toFixed(1)}%` :
                           data.stats[k].toFixed(3)}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}
            {data.monthly_ic?.length > 0 && (
              <div>
                <div className="text-[10px] text-[#a0aec0] mb-1">月度 IC 时序</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.monthly_ic}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: "#a0aec0", fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "#a0aec0", fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={v => (v * 100).toFixed(2) + "%"} />
                    <Line type="monotone" dataKey="ic" stroke="#10b981" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Run Pipeline 面板 (后端 subprocess + 日志尾巴) ──────────
//   synthetic-demo 走 mining_alpha.synthetic_demo（不需 tushare 一键生数据）
//   其他 step 走 mining_alpha.run {step}
const STEPS = [
  { id: "synthetic-demo", label: "0. 合成 demo 数据 (无需 tushare)", extra: "--n-stocks 100 --years 5", standalone: true },
  { id: "sync-data", label: "1. 同步行情 (tushare)", extra: "" },
  { id: "compute-factors", label: "2. 算因子", extra: "" },
  { id: "ic-report", label: "3. IC 报告", extra: "--vol-scale-window 20 --filter-redundant" },
  { id: "optuna", label: "3b. Optuna", extra: "--n-trials 30" },
  { id: "train", label: "4. 训练", extra: "--use-optuna-params" },
  { id: "backtest", label: "5. 回测", extra: "--top-n 50 --use-tradeable-mask --multi-topn 20,50,100,200" },
];

const RunPipelinePanel = ({ runId, onJobDone }) => {
  const [jobState, setJobState] = useState(null);
  const [activeStep, setActiveStep] = useState(null);

  // 锁定 onJobDone 最新引用，避免 parent 每次重渲染都触发 effect cleanup
  const onJobDoneRef = useRef(onJobDone);
  useEffect(() => { onJobDoneRef.current = onJobDone; }, [onJobDone]);

  // 首次 mount：拉一次状态了解后端是否有任务在跑
  useEffect(() => {
    let cancelled = false;
    apiFetch("/mining-alpha/run/status").then(s => {
      if (!cancelled && s) setJobState(s);
    });
    return () => { cancelled = true; };
  }, []);

  // 仅在 (activeStep 或后端 running) 时才 poll；空闲时停掉，省去无谓 200+ /run/status 请求
  useEffect(() => {
    if (!jobState?.running && !activeStep) return;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      if (cancelled) return;
      const s = await apiFetch("/mining-alpha/run/status").catch(() => null);
      if (cancelled) return;
      if (s) setJobState(s);
      if (s && !s.running && s.exit_code != null) {
        setActiveStep(null);
        onJobDoneRef.current?.();
        return;
      }
      timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [jobState?.running, activeStep]);

  const triggerStep = async (step, extra) => {
    setActiveStep(step);
    const qs = new URLSearchParams();
    if (runId) qs.set("run_id", runId);
    if (extra) qs.set("extra_args", extra);
    try {
      await apiFetch(`/mining-alpha/run/${step}?${qs.toString()}`, { method: "POST" });
      // 立刻拉一次最新状态，让 jobState.running=true 触发 polling effect
      const s = await apiFetch("/mining-alpha/run/status").catch(() => null);
      if (s) setJobState(s);
    } catch (e) {
      setActiveStep(null);
      alert(`启动失败: ${e}`);
    }
  };

  const isRunning = jobState?.running;
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-white/80 flex items-center gap-1.5">
          <Terminal size={12} /> Run Pipeline (后端 subprocess)
        </div>
        {isRunning && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-300">
            <Loader size={10} className="animate-spin" /> {jobState.step} 运行中 ({jobState.elapsed_sec}s)
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STEPS.map(s => (
          <button
            key={s.id}
            onClick={() => triggerStep(s.id, s.extra)}
            disabled={isRunning}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
              activeStep === s.id ? "bg-amber-500/20 border-amber-500/40 text-amber-300" :
              isRunning ? "bg-white/[0.02] border-white/5 text-[#666] cursor-not-allowed" :
              "bg-white/[0.04] border-white/10 text-white/80 hover:bg-cyan-500/20 hover:border-cyan-500/40"
            }`}
            title={s.extra || ""}
          >
            <Play size={10} /> {s.label}
          </button>
        ))}
      </div>
      {jobState?.log_tail?.length > 0 && (
        <div className="bg-black/40 rounded border border-white/5 p-2 max-h-[180px] overflow-y-auto font-mono text-[10px] text-emerald-300/80 whitespace-pre-wrap leading-tight">
          {jobState.log_tail.slice(-40).join("\n")}
        </div>
      )}
      {jobState?.exit_code != null && (
        <div className={`text-[10px] ${jobState.exit_code === 0 ? "text-emerald-300" : "text-rose-300"}`}>
          {jobState.exit_code === 0 ? "✓" : "✗"} 上次运行 {jobState.step} 退出码 {jobState.exit_code}
        </div>
      )}
    </div>
  );
};

// ─── Backend 不可达兜底（Vercel 等纯前端部署）─────────────────
// 显示场景：apiFetch /status 已经回来但返回 null（fetch 抛错被吞掉了）。
// 区分于「后端在跑但缺产物」的场景 — 那种情况 status 非 null，文案该
// 提示具体 CLI 命令；这里是后端整体不可达，给个清晰指引就够，避免在
// 每个面板里都喷 `mining_alpha.run xxx`，对 demo 访客来说是噪音。
const BackendUnreachableNotice = ({ onRetry, loading }) => (
  <div className="bg-white/[0.02] border border-white/10 rounded-lg p-5 md:p-6 text-center">
    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-violet-500/10 border border-violet-500/30 mb-3">
      <Database size={18} className="text-violet-400" />
    </div>
    <h3 className="text-sm md:text-base font-bold text-white mb-1.5">Mining Alpha 需要 self-hosted backend</h3>
    <p className="text-[11px] md:text-xs text-[#a0aec0] max-w-[520px] mx-auto leading-relaxed mb-4">
      本页面读取 <code className="text-cyan-300">/api/mining-alpha/*</code> 数据（IC 报告、回测、Top 持仓、流水线 subprocess 控制）。
      当前部署看不到这些路由 — Vercel 这类静态托管只提供前端 SPA，没在跑 FastAPI 后端。
    </p>
    <div className="bg-black/30 border border-white/5 rounded-md p-3 text-left max-w-[520px] mx-auto mb-4 font-mono text-[10px] md:text-[11px] leading-relaxed">
      <div className="text-[#a0aec0] mb-1"># 启动后端 + 前端 dev，访问 localhost:5173</div>
      <div className="text-emerald-300">cd backend && python server.py</div>
      <div className="text-emerald-300">cd frontend && npm run dev</div>
    </div>
    <p className="text-[10px] text-[#a0aec0]/80 mb-4">
      其他不依赖后端的页面（量化评分 / 投资日志 / 宏观）在 Vercel 上仍然可用。
    </p>
    <button
      onClick={onRetry}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 disabled:opacity-50"
    >
      {loading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      重试连接
    </button>
  </div>
);

// ─── Alerts banner ───────────────────────────────────────────
const AlertsBanner = ({ alerts }) => {
  if (!alerts?.length) return null;
  const high = alerts.filter(a => a.severity === "critical" || a.severity === "high");
  if (!high.length) return null;
  return (
    <div className="bg-rose-500/10 border border-rose-500/40 rounded-lg p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-rose-300 mb-1">
        <AlertCircle size={12} /> {high.length} 条高严重度告警
      </div>
      <ul className="space-y-1 text-[11px] text-white/90">
        {high.slice(0, 5).map((a, i) => (
          <li key={i} className="flex gap-2"><span className="text-rose-300">●</span><span>{a.message}</span></li>
        ))}
      </ul>
    </div>
  );
};

// ─── 特征重要性条形图 ──────────────────────────────────────
const FeatureImportanceChart = ({ data }) => {
  if (!data || data.length === 0) return <div className="text-[#a0aec0] text-xs">特征重要性未生成。`mining_alpha.run train`</div>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 18)}>
      <BarChart layout="vertical" data={data} margin={{ left: 50, right: 20, top: 4, bottom: 4 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" />
        <XAxis type="number" tick={{ fill: "#a0aec0", fontSize: 10 }} />
        <YAxis dataKey="feature" type="category" tick={{ fill: "#a0aec0", fontSize: 10 }} width={70} />
        <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={(v) => v.toFixed(1)} />
        <Bar dataKey="importance" fill="#7c3aed" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Regime 区段合并（连续同 label 合并成 ReferenceArea）────
const mergeRegimeSegments = (regime) => {
  if (!regime || regime.length === 0) return [];
  const segs = [];
  let curr = { label: regime[0].label, start: regime[0].date, end: regime[0].date };
  for (let i = 1; i < regime.length; i++) {
    const r = regime[i];
    if (r.label !== curr.label) {
      segs.push(curr);
      curr = { label: r.label, start: r.date, end: r.date };
    } else {
      curr.end = r.date;
    }
  }
  segs.push(curr);
  return segs;
};

const REGIME_COLOR = {
  bull: "rgba(16,185,129,0.10)",
  neutral: "rgba(250,204,21,0.06)",
  bear: "rgba(244,63,94,0.10)",
};

// ─── 净值曲线（含 benchmark + regime overlay）─────────────────
const EquityCurveChart = ({ strategy, benchmark, regimeSegments }) => {
  // 合并 strategy + benchmark 数据，使用 date 字段对齐
  // 注意：hook 必须在任何 early return 之前调用，否则 hook 顺序在 strategy 由空变非空时会变化
  const benchMap = useMemo(() => {
    const m = new Map();
    (benchmark || []).forEach(p => m.set(p.date, p.bench_equity));
    return m;
  }, [benchmark]);
  if (!strategy || strategy.length === 0) return <div className="text-[#a0aec0] text-xs">回测净值未生成。`mining_alpha.run backtest`</div>;
  const data = strategy.map(p => ({ date: p.date, equity: p.equity, bench: benchMap.get(p.date) }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 6, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: "#a0aec0", fontSize: 9 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#a0aec0", fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={(v) => (v == null ? "—" : v.toFixed(4))} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {(regimeSegments || []).map((s, i) => (
          <ReferenceArea
            key={i}
            x1={s.start}
            x2={s.end}
            fill={REGIME_COLOR[s.label] || "rgba(255,255,255,0.03)"}
            stroke="none"
            ifOverflow="extendDomain"
          />
        ))}
        <Line type="monotone" dataKey="equity" stroke="#10b981" dot={false} strokeWidth={1.6} name="策略" />
        {benchmark?.length > 0 && (
          <Line type="monotone" dataKey="bench" stroke="#6366f1" dot={false} strokeWidth={1.2} strokeDasharray="3 3" name="基准" />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
};

// ─── 指标卡片（含阈值上色）────────────────────────────────────
const MetricsCard = ({ metrics }) => {
  if (!metrics) return null;
  const items = [
    { k: "年化收益", v: fmtPct(metrics.annual_return), good: metrics.annual_return > 0 },
    { k: "年化波动", v: fmtPct(metrics.annual_vol), good: null },
    { k: "Sharpe", v: fmtNum(metrics.sharpe, 2), good: metrics.sharpe > 1.2 },
    { k: "Calmar", v: fmtNum(metrics.calmar, 2), good: metrics.calmar > 1 },
    { k: "最大回撤", v: fmtPct(metrics.max_drawdown), good: metrics.max_drawdown > -0.25 },
    { k: "月度胜率", v: fmtPct(metrics.monthly_win_rate, 0), good: metrics.monthly_win_rate > 0.55 },
    { k: "vs基准超额", v: fmtPct(metrics.alpha_annual), good: metrics.alpha_annual > 0 },
    { k: "IR vs基准", v: fmtNum(metrics.ir_vs_benchmark, 2), good: metrics.ir_vs_benchmark > 0.8 },
    { k: "年化换手", v: fmtPct(metrics.turnover_annual, 0), good: null },
    { k: "总收益", v: fmtPct(metrics.total_return), good: metrics.total_return > 0 },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {items.map((it) => (
        <div key={it.k} className="bg-white/[0.02] border border-white/5 rounded-md px-3 py-2">
          <div className="text-[10px] text-[#a0aec0]">{it.k}</div>
          <div className={`text-sm font-semibold tabular-nums font-mono mt-0.5 ${
            it.good === null ? "text-white" : it.good ? "text-emerald-300" : "text-rose-300"
          }`}>{it.v}</div>
        </div>
      ))}
    </div>
  );
};

// ─── 多 Top-N 对比表 ───────────────────────────────────────
const MultiTopNTable = ({ rows }) => {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
      <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-1.5">
        <Target size={12} /> 多 Top-N 切片对比
      </div>
      <div className="overflow-auto">
        <table className="w-full text-[11px] font-mono tabular-nums">
          <thead className="text-[#a0aec0] border-b border-white/10">
            <tr>
              <th className="text-left px-2 py-1.5">Top-N</th>
              <th className="text-right px-2 py-1.5">年化</th>
              <th className="text-right px-2 py-1.5">Sharpe</th>
              <th className="text-right px-2 py-1.5">最大回撤</th>
              <th className="text-right px-2 py-1.5">Calmar</th>
              <th className="text-right px-2 py-1.5">vs基准超额</th>
              <th className="text-right px-2 py-1.5">IR</th>
              <th className="text-right px-2 py-1.5">月度胜率</th>
              <th className="text-right px-2 py-1.5">年化换手</th>
            </tr>
          </thead>
          <tbody className="text-white/90">
            {rows.map(r => (
              <tr key={r.top_n} className="border-b border-white/5">
                <td className="px-2 py-1 text-left text-cyan-300">Top{r.top_n}</td>
                <td className={`px-2 py-1 text-right ${r.annual_return > 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(r.annual_return)}</td>
                <td className="px-2 py-1 text-right">{fmtNum(r.sharpe, 2)}</td>
                <td className="px-2 py-1 text-right text-rose-300/80">{fmtPct(r.max_drawdown)}</td>
                <td className="px-2 py-1 text-right">{fmtNum(r.calmar, 2)}</td>
                <td className={`px-2 py-1 text-right ${r.alpha_annual > 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(r.alpha_annual)}</td>
                <td className="px-2 py-1 text-right">{fmtNum(r.ir_vs_benchmark, 2)}</td>
                <td className="px-2 py-1 text-right">{fmtPct(r.monthly_win_rate, 0)}</td>
                <td className="px-2 py-1 text-right text-white/50">{fmtPct(r.turnover_annual, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Top 持仓表（含 new/held/dropped 标记）─────────────────────
const TopHoldingsTable = ({ holdings, asOf, summary, errorDetail }) => {
  if (!holdings || holdings.length === 0) return (
    <div className="text-[#a0aec0] text-xs">
      {errorDetail || "最新预测不可用。`train`"}
    </div>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] text-[#a0aec0]">As of {asOf}</div>
        <div className="flex items-center gap-2 text-[10px] tabular-nums font-mono">
          <span className="text-emerald-300 flex items-center gap-0.5"><Plus size={10} />{summary?.n_new || 0}</span>
          <span className="text-white/50">↻ {summary?.n_held || 0}</span>
          <span className="text-rose-300 flex items-center gap-0.5"><Minus size={10} />{summary?.n_dropped || 0}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-h-[440px] overflow-y-auto">
        {holdings.map((h, i) => {
          const isNew = h.status === "new";
          const isDropped = h.status === "dropped";
          return (
            <div key={h.ticker} className={`flex items-center justify-between px-2.5 py-1.5 rounded-md border text-[11px] ${
              isNew ? "bg-emerald-500/10 border-emerald-500/30" :
              isDropped ? "bg-rose-500/10 border-rose-500/30" :
              "bg-white/[0.02] border-white/5"
            }`}>
              <span className="font-mono flex items-center gap-1">
                {isNew && <Plus size={9} className="text-emerald-300" />}
                {isDropped && <Minus size={9} className="text-rose-300" />}
                {!isNew && !isDropped && <span className="text-white/30 text-[9px]">#{i + 1}</span>}
                <span className={isDropped ? "text-rose-300 line-through" : "text-cyan-300"}>{h.ticker}</span>
              </span>
              <span className="font-mono text-[#a0aec0]">{h.score == null ? "—" : h.score.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Per-fold IC 表 ────────────────────────────────────────
const FoldICTable = ({ rows }) => {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
      <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-1.5">
        <Activity size={12} /> Walk-forward Per-fold 测试集 IC
      </div>
      <div className="overflow-auto">
        <table className="w-full text-[11px] font-mono tabular-nums">
          <thead className="text-[#a0aec0] border-b border-white/10">
            <tr>
              <th className="text-left px-2 py-1.5">Fold</th>
              <th className="text-left px-2 py-1.5">测试期</th>
              <th className="text-right px-2 py-1.5">IC mean</th>
              <th className="text-right px-2 py-1.5">IC IR</th>
              <th className="text-right px-2 py-1.5">Best iter</th>
            </tr>
          </thead>
          <tbody className="text-white/90">
            {rows.map(r => (
              <tr key={r.fold} className="border-b border-white/5">
                <td className="px-2 py-1 text-left text-cyan-300">#{r.fold}</td>
                <td className="px-2 py-1 text-left text-white/60">{r.test_start} → {r.test_end}</td>
                <td className={`px-2 py-1 text-right ${r.test_ic_mean >= 0.02 ? "text-emerald-300" : r.test_ic_mean < 0 ? "text-rose-300" : "text-white/60"}`}>{fmtPct(r.test_ic_mean, 2)}</td>
                <td className={`px-2 py-1 text-right ${Math.abs(r.test_ic_ir) >= 0.5 ? "text-amber-300" : "text-white/70"}`}>{fmtNum(r.test_ic_ir, 2)}</td>
                <td className="px-2 py-1 text-right text-white/50">{r.best_iter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────
export default function MiningAlpha() {
  const {
    status, ic, importance, backtest, topHoldings, regime, foldIC, heatmap, alerts,
    loading, error, isDemoMode, refetch: fetchAll, switchRun: onSwitchRun,
  } = useMiningAlphaData();
  const [pickedAlpha, setPickedAlpha] = useState(null);

  const regimeSegments = useMemo(() => mergeRegimeSegments(regime), [regime]);
  const allDone = status && status.files && Object.values(status.files).every(Boolean);
  const summary = topHoldings ? {
    n_new: topHoldings.n_new, n_held: topHoldings.n_held, n_dropped: topHoldings.n_dropped,
  } : {};
  // 后端整体不可达：首次 fetchAll 完成、status 仍为 null、也没有 error。
  // 这里短路出去渲染单一友好提示，而不是在 8 个面板里都喷 CLI 命令。
  const backendUnreachable = !loading && status === null && !error;

  return (
    <div className="p-3 md:p-4 space-y-3 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-violet-400" />
          <h2 className="text-base md:text-lg font-bold text-white">Mining Alpha</h2>
          <span className="text-[10px] text-[#a0aec0]">因子挖掘 · ML 合成 · 回测</span>
          {isDemoMode && (
            <span className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 border border-amber-500/40 text-amber-200">
              DEMO 模式
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status && !isDemoMode && <RunSwitcher status={status} onSwitch={onSwitchRun} />}
          {!backendUnreachable && (
            <button onClick={fetchAll} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-white/5 hover:bg-white/10 text-white border border-white/10 disabled:opacity-50">
              {loading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {isDemoMode ? "重试真实后端" : "刷新"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Demo 模式 banner：解释这是示例数据 + 启动真实后端的命令 */}
      {isDemoMode && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg px-3 py-2 flex items-start gap-2 text-[11px]">
          <Info size={14} className="text-amber-300 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="text-amber-200 font-semibold">这是示例数据。</span>
            <span className="text-white/80"> 当前部署没接 backend，展示的是固定 mock。要看真实因子/回测：</span>
            <code className="ml-1 text-emerald-300 font-mono">cd backend && python server.py</code>
            <span className="text-white/60"> 后访问 localhost:5173。</span>
          </div>
        </div>
      )}

      {/* 后端不可达 + demo 也加载失败（罕见）→ 显示兜底 notice */}
      {backendUnreachable && <BackendUnreachableNotice onRetry={fetchAll} loading={loading} />}

      {/* 告警 banner */}
      {!backendUnreachable && <AlertsBanner alerts={alerts} />}

      {/* 后端不可达时下面所有依赖 backend 的面板都不渲染 */}
      {!backendUnreachable && (<>

      {/* Run Pipeline 面板 */}
      <RunPipelinePanel runId={status?.current_run_id} onJobDone={fetchAll} />

      {/* 流水线状态 */}
      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold text-white/80 flex items-center gap-1.5">
            <Database size={12} /> 流水线状态
          </div>
          {status && (
            <div className="text-[10px] text-[#a0aec0] tabular-nums font-mono">
              {status.factor_count} 因子 · {status.model_count} 模型 {status.current_run_id && `· ${status.current_run_id}`}
            </div>
          )}
        </div>
        {status ? (
          <div className="flex flex-wrap gap-1.5">
            <StepChip label="1. 同步行情 + universe" done={status.factor_count > 0} />
            <StepChip label="2. 因子计算" done={status.factor_count > 0} />
            <StepChip label="3. IC 报告" done={status.files?.ic_report} />
            <StepChip label="3b. 相关性剔除" done={status.files?.factor_correlation} />
            <StepChip label="3c. Optuna 调参" done={status.files?.optuna_best} />
            <StepChip label="4. ML 训练" done={status.files?.predictions} />
            <StepChip label="4b. Regime-aware" done={status.files?.regime} />
            <StepChip label="5. 回测" done={status.files?.backtest_report} />
            <StepChip label="5b. 多 Top-N" done={status.files?.multi_topn} />
          </div>
        ) : (
          <div className="text-[#a0aec0] text-xs">{loading ? "加载中..." : "无法连接 API；后端是否启动？"}</div>
        )}
        {!allDone && status && (
          <div className="mt-2 space-y-1.5">
            {status.factor_count === 0 ? (
              <div className="border border-cyan-500/30 bg-cyan-500/5 rounded-md p-2.5">
                <div className="text-[11px] font-semibold text-cyan-300 mb-1">🚀 还没数据？30 秒首体验</div>
                <div className="text-[10px] text-white/80 font-mono leading-relaxed">
                  不需 tushare、一键生成合成 50 票 × 3 年 panel：<br />
                  <code className="text-emerald-300">.venv/Scripts/python -m mining_alpha.synthetic_demo</code><br />
                  然后用 <code className="text-amber-300">--universe DEMO --run-id demo</code> 跑完整 pipeline (Run Pipeline 面板的"DEMO"按钮)
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-amber-300/80 font-mono leading-relaxed">
                ▶ 上方 Run Pipeline 面板可一键触发后续步骤（或在终端跑）：<br />
                <code className="text-white/70">.venv/Scripts/python -m mining_alpha.run {!status.files?.ic_report ? "ic-report" : !status.files?.predictions ? "train" : "backtest"} --run-id $RUN_ID</code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 回测指标 */}
      {backtest?.metrics && (
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[11px] font-semibold text-white/80 flex items-center gap-1.5">
            <TrendingUp size={12} /> 回测指标
            <span className="text-[10px] text-[#a0aec0] font-normal">
              ({backtest.metrics.start_date} → {backtest.metrics.end_date},
              Top-{backtest.metrics.top_n}, cost {(backtest.metrics.cost * 100).toFixed(2)}%
              {backtest.metrics.has_tradeable_mask && " · 涨跌停剔除已启用"})
            </span>
          </div>
          <MetricsCard metrics={backtest.metrics} />
        </div>
      )}

      {/* 多 Top-N 对比 */}
      <MultiTopNTable rows={backtest?.multi_topn} />

      {/* 主面板：净值 | Top持仓 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Activity size={12} /> 策略净值 vs 基准</span>
            {regimeSegments.length > 0 && (
              <span className="flex items-center gap-2 text-[10px] text-[#a0aec0]">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: REGIME_COLOR.bull }} />牛</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: REGIME_COLOR.neutral }} />震荡</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: REGIME_COLOR.bear }} />熊</span>
              </span>
            )}
          </div>
          <EquityCurveChart strategy={backtest?.equity_curve} benchmark={backtest?.benchmark_curve} regimeSegments={regimeSegments} />
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-1.5">
            <Target size={12} /> 当前 Top 20 持仓
            <ArrowRight size={10} className="text-[#a0aec0]" />
            <span className="text-[10px] text-[#a0aec0] font-normal">vs 上周持仓</span>
          </div>
          <TopHoldingsTable holdings={topHoldings?.holdings} asOf={topHoldings?.as_of} summary={summary} errorDetail={topHoldings?.detail} />
        </div>
      </div>

      {/* Per-fold IC */}
      <FoldICTable rows={foldIC} />

      {/* IC 表 + 特征重要性 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-1.5">
            单因子 IC 排行（Top 20 by |ICIR|，点击查看详情）
          </div>
          <ICTable rows={ic} onPickAlpha={setPickedAlpha} />
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-white/80 mb-2">ML 特征重要性（多 fold 平均 gain）</div>
          <FeatureImportanceChart data={importance} />
        </div>
      </div>

      {/* IC 月度热力图 */}
      {heatmap?.cells?.length > 0 && (
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-white/80 mb-2 flex items-center gap-1.5">
            <Grid3x3 size={12} /> IC 月度热力图（Top 20 因子 × 近 24 月，绿=正、红=负、深度 ∝ |IC|，数值 ×100）
          </div>
          <ICHeatmap data={heatmap} onPickAlpha={setPickedAlpha} />
        </div>
      )}

      </>)}

      {/* 因子详情 modal — 由 pickedAlpha 控制，不依赖 backend 全局可用 */}
      <FactorDetailModal alphaNum={pickedAlpha} runId={status?.current_run_id} onClose={() => setPickedAlpha(null)} />
    </div>
  );
}

// 用于单测：把 3 个子组件 + 1 个工具函数 named export 出来。生产代码不消费
// 这些 import，只有 MiningAlpha.test.jsx 用。
export { AlertsBanner, TopHoldingsTable, RunPipelinePanel, mergeRegimeSegments, BackendUnreachableNotice };
