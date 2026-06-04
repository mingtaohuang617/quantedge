/**
 * 复利的力量 — Compound Power
 * ==========================
 * 三段式：
 *   §1 复利计算器（年化 × 年限 × 本金 → 终值 + 增长曲线 + 蒙特卡洛 + SPY 基准 + 通胀线）
 *   §2 风险等级对照表（5 档 + 1 投机演示）
 *   §3 策略组合推荐（每档 3 个：保守 / 平衡 / 进取）
 *
 * 纯前端，零后端依赖。
 */
import React, { useMemo, useState } from "react";
import {
  TrendingUp, Sparkles, AlertTriangle, Info, Shield, Flame, Maximize2,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import {
  compoundFinalValue, compoundSeries, inflationAdjusted,
  monteCarloAnnual, formatBigNumber,
} from "../math/compound.ts";
import useIsMobile from "../hooks/useIsMobile";
import { FullscreenChart, ThumbActionBar } from "../components/mobile";

// ─── 常量 ────────────────────────────────────────────────

const SPY_LONG_RUN = 0.10;       // S&P 500 长期年化（含分红，名义）
const INFLATION_RATE = 0.03;     // 美元长期通胀率

const RETURN_OPTIONS = [
  { rate: 0.03, label: "3%",   riskTier: "low",      warning: null },
  { rate: 0.05, label: "5%",   riskTier: "lowMid",   warning: null },
  { rate: 0.10, label: "10%",  riskTier: "mid",      warning: null },
  { rate: 0.15, label: "15%",  riskTier: "midHigh",  warning: null },
  { rate: 0.20, label: "20%",  riskTier: "high",     warning: null },
  { rate: 0.30, label: "30%",  riskTier: "high",     warning: "持续达到极难，仅少数顶级策略" },
  { rate: 0.50, label: "50%",  riskTier: "extreme",  warning: "教育演示用途，无可推荐实盘策略" },
  { rate: 1.00, label: "100%", riskTier: "extreme",  warning: "教育演示用途，无可推荐实盘策略" },
];

const YEAR_OPTIONS = [1, 3, 5, 10, 15, 20, 30, 40, 50];

const RISK_TIERS = {
  low:     { label: "低风险",   targetReturn: [0.03, 0.05], volatility: 0.05, maxDD: 0.05, accent: "emerald", icon: Shield },
  lowMid:  { label: "中低风险", targetReturn: [0.05, 0.08], volatility: 0.10, maxDD: 0.10, accent: "teal",    icon: Shield },
  mid:     { label: "中风险",   targetReturn: [0.08, 0.12], volatility: 0.15, maxDD: 0.20, accent: "sky",     icon: TrendingUp },
  midHigh: { label: "中高风险", targetReturn: [0.12, 0.20], volatility: 0.22, maxDD: 0.35, accent: "amber",   icon: TrendingUp },
  high:    { label: "高风险",   targetReturn: [0.20, 0.35], volatility: 0.35, maxDD: 0.60, accent: "orange",  icon: Flame },
  extreme: { label: "极高/投机", targetReturn: [0.50, 1.00], volatility: 0.70, maxDD: 0.80, accent: "rose",    icon: AlertTriangle },
};

const TIER_ORDER = ["low", "lowMid", "mid", "midHigh", "high", "extreme"];

const STRATEGY_LIBRARY = {
  low: [
    { name: "保守", weights: { SHY: 1.00 }, rationale: "100% 短期国债 ETF，规避利率风险，类货币基金体验" },
    { name: "平衡", weights: { AGG: 0.60, TLT: 0.40 }, rationale: "投资级综合债 + 长期国债，吃久期" },
    { name: "进取", weights: { AGG: 0.50, TLT: 0.30, SPY: 0.20 }, rationale: "债券为主 + 20% 股票，长期收益小幅提升" },
  ],
  lowMid: [
    { name: "保守", weights: { AGG: 0.60, SPY: 0.40 }, rationale: "60/40 反向版，债券主导" },
    { name: "平衡", weights: { AGG: 0.50, SPY: 0.50 }, rationale: "经典 50/50，股债等权" },
    { name: "进取", weights: { AGG: 0.40, SPY: 0.50, QQQ: 0.10 }, rationale: "50/50 + 加 10% 科技" },
  ],
  mid: [
    { name: "保守", weights: { SPY: 0.60, BND: 0.40 }, rationale: "经典 60/40，长期年化 ~8%，机构标配" },
    { name: "平衡", weights: { SPY: 0.50, QQQ: 0.30, BND: 0.20 }, rationale: "大盘 + 科技 + 债券缓冲" },
    { name: "进取", weights: { SPY: 0.50, QQQ: 0.30, SOXX: 0.20 }, rationale: "全股票，叠加半导体主题" },
  ],
  midHigh: [
    { name: "保守", weights: { SPY: 0.70, QQQ: 0.30 }, rationale: "100% 大盘 + 科技偏重" },
    { name: "平衡", weights: { SPY: 0.50, QQQ: 0.30, SOXX: 0.20 }, rationale: "大盘 + 科技 + 半导体" },
    { name: "进取", weights: { QQQ: 0.40, SOXX: 0.30, SMH: 0.20, MTUM: 0.10 }, rationale: "科技 + 半导体 + 动量因子" },
  ],
  high: [
    { name: "保守", weights: { QQQ: 0.50, SOXX: 0.30, ARKK: 0.20 }, rationale: "科技 + 半导体 + 创新主题" },
    { name: "平衡", weights: { TQQQ: 0.60, SOXX: 0.40 }, rationale: "⚠ 3x 杠杆 QQQ + 半导体，剧烈波动", warning: true },
    { name: "进取", weights: { TQQQ: 1.00 }, rationale: "⚠ 100% 3x 杠杆 QQQ，回撤可能 -80% 以上", warning: true },
  ],
  extreme: [
    {
      name: "—", weights: {},
      rationale: "历史上能持续 50%+ 年化的几乎只有：早期加密资产、单只爆发期个股、复杂期权策略 —— 没有可被定义为「组合」的实盘策略。本档位仅作复利演示。",
      warning: true,
    },
  ],
};

// Tailwind class 映射 — 不能用动态字符串拼接（被 purge 掉），写死
const ACCENT_CLASS = {
  emerald: { bg: "bg-emerald-500/10",  border: "border-emerald-500/30", text: "text-emerald-300", hex: "#10b981" },
  teal:    { bg: "bg-teal-500/10",     border: "border-teal-500/30",    text: "text-teal-300",    hex: "#14b8a6" },
  sky:     { bg: "bg-sky-500/10",      border: "border-sky-500/30",     text: "text-sky-300",     hex: "#0ea5e9" },
  amber:   { bg: "bg-amber-500/10",    border: "border-amber-500/30",   text: "text-amber-300",   hex: "#f59e0b" },
  orange:  { bg: "bg-orange-500/10",   border: "border-orange-500/30",  text: "text-orange-300",  hex: "#f97316" },
  rose:    { bg: "bg-rose-500/10",     border: "border-rose-500/30",    text: "text-rose-300",    hex: "#ef4444" },
  indigo:  { bg: "bg-indigo-500/10",   border: "border-indigo-500/30",  text: "text-indigo-300",  hex: "#6366f1" },
};

// ─── 工具 ────────────────────────────────────────────────

const fmtPct = (v, d = 1) => v == null || isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`;
const fmtMoney = (v) => "$" + formatBigNumber(v, 2);
const fmtMult = (v) => `×${formatBigNumber(v, 2)}`;

// v5：定投复利序列（每年末复利 + 当年定投）。monthly=0 时退化为一次性本金复利，
// 与 compoundSeries 等价。返回 { principalCum:[], total:[] }（含第 0 年）
function dcaSeries(init, monthlyAmt, rate, yrs) {
  const principalCum = [];
  const total = [];
  let bal = init;
  for (let t = 0; t <= yrs; t++) {
    principalCum.push(init + monthlyAmt * 12 * t);
    total.push(t === 0 ? init : (bal = bal * (1 + rate) + monthlyAmt * 12));
  }
  return { principalCum, total };
}
const dcaFinalValue = (init, monthlyAmt, rate, yrs) => dcaSeries(init, monthlyAmt, rate, yrs).total[yrs];

// ─── 子组件 ──────────────────────────────────────────────

/** 按钮组（rate / years），选中态高亮。语义上是单选 radiogroup */
function ButtonGroup({ options, value, onChange, getLabel, getKey, warningOf, ariaLabel }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const k = getKey(opt);
        const isActive = value === k;
        const warn = warningOf && warningOf(opt);
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            role="radio"
            aria-checked={isActive}
            className={`px-2.5 py-1 rounded text-[11px] font-mono border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isActive
                ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/50"
                : "bg-white/[0.02] text-white/70 border-white/10 hover:border-white/30"
            } ${warn ? "border-amber-500/40" : ""}`}
            title={warn || ""}
          >
            {getLabel(opt)}
            {warn && <span className="ml-1 text-amber-400" aria-label="风险警示">⚠</span>}
          </button>
        );
      })}
    </div>
  );
}

/** v5 假设滑块：标签 + 大值 + 带刻度轨道 + lo/hi。min/max/step 连续，或 marks 离散吸附 */
function AssumptionSlider({ label, displayValue, value, min, max, step = 1, onChange, loLabel, hiLabel }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] text-[#a0aec0]">{label}</span>
        <span className="font-mono text-[15px] font-semibold text-white">{displayValue}</span>
      </div>
      <div className="relative h-4 flex items-center">
        {/* 轨道底 */}
        <div className="absolute inset-x-0 h-[5px] rounded-full bg-white/[0.06]" />
        {/* 已填充 */}
        <div className="absolute h-[5px] rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #1ED395, #5EE6E6)", boxShadow: "0 0 8px rgba(30,211,149,.35)" }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={label}
          className="cp-slider absolute inset-x-0 w-full appearance-none bg-transparent cursor-pointer m-0"
        />
      </div>
      <div className="flex justify-between mt-1 text-[8.5px] font-mono text-[#5a6477]">
        <span>{loLabel}</span><span>{hiLabel}</span>
      </div>
    </div>
  );
}

/** 大数字 + 副信息 卡片 */
function StatCard({ label, value, hint, accent = "indigo", warning }) {
  const c = ACCENT_CLASS[accent];
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="text-[10px] text-[#a0aec0] uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold font-mono mt-1 ${c.text}`}>{value}</div>
      {hint && <div className="text-[10px] text-[#a0aec0] mt-0.5">{hint}</div>}
      {warning && (
        <div className="flex items-start gap-1 mt-1.5 text-[10px] text-amber-400">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}

/** 风险等级卡 */
function RiskTierCard({ tierId, active, onClick }) {
  const t = RISK_TIERS[tierId];
  const c = ACCENT_CLASS[t.accent];
  const Icon = t.icon;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${t.label}：目标年化 ${fmtPct(t.targetReturn[0], 0)}–${fmtPct(t.targetReturn[1], 0)}，历史波动 ${fmtPct(t.volatility, 0)}`}
      className={`text-left rounded-lg border p-2.5 transition w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        active
          ? `${c.bg} ${c.border} ring-1 ring-current ${c.text}`
          : "bg-white/[0.02] border-white/10 hover:border-white/30"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={c.text} />
        <span className={`text-[11px] font-semibold ${c.text}`}>{t.label}</span>
      </div>
      <div className="text-[10px] text-[#a0aec0] space-y-0.5 font-mono">
        <div>目标年化 <span className="text-white/80">{fmtPct(t.targetReturn[0], 0)}–{fmtPct(t.targetReturn[1], 0)}</span></div>
        <div>历史波动 <span className="text-white/80">{fmtPct(t.volatility, 0)}</span></div>
        <div>最大回撤 <span className="text-white/80">~{fmtPct(t.maxDD, 0)}</span></div>
      </div>
    </button>
  );
}

/** 策略组合卡 */
function StrategyCard({ strategy, onOneClickBacktest }) {
  const isWarn = strategy.warning;
  const tickers = Object.entries(strategy.weights || {});
  const canBacktest = tickers.length > 0 && typeof onOneClickBacktest === "function";
  return (
    <div className={`rounded-lg border p-3 ${
      isWarn ? "bg-amber-500/[0.04] border-amber-500/30" : "bg-white/[0.02] border-white/10"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-semibold ${isWarn ? "text-amber-300" : "text-white/90"}`}>
          {strategy.name}
        </span>
        {isWarn && <AlertTriangle size={11} className="text-amber-400" />}
      </div>
      {tickers.length > 0 ? (
        <div className="flex flex-wrap gap-1 mb-2">
          {tickers.map(([t, w]) => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-200 border border-indigo-500/30 text-[10px] font-mono">
              {t} <span className="text-indigo-400">{fmtPct(w, 0)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-[#a0aec0] mb-2">无可推荐组合</div>
      )}
      <p className="text-[10px] text-[#a0aec0] leading-relaxed">{strategy.rationale}</p>
      <button
        disabled={!canBacktest}
        onClick={canBacktest ? () => onOneClickBacktest(strategy.weights) : undefined}
        className={`mt-2 w-full text-[10px] px-2 py-1 rounded border transition ${
          canBacktest
            ? "border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 hover:border-indigo-500/70 cursor-pointer"
            : "border-white/10 text-[#6b7280] cursor-not-allowed"
        }`}
        title={canBacktest ? "跳转到组合回测并填入此组合" : "此档位无可回测组合"}
      >
        {canBacktest ? "一键回测 →" : "无可回测组合"}
      </button>
    </div>
  );
}

/** 复利曲线图：确定值 + 蒙特卡洛区间 + SPY + 通胀 */
function GrowthChart({ data, showSpy = true, useLogScale = false }) {
  // 对数轴 + 0 起点会断（log 0 = -Infinity），所以最小值用第一年（principal > 0）
  const minDataValue = data.length > 0 ? data[0].nominal : 1;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ left: 10, right: 20, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="year" stroke="#6b7280" fontSize={10}
          label={{ value: "年", position: "insideBottom", offset: -2, fill: "#6b7280", fontSize: 10 }}
        />
        <YAxis
          stroke="#6b7280" fontSize={10}
          tickFormatter={(v) => formatBigNumber(v, 1)}
          width={64}
          scale={useLogScale ? "log" : "auto"}
          domain={useLogScale ? [minDataValue * 0.5, "auto"] : ["auto", "auto"]}
          allowDataOverflow={useLogScale}
        />
        <Tooltip
          contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#a0aec0", fontSize: 10 }}
          formatter={(v, name) => [fmtMoney(v), name]}
          labelFormatter={(y) => `第 ${y} 年`}
        />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
        {/* 蒙特卡洛 5%-95% 区间（range area） */}
        <Area
          type="monotone" dataKey="mcBand"
          stroke="none" fill="#6366f1" fillOpacity={0.12}
          name="蒙特卡洛 5%-95% 区间" legendType="rect"
          isAnimationActive={false}
        />
        {/* 蒙特卡洛中位数 */}
        <Line
          type="monotone" dataKey="mcMedian"
          stroke="#6366f1" strokeWidth={1.5} strokeDasharray="3 3"
          dot={false} name="蒙特卡洛中位数"
          isAnimationActive={false}
        />
        {/* 名义确定值 */}
        <Line
          type="monotone" dataKey="nominal"
          stroke="#10b981" strokeWidth={2}
          dot={false} name="名义复利"
          isAnimationActive={false}
        />
        {/* SPY 基准 — rate=10% 时与名义完全重合，隐藏避免视觉混淆 */}
        {showSpy && (
          <Line
            type="monotone" dataKey="spy"
            stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} name="SPY 基准 (10%)"
            isAnimationActive={false}
          />
        )}
        {/* 通胀调整后 */}
        <Line
          type="monotone" dataKey="real"
          stroke="#a0aec0" strokeWidth={1.5} strokeDasharray="2 2"
          dot={false} name="实际购买力 (扣 3% 通胀)"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ═════════════════════════════════════════════════════════
//  主组件
// ═════════════════════════════════════════════════════════
export default function CompoundPower({ onOneClickBacktest = null }) {
  const isMobile = useIsMobile();
  const [selectedRate, setSelectedRate] = useState(0.10);
  const [years, setYears] = useState(20);
  const [principalStr, setPrincipalStr] = useState("100000");
  const [monthlyStr, setMonthlyStr] = useState("2000");   // v5：每月定投
  const [tierOverride, setTierOverride] = useState(null);
  const [fsChart, setFsChart] = useState(false);

  const principal = useMemo(() => {
    const n = parseFloat(principalStr);
    return isFinite(n) && n > 0 ? n : 1;
  }, [principalStr]);

  const monthly = useMemo(() => {
    const n = parseFloat(monthlyStr);
    return isFinite(n) && n > 0 ? n : 0;
  }, [monthlyStr]);

  const rateOpt = useMemo(
    () => RETURN_OPTIONS.find((o) => o.rate === selectedRate) || RETURN_OPTIONS[2],
    [selectedRate],
  );
  const autoTier = rateOpt.riskTier;
  const currentTier = tierOverride || autoTier;
  const tierMeta = RISK_TIERS[currentTier];

  // 计算确定值序列 + SPY + 通胀
  const detSeries = useMemo(
    () => compoundSeries(principal, selectedRate, years),
    [principal, selectedRate, years],
  );
  const spySeries = useMemo(
    () => compoundSeries(principal, SPY_LONG_RUN, years),
    [principal, years],
  );

  // 蒙特卡洛 —— σ 来自 rate 对应的 tier（不是 user 浏览的 tier）
  const mc = useMemo(
    () => monteCarloAnnual(principal, selectedRate, RISK_TIERS[autoTier].volatility, years, 1000),
    [principal, selectedRate, autoTier, years],
  );

  // 拼装图表数据
  const chartData = useMemo(() => {
    return detSeries.map((det, t) => {
      const band = mc.bands[t];
      const realValue = inflationAdjusted(det, t, INFLATION_RATE);
      return {
        year: t,
        nominal: det,
        spy: spySeries[t],
        real: realValue,
        mcMedian: band.p50,
        // range area: [low, high] 让 Recharts 画 5%-95% 区间
        mcBand: [band.p05, band.p95],
      };
    });
  }, [detSeries, spySeries, mc.bands]);

  // 终值统计
  const finalNominal = detSeries[detSeries.length - 1];
  const finalReal = inflationAdjusted(finalNominal, years, INFLATION_RATE);
  const finalSpy = spySeries[spySeries.length - 1];
  const multiplier = finalNominal / principal;

  // SPY 跟用户选的 rate 完全一致时（10%），曲线/SPY 卡片就是重复信息
  const isSPYRate = Math.abs(selectedRate - SPY_LONG_RUN) < 1e-9;

  // 中位数 vs 名义值 偏离度 — 高 σ × 长年限时 lognormal 偏度让中位数远低于名义
  // 用倍数（ratio = nominal / median）而非百分比，因极端时 ratio 可达 10000+，
  // 百分比会饱和到 99%/100% 失去信息
  const divergenceRatio = useMemo(() => {
    if (mc.summary.p50 <= 0) return Infinity;
    return finalNominal / mc.summary.p50;
  }, [finalNominal, mc.summary.p50]);
  const showDivergenceBanner = divergenceRatio > 1.5; // 名义比中位数高 50%+

  // 终值跨度太大（>10000 倍）时启用对数 Y 轴，否则低年早期被压扁看不见
  const valueRange = finalNominal / principal;
  const useLogScale = valueRange > 10_000;

  // ── v5 增长叙事：定投复利（本金 vs 复利增值 + 交叉点 + 情景 + 早开始）──
  const story = useMemo(() => {
    const { principalCum, total } = dcaSeries(principal, monthly, selectedRate, years);
    const finalTotal = total[years];
    const finalPrincipal = principalCum[years];
    const finalGrowth = Math.max(0, finalTotal - finalPrincipal);
    const mult = finalPrincipal > 0 ? finalTotal / finalPrincipal : 0;
    const growthPct = finalTotal > 0 ? finalGrowth / finalTotal : 0;
    // 复利增值首次超过累计本金的年份
    let crossoverYear = null;
    for (let t = 1; t <= years; t++) {
      if (total[t] - principalCum[t] > principalCum[t]) { crossoverYear = t; break; }
    }
    // 72 法则：翻倍年数
    const doublingYears = selectedRate > 0 ? 72 / (selectedRate * 100) : null;
    // 图表数据
    const chart = total.map((v, t) => ({ year: t, total: Math.round(v), principal: Math.round(principalCum[t]) }));
    // 情景对比：6/10/14% 同本金/定投/年限
    const scenarios = [0.06, 0.10, 0.14].map((r) => ({ r, fv: dcaFinalValue(principal, monthly, r, years) }));
    const scenMax = Math.max(...scenarios.map((s) => s.fv), 1);
    // 早开始 5 年：同样月定投，多投 5 年
    const fvEarly = dcaFinalValue(principal, monthly, selectedRate, years + 5);
    const earlyDelta = fvEarly - finalTotal;
    return { finalTotal, finalPrincipal, finalGrowth, mult, growthPct, crossoverYear, doublingYears, chart, scenarios, scenMax, fvEarly, earlyDelta };
  }, [principal, monthly, selectedRate, years]);

  // 当前展示的策略
  const strategies = STRATEGY_LIBRARY[currentTier] || [];

  // ─────────────────────────────────────────────────────────────
  // v6 移动端：60px serif 终值头条 + 本金/复利占比条 + 大滑块 + 里程碑时间线 + 横屏曲线
  // 复用全部桌面端 state / 计算值（story.*、selectedRate、years、principal、monthly 等）
  // ─────────────────────────────────────────────────────────────
  if (isMobile) {
    // 里程碑：从 story.chart 推导出首次到达各阈值的年份
    const MILESTONES = [
      { label: "第一个 $100K", target: 100_000 },
      { label: "突破 $500K",  target: 500_000 },
      { label: "达成 $1M",    target: 1_000_000 },
    ];
    const milestones = MILESTONES.map(({ label, target }) => {
      const yr = story.chart.findIndex((d) => d.total >= target);
      return { label, target, year: yr > 0 ? yr : null };
    }).filter((m) => m.year !== null && m.target <= story.finalTotal);
    // 加上终值里程碑
    milestones.push({ label: `${years} 年终值`, target: story.finalTotal, year: years, isFinal: true });

    // 72 法则翻倍年数
    const doublingYrs = story.doublingYears ? story.doublingYears.toFixed(1) : "—";

    // 滑块行：label / displayValue / value / min / max / step / onChange / loLabel / hiLabel
    const sliderRows = [
      {
        label: "初始本金", displayValue: fmtMoney(principal),
        value: Math.min(500_000, principal), min: 0, max: 500_000, step: 5_000,
        onChange: (v) => setPrincipalStr(String(v)),
        lo: "$0", hi: "$500K",
      },
      {
        label: "每月定投", displayValue: fmtMoney(monthly),
        value: Math.min(10_000, monthly), min: 0, max: 10_000, step: 250,
        onChange: (v) => setMonthlyStr(String(v)),
        lo: "$0", hi: "$10K",
      },
      {
        label: "年化收益", displayValue: fmtPct(selectedRate, 0),
        value: Math.max(0, RETURN_OPTIONS.findIndex((o) => o.rate === selectedRate)),
        min: 0, max: RETURN_OPTIONS.length - 1, step: 1,
        onChange: (i) => { setSelectedRate(RETURN_OPTIONS[i].rate); setTierOverride(null); },
        lo: RETURN_OPTIONS[0].label, hi: RETURN_OPTIONS[RETURN_OPTIONS.length - 1].label,
      },
      {
        label: "投资年限", displayValue: `${years} 年`,
        value: Math.max(0, YEAR_OPTIONS.indexOf(years)),
        min: 0, max: YEAR_OPTIONS.length - 1, step: 1,
        onChange: (i) => setYears(YEAR_OPTIONS[i]),
        lo: `${YEAR_OPTIONS[0]}年`, hi: `${YEAR_OPTIONS[YEAR_OPTIONS.length - 1]}年`,
      },
    ];

    const principalPct = Math.round((1 - story.growthPct) * 100);
    const growthPct    = Math.round(story.growthPct * 100);

    // 全屏图表：复用 story.chart（total / principal 两线）
    const fsIndicators = (
      <>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--fg-2)" }}>
          <span style={{ width: 14, height: 2, background: "#1ED395", display: "inline-block" }} />账户总值
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--fg-3)" }}>
          <span style={{ width: 14, height: 2, background: "#5A5E76", borderStyle: "dashed", display: "inline-block" }} />累计本金
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, padding: "4px 10px", borderRadius: 7, background: "rgba(30,211,149,.12)", border: "1px solid rgba(30,211,149,.3)", color: "var(--up)", fontWeight: 600 }}>
          后 {Math.round(years / 3)} 年贡献多数增长
        </span>
      </>
    );

    return (
      <div className="h-full flex flex-col" style={{ background: "var(--bg-0)" }}>
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: "calc(74px + env(safe-area-inset-bottom))" }}
        >
          {/* ── Hero: 终值大字 ── */}
          <div
            style={{
              padding: "20px 16px 18px",
              textAlign: "center",
              background: "radial-gradient(ellipse 400px 280px at 50% 0%, rgba(30,211,149,.13), var(--bg-0) 65%)",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 10 }}>
              {years} 年后，你将拥有
            </div>
            <div
              className="font-serif"
              style={{
                fontSize: 60,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 0.92,
                background: "linear-gradient(180deg, #6EE7B7 0%, #1ED395 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              {fmtMoney(story.finalTotal)}
            </div>
            {/* chips */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
              <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, background: "rgba(90,94,118,.25)", border: "1px solid rgba(90,94,118,.4)", color: "var(--fg-1)" }}>
                本金 {fmtMoney(story.finalPrincipal)}
              </span>
              <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, background: "rgba(30,211,149,.12)", border: "1px solid rgba(30,211,149,.3)", color: "var(--up)", fontWeight: 600 }}>
                复利贡献 {fmtMoney(story.finalGrowth)}
              </span>
            </div>
            {/* 本金/复利占比条 */}
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "16px 8px 0", gap: 2 }}>
              <div style={{ width: `${principalPct}%`, background: "#5A5E76", borderRadius: "4px 0 0 4px", transition: "width .35s" }} />
              <div style={{
                flex: 1,
                background: "linear-gradient(90deg, var(--up), var(--cyan))",
                boxShadow: "0 0 10px rgba(30,211,149,.45)",
                borderRadius: "0 4px 4px 0",
                transition: "flex .35s",
              }} />
            </div>
            <div
              className="font-mono"
              style={{ display: "flex", justifyContent: "space-between", margin: "6px 8px 0", fontSize: 9, color: "var(--fg-3)" }}
            >
              <span>本金 {principalPct}%</span>
              <span style={{ color: "var(--up)" }}>复利 {growthPct}%</span>
            </div>
            {/* 72 法则小提示 */}
            <div style={{ marginTop: 14, fontSize: 11, color: "var(--fg-3)" }}>
              年化 <span className="font-mono" style={{ color: "var(--up)" }}>{fmtPct(selectedRate, 0)}</span> → 约{" "}
              <span className="font-mono" style={{ color: "var(--cyan)", fontWeight: 600 }}>{doublingYrs} 年</span>翻倍
              {story.crossoverYear && (
                <span>，第 <span className="font-mono" style={{ color: "var(--warn, #F5B53C)" }}>{story.crossoverYear}</span> 年复利超本金</span>
              )}
            </div>
          </div>

          {/* ── 滑块：调整你的计划 ── */}
          <div style={{ padding: "4px 16px 2px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 16 }}>
              调整你的计划
            </div>
            {sliderRows.map(({ label, displayValue, value, min, max, step, onChange, lo, hi }) => {
              const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
              return (
                <div key={label} style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--fg-1)" }}>{label}</span>
                    <span className="font-mono" style={{ fontSize: 17, fontWeight: 700, color: "var(--fg-0)" }}>{displayValue}</span>
                  </div>
                  {/* 44px hit-area slider */}
                  <div style={{ position: "relative", height: 44, display: "flex", alignItems: "center" }}>
                    {/* track bg */}
                    <div style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 3, background: "rgba(255,255,255,.06)" }} />
                    {/* fill */}
                    <div style={{
                      position: "absolute", left: 0, height: 6, borderRadius: 3,
                      width: `${pct}%`,
                      background: "linear-gradient(90deg, var(--up), var(--cyan))",
                      boxShadow: "0 0 8px rgba(30,211,149,.35)",
                      transition: "width .1s",
                    }} />
                    <input
                      type="range"
                      min={min} max={max} step={step} value={value}
                      onChange={(e) => onChange(parseFloat(e.target.value))}
                      aria-label={label}
                      style={{
                        position: "absolute", left: 0, right: 0, width: "100%",
                        height: 44, margin: 0, appearance: "none", WebkitAppearance: "none",
                        background: "transparent", cursor: "pointer",
                      }}
                      className="cp-slider"
                    />
                  </div>
                  <div className="font-mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 9, color: "var(--fg-4, #5a6477)" }}>
                    <span>{lo}</span><span>{hi}</span>
                  </div>
                </div>
              );
            })}
            {rateOpt.warning && (
              <div style={{ borderRadius: 8, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", padding: "8px 12px", fontSize: 11, color: "#FCD34D", display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{rateOpt.warning}</span>
              </div>
            )}
          </div>

          {/* ── 增长曲线卡片 + 全屏入口 ── */}
          <div style={{ padding: "8px 16px 14px" }}>
            <div style={{ borderRadius: 14, border: "1px solid var(--line)", background: "rgba(255,255,255,.022)", padding: "14px 14px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-0)" }}>增长曲线</span>
                <button
                  onClick={() => setFsChart(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 9px", background: "rgba(30,211,149,.12)",
                    border: "1px solid rgba(30,211,149,.3)", borderRadius: 7,
                    fontSize: 10.5, color: "var(--up)", fontWeight: 600,
                  }}
                >
                  <Maximize2 size={11} />全屏
                </button>
              </div>
              {/* 迷你预览曲线 */}
              <ResponsiveContainer width="100%" height={80}>
                <ComposedChart data={story.chart} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mobCpTot" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1ED395" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#1ED395" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="total" stroke="#1ED395" strokeWidth={2} fill="url(#mobCpTot)" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="principal" stroke="#5A5E76" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 9, textAlign: "center", marginTop: 4, color: "var(--fg-3)" }}>
                注意后段的陡峭加速 — 这就是复利
              </div>
            </div>
          </div>

          {/* ── 里程碑时间线 ── */}
          {milestones.length > 0 && (
            <div style={{ padding: "0 16px 8px" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 14 }}>
                里程碑
              </div>
              {milestones.map((m, i) => {
                const isFirst = i === 0;
                const isLast  = m.isFinal;
                const desc = isFirst
                  ? "第一个十万最难，坚持是关键"
                  : isLast
                  ? `${years} 年复利旅程终值`
                  : m.target >= 1_000_000
                  ? "百万达成，加速度显现"
                  : "加速度显现，见证复利力量";
                return (
                  <div key={m.label} style={{ display: "flex", gap: 14, marginBottom: 4 }}>
                    {/* 年份标签 */}
                    <div style={{ width: 46, textAlign: "right", paddingTop: 12, flexShrink: 0 }}>
                      <span className="font-mono" style={{ fontSize: 11, color: "var(--fg-2)", fontWeight: 600 }}>
                        第 {m.year} 年
                      </span>
                    </div>
                    {/* 时间线竖轨 */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{
                        width: 11, height: 11, borderRadius: 6, marginTop: 13,
                        background: isLast ? "var(--up)" : "var(--bg-2)",
                        border: isLast ? "none" : "2px solid var(--line-2)",
                        boxShadow: isLast ? "0 0 10px rgba(30,211,149,.6)" : "none",
                      }} />
                      {i < milestones.length - 1 && (
                        <div style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 4, minHeight: 16 }} />
                      )}
                    </div>
                    {/* 内容卡 */}
                    <div style={{
                      flex: 1, padding: "10px 14px", borderRadius: 12,
                      background: "rgba(255,255,255,.022)", border: "1px solid var(--line)",
                      marginBottom: 10,
                    }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span className="font-mono" style={{ fontSize: 17, fontWeight: 700, color: isLast ? "var(--up)" : "var(--fg-0)" }}>
                          {fmtMoney(m.target)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 3 }}>{desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 早开始 5 年 卡片 ── */}
          <div style={{ margin: "0 16px 16px", borderRadius: 14, border: "1px solid rgba(245,158,11,.25)", padding: "14px", background: "linear-gradient(135deg, rgba(245,181,60,.08), transparent 70%)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Flame size={14} style={{ color: "#F59E0B" }} />
              <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(252,211,77,.9)" }}>早开始 5 年</span>
            </div>
            <div className="font-serif" style={{ fontSize: 30, fontWeight: 700, color: "#FCD34D", letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 8, fontFamily: "Georgia, 'Times New Roman', serif" }}>
              +{fmtMoney(story.earlyDelta)}
            </div>
            <p style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6, margin: 0 }}>
              同样定投，早 5 年开始，{years + 5} 年终值达 <span className="font-mono" style={{ color: "#FCD34D" }}>{fmtMoney(story.fvEarly)}</span>。时间是复利唯一无法补救的变量。
            </p>
          </div>
        </div>

        {/* ── 底部操作条 ── */}
        <ThumbActionBar
          primary={
            typeof onOneClickBacktest === "function"
              ? {
                  label: "一键回测当前档位 →",
                  onClick: () => {
                    const strats = STRATEGY_LIBRARY[currentTier] || [];
                    const best = strats.find((s) => !s.warning && Object.keys(s.weights || {}).length > 0);
                    if (best) onOneClickBacktest(best.weights);
                  },
                }
              : undefined
          }
        />

        {/* ── 全屏横屏图表 ── */}
        <FullscreenChart
          open={fsChart}
          onClose={() => setFsChart(false)}
          title={`复利增长曲线 · ${years} 年`}
          meta={
            <span className="font-mono" style={{ fontSize: 16, fontWeight: 600, color: "var(--up)" }}>
              {fmtMoney(story.finalTotal)}
            </span>
          }
          indicators={fsIndicators}
          footerNote={`初始 ${fmtMoney(principal)}${monthly > 0 ? ` · 月供 ${fmtMoney(monthly)}` : ""} · 年化 ${fmtPct(selectedRate, 0)} · ${years} 年`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={story.chart} margin={{ left: 12, right: 20, top: 10, bottom: 4 }}>
              <defs>
                <linearGradient id="fsCpTot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1ED395" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#1ED395" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" />
              <XAxis dataKey="year" stroke="#667" fontSize={10} tickFormatter={(y) => `${y}年`} tickLine={false} axisLine={false} />
              <YAxis stroke="#667" fontSize={10} width={52} tickFormatter={(v) => formatBigNumber(v, 0)} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,.1)", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#a0aec0", fontSize: 10 }}
                formatter={(v, n) => [fmtMoney(v), n]}
                labelFormatter={(y) => `第 ${y} 年`}
              />
              <Area type="monotone" dataKey="total" name="账户总值" stroke="#1ED395" strokeWidth={2.4} fill="url(#fsCpTot)" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="principal" name="累计本金" stroke="#5A5E76" strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              {story.crossoverYear != null && (
                <ReferenceLine x={story.crossoverYear} stroke="rgba(245,181,60,.5)" strokeDasharray="3 3"
                  label={{ value: `第 ${story.crossoverYear} 年·复利超本金`, position: "insideTopLeft", fontSize: 9, fill: "#F5B53C" }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </FullscreenChart>
      </div>
    );
  }

  return (
    // v5 对齐：移除 bg-[#0d1117] 硬编码，让父 shell 的 theme bg 透出来（同 PR #195 SmartBeta 模式）
    <div className="h-full overflow-y-auto">
      {/* ── Header ─ sticky + theme-aware bg ─ */}
      <div className="sticky top-0 z-10 backdrop-blur border-b border-white/8 px-4 py-2.5" style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)" }}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>复利的力量 · The Power of Compounding</h2>
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
          "时间是投资人最好的朋友" — 输入年化收益率、年限、本金，看复利曲线，并对照同档风险下的可行组合。
        </p>
      </div>

      {/* ── §1 复利计算器 ────────────────────────────── */}
      <div className="p-4 space-y-3">
        {/* v5 增长叙事：左假设滑块 + 72法则 · 右 serif 终值 + 分层曲线 + 洞见 */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">
          {/* 左：假设滑块 + 72 法则 */}
          <div className="glass-card p-4 flex flex-col">
            <div className="text-[10px] uppercase tracking-wider text-[#778] mb-3">假设条件</div>
            <AssumptionSlider label="初始本金" displayValue={fmtMoney(principal)}
              value={Math.min(500000, principal)} min={0} max={500000} step={5000}
              onChange={(v) => setPrincipalStr(String(v))} loLabel="$0" hiLabel="$500k" />
            <AssumptionSlider label="每月定投" displayValue={fmtMoney(monthly)}
              value={Math.min(10000, monthly)} min={0} max={10000} step={250}
              onChange={(v) => setMonthlyStr(String(v))} loLabel="$0" hiLabel="$10k" />
            <AssumptionSlider label="年化收益" displayValue={fmtPct(selectedRate, 0)}
              value={Math.max(0, RETURN_OPTIONS.findIndex((o) => o.rate === selectedRate))}
              min={0} max={RETURN_OPTIONS.length - 1} step={1}
              onChange={(i) => { setSelectedRate(RETURN_OPTIONS[i].rate); setTierOverride(null); }}
              loLabel={RETURN_OPTIONS[0].label} hiLabel={RETURN_OPTIONS[RETURN_OPTIONS.length - 1].label} />
            <AssumptionSlider label="投资年限" displayValue={`${years} 年`}
              value={Math.max(0, YEAR_OPTIONS.indexOf(years))}
              min={0} max={YEAR_OPTIONS.length - 1} step={1}
              onChange={(i) => setYears(YEAR_OPTIONS[i])}
              loLabel={`${YEAR_OPTIONS[0]} 年`} hiLabel={`${YEAR_OPTIONS[YEAR_OPTIONS.length - 1]} 年`} />
            {rateOpt.warning && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 text-[10px] text-amber-300 flex items-start gap-1.5 mt-1">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" /><span>{rateOpt.warning}</span>
              </div>
            )}
            <div className="mt-auto pt-3 border-t border-white/8">
              <div className="text-[9px] uppercase tracking-wider text-[#778] mb-1.5">72 法则</div>
              <p className="text-[11px] text-[#a0aec0] leading-relaxed">
                年化 <span className="font-mono text-up">{fmtPct(selectedRate, 0)}</span> → 资产翻倍约需{" "}
                <span className="font-mono text-cyan-300 font-semibold">{story.doublingYears ? story.doublingYears.toFixed(1) : "—"} 年</span>。
                {years} 年里本金大约翻 <span className="font-mono text-white font-semibold">{fmtMult(story.mult)}</span>。
              </p>
            </div>
          </div>

          {/* 右：增长叙事 */}
          <div className="glass-card p-4" style={{ background: "radial-gradient(ellipse 600px 360px at 85% 0%, rgba(30,211,149,0.06), transparent)" }}>
            <div className="text-[10px] uppercase tracking-wider text-[#778] mb-2">
              {years} 年后 · 从 {fmtMoney(principal)} 起步{monthly > 0 ? ` · 每月 +${fmtMoney(monthly)}` : ""}
            </div>
            <div className="flex items-end gap-4 flex-wrap mb-1">
              <span className="font-serif font-semibold leading-none" style={{ fontSize: "clamp(48px,7vw,76px)", letterSpacing: "-0.03em", background: "linear-gradient(135deg,#fff 20%,#1ED395 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {fmtMoney(story.finalTotal)}
              </span>
              <div className="pb-2">
                <span className="inline-flex items-center gap-1 text-[13px] font-bold font-mono px-2.5 py-1 rounded-md bg-up/15 text-up border border-up/30">▲ {fmtMult(story.mult)} 本金</span>
                <div className="text-[12px] text-[#778] mt-1.5">其中 <span className="font-mono text-up">{fmtMoney(story.finalGrowth)}</span> 是复利赚来的</div>
              </div>
            </div>
            {/* 本金 vs 复利增值 拆分条 */}
            <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5 mt-4 mb-1.5">
              <div style={{ width: `${(1 - story.growthPct) * 100}%`, background: "linear-gradient(90deg,#5A5E76,#6B7088)" }} className="rounded-l-full" />
              <div style={{ width: `${story.growthPct * 100}%`, background: "linear-gradient(90deg,#1ED395,#5EE6E6)", boxShadow: "0 0 10px rgba(30,211,149,.4)" }} className="rounded-r-full" />
            </div>
            <div className="flex justify-between text-[11px] mb-4">
              <span className="text-[#778]"><span className="text-white/90">本金 {fmtMoney(story.finalPrincipal)}</span> · {((1 - story.growthPct) * 100).toFixed(0)}%</span>
              <span className="text-up font-semibold">复利增值 {fmtMoney(story.finalGrowth)} · {(story.growthPct * 100).toFixed(0)}%</span>
            </div>
            {/* 双层增长曲线 + 交叉点 */}
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-[12px] font-semibold text-white/90">本金 vs 复利增值</h3>
              <div className="flex gap-3 text-[10px] text-[#a0aec0]">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-3.5 h-0.5 bg-[#5A5E76]" />累计本金</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-3.5 h-0.5 bg-up" />账户总值</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={story.chart} margin={{ left: 6, right: 12, top: 8, bottom: 2 }}>
                <defs>
                  <linearGradient id="cpTot" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1ED395" stopOpacity={0.28} /><stop offset="100%" stopColor="#1ED395" stopOpacity={0} /></linearGradient>
                  <linearGradient id="cpPrin" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5A5E76" stopOpacity={0.3} /><stop offset="100%" stopColor="#5A5E76" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="year" stroke="#667" fontSize={9} tickFormatter={(y) => `${y}年`} tickLine={false} axisLine={false} />
                <YAxis stroke="#667" fontSize={9} width={44} tickFormatter={(v) => formatBigNumber(v, 0)} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }} labelStyle={{ color: "#a0aec0", fontSize: 10 }} formatter={(v, n) => [fmtMoney(v), n]} labelFormatter={(y) => `第 ${y} 年`} />
                <Area type="monotone" dataKey="total" name="账户总值" stroke="#1ED395" strokeWidth={2.4} fill="url(#cpTot)" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="principal" name="累计本金" stroke="#5A5E76" strokeWidth={1.4} strokeDasharray="4 3" fill="url(#cpPrin)" dot={false} isAnimationActive={false} />
                {story.crossoverYear != null && (
                  <ReferenceLine x={story.crossoverYear} stroke="rgba(245,181,60,0.5)" strokeDasharray="3 3"
                    label={{ value: `第 ${story.crossoverYear} 年 · 复利超过本金`, position: "insideTopLeft", fontSize: 9, fill: "#F5B53C" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {/* 情景对比 + 早开始 5 年 */}
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3 mt-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <h3 className="text-[12px] font-semibold text-white/90 mb-3">不同年化的 {years} 年终值</h3>
                {story.scenarios.map((s) => {
                  const c = s.r === 0.06 ? "#a0aec0" : s.r === 0.14 ? "#5EE6E6" : "#1ED395";
                  const label = s.r === 0.06 ? "保守 6%" : s.r === 0.14 ? "进取 14%" : "基准 10%";
                  // v7: vs 基准(10%) diff — 对齐设计稿 SECTION 10「情景队列 diff」
                  const baseFv = story.scenarios.find(x => x.r === 0.10)?.fv;
                  const diffPct = (baseFv && s.r !== 0.10) ? (s.fv / baseFv - 1) * 100 : null;
                  return (
                    <div key={s.r} className="mb-2.5">
                      <div className="flex justify-between mb-1 items-baseline">
                        <span className="text-[11px] text-[#a0aec0]">{label}{diffPct != null && <span className="ml-1.5 font-mono text-[9px]" style={{ color: c }}>{diffPct >= 0 ? "+" : ""}{diffPct.toFixed(0)}% vs 基准</span>}</span>
                        <span className="font-mono font-serif text-[15px] font-semibold" style={{ color: c }}>{fmtMoney(s.fv)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(4, s.fv / story.scenMax * 100)}%`, background: `linear-gradient(90deg, ${c}66, ${c})`, boxShadow: `0 0 8px ${c}44` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-lg border border-amber-500/25 p-3" style={{ background: "linear-gradient(135deg, rgba(245,181,60,0.08), transparent 70%)" }}>
                <div className="flex items-center gap-1.5 mb-2"><Flame size={13} className="text-amber-400" /><span className="text-[10px] uppercase tracking-wider text-amber-200/90">早开始 5 年</span></div>
                <div className="font-serif font-semibold text-amber-300 leading-none mb-2" style={{ fontSize: 32, letterSpacing: "-0.02em" }}>+{fmtMoney(story.earlyDelta)}</div>
                <p className="text-[11px] text-[#a0aec0] leading-relaxed">
                  同样的定投，只要<b className="text-white">早 5 年</b>开始，{years + 5} 年终值达 <span className="font-mono text-amber-300">{fmtMoney(story.fvEarly)}</span> —— 多出的几乎全是复利。
                  <span className="block mt-2 text-[#778]">时间是复利唯一无法补救的变量。</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 进阶分析：蒙特卡洛 / 通胀 / SPY（基于初始本金，不含月定投）— 折叠 */}
        <details className="glass-card p-3">
          <summary className="cursor-pointer text-[11px] font-semibold text-white/80 flex items-center gap-1.5 select-none">
            <Info size={13} className="text-indigo-400" /> 进阶分析 · 蒙特卡洛 / 通胀 / SPY 对照
            <span className="text-[9px] text-[#778] font-normal ml-1">（基于初始本金 {fmtMoney(principal)}，不含月定投）</span>
          </summary>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <StatCard label="名义终值" value={fmtMoney(finalNominal)} hint={`本金 ${formatBigNumber(principal, 2)} · ${fmtMult(multiplier)}`} accent="emerald" />
            <StatCard label="实际购买力" value={fmtMoney(finalReal)} hint={`扣 ${fmtPct(INFLATION_RATE, 0)} 通胀 × ${years} 年`} accent="sky" />
            <StatCard label="SPY 基准对照" value={fmtMoney(finalSpy)} hint={isSPYRate ? "= 名义" : `年化 ${fmtPct(SPY_LONG_RUN, 0)} × ${years} 年`} accent="amber" />
            <StatCard label="蒙特卡洛中位数" value={fmtMoney(mc.summary.p50)} hint={`区间 ${fmtMoney(mc.summary.p05)} – ${fmtMoney(mc.summary.p95)}`} accent={tierMeta.accent} warning={mc.summary.ruinProb > 0.05 ? `${fmtPct(mc.summary.ruinProb, 1)} 路径终值不到本金一半` : null} />
          </div>
          {showDivergenceBanner && (
            <div className="mt-3 rounded-md bg-indigo-500/10 border border-indigo-500/30 px-3 py-2 text-[11px] text-indigo-200 flex items-start gap-2">
              <Info size={12} className="shrink-0 mt-0.5" />
              <span><strong>波动放大：</strong>名义复利 <span className="font-mono mx-1">{fmtMoney(finalNominal)}</span> 是"运气一直在线"的上限；蒙特卡洛中位数 <span className="font-mono mx-1">{fmtMoney(mc.summary.p50)}</span> 才是 50% 概率水平 — 名义是中位数的 <span className="font-mono mx-1">{formatBigNumber(divergenceRatio, 1)} 倍</span>。σ 越高、年限越长，差距越极端（lognormal 偏度）。</span>
            </div>
          )}
          <div className="mt-3">
            <div className="text-[10px] text-[#a0aec0] font-mono mb-2">σ = {fmtPct(RISK_TIERS[autoTier].volatility, 0)} · 1000 路径{useLogScale ? " · 对数 Y 轴" : ""}{isSPYRate ? " · SPY 重叠已隐藏" : ""}</div>
            <GrowthChart data={chartData} showSpy={!isSPYRate} useLogScale={useLogScale} />
          </div>
        </details>

        {/* ── §2 风险等级对照表 ─────────────────────── */}
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-white/90 flex items-center gap-1.5">
              <Shield size={13} className="text-sky-400" />
              风险等级对照（点击切换查看对应策略）
            </h3>
            <span className="text-[10px] text-[#a0aec0]">
              当前自动匹配 <span className={ACCENT_CLASS[tierMeta.accent].text}>{tierMeta.label}</span>
              {tierOverride && (
                <button
                  onClick={() => setTierOverride(null)}
                  className="ml-2 underline hover:text-white"
                >
                  恢复自动
                </button>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {TIER_ORDER.map((tid) => (
              <RiskTierCard
                key={tid}
                tierId={tid}
                active={currentTier === tid}
                onClick={() => setTierOverride(tid === autoTier ? null : tid)}
              />
            ))}
          </div>
        </div>

        {/* ── §3 策略组合推荐 ─────────────────────────── */}
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-[11px] font-semibold text-white/90 flex items-center gap-1.5">
              <Sparkles size={13} className={ACCENT_CLASS[tierMeta.accent].text} />
              {tierMeta.label} · 候选组合（{strategies.length}）
            </h3>
            <span className="text-[10px] text-[#a0aec0]">
              目标年化 {fmtPct(tierMeta.targetReturn[0], 0)}–{fmtPct(tierMeta.targetReturn[1], 0)}
              · 最大回撤 ~{fmtPct(tierMeta.maxDD, 0)}
            </span>
          </div>
          <div className={`grid gap-2.5 ${
            strategies.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3"
          }`}>
            {strategies.map((s, i) => (
              <StrategyCard key={i} strategy={s} onOneClickBacktest={onOneClickBacktest} />
            ))}
          </div>
          {currentTier === "extreme" && (
            <div className="mt-3 rounded-md bg-down/10 border border-down/30 px-3 py-2 text-[11px] text-down flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                <strong>提醒：</strong>50%+ 持续年化在任何成熟资产类别上都不可持续。
                若历史回测显示这种收益，多半是过拟合或样本期偏差，请勿当作可执行策略。
              </span>
            </div>
          )}
        </div>

        {/* 底部脚注 */}
        <div className="text-[10px] text-[#6b7280] leading-relaxed px-1 py-2">
          <p>
            <strong>方法论：</strong>名义复利 = 本金 ×(1+r)^n；
            实际购买力 = 名义值 / (1+通胀)^n（通胀取美元长期 3%）；
            蒙特卡洛 = 几何布朗运动，对数收益 ~ N(ln(1+μ) - σ²/2, σ²)，1000 路径取分位。
          </p>
          <p className="mt-1">
            <strong>免责：</strong>本页所有"策略组合"为教育性示例，基于历史经验的资产配置范式，
            非实盘推荐。"蒙特卡洛区间"假设收益独立同分布，**严重低估**长尾风险（黑天鹅、流动性危机、再平衡成本等）。
          </p>
        </div>
      </div>
    </div>
  );
}
