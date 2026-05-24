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
  TrendingUp, Sparkles, AlertTriangle, Info, Shield, Flame,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  compoundFinalValue, compoundSeries, inflationAdjusted,
  monteCarloAnnual, formatBigNumber,
} from "../math/compound.ts";

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
function StrategyCard({ strategy }) {
  const isWarn = strategy.warning;
  const tickers = Object.entries(strategy.weights || {});
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
      {/* V1: 一键回测按钮 — 暂未接入跳转逻辑 */}
      <button
        disabled
        className="mt-2 w-full text-[10px] px-2 py-1 rounded border border-white/10 text-[#6b7280] cursor-not-allowed"
        title="V2 将接入组合回测"
      >
        一键回测（即将上线）
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
export default function CompoundPower() {
  const [selectedRate, setSelectedRate] = useState(0.10);
  const [years, setYears] = useState(10);
  const [principalStr, setPrincipalStr] = useState("");
  const [tierOverride, setTierOverride] = useState(null);

  const principal = useMemo(() => {
    const n = parseFloat(principalStr);
    return isFinite(n) && n > 0 ? n : 1;
  }, [principalStr]);

  // 用户输入了内容但解析失败/非正数 — 用于 UI 反馈
  const principalInvalid = useMemo(() => {
    const trimmed = principalStr.trim();
    if (trimmed === "") return false;
    const n = parseFloat(trimmed);
    return !(isFinite(n) && n > 0);
  }, [principalStr]);

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

  // 当前展示的策略
  const strategies = STRATEGY_LIBRARY[currentTier] || [];

  return (
    <div className="h-full overflow-y-auto bg-[#0d1117] text-white">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-tight">复利的力量 · The Power of Compounding</h2>
        </div>
        <p className="text-[10px] text-[#a0aec0] mt-0.5">
          "时间是投资人最好的朋友" — 输入年化收益率、年限、本金，看复利曲线，并对照同档风险下的可行组合。
        </p>
      </div>

      {/* ── §1 复利计算器 ────────────────────────────── */}
      <div className="p-4 space-y-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-[#a0aec0] mb-1 block">年化收益率</label>
              <ButtonGroup
                ariaLabel="年化收益率"
                options={RETURN_OPTIONS}
                value={selectedRate}
                onChange={(v) => { setSelectedRate(v); setTierOverride(null); }}
                getKey={(o) => o.rate}
                getLabel={(o) => o.label}
                warningOf={(o) => o.warning}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#a0aec0] mb-1 block">年限</label>
              <ButtonGroup
                ariaLabel="投资年限"
                options={YEAR_OPTIONS}
                value={years}
                onChange={setYears}
                getKey={(y) => y}
                getLabel={(y) => `${y}年`}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#a0aec0] mb-1 flex items-center gap-1">
                本金
                <span className="text-[#6b7280]" title="留空则默认 1（看倍数）">
                  <Info size={9} />
                </span>
              </label>
              <input
                type="number"
                value={principalStr}
                onChange={(e) => setPrincipalStr(e.target.value)}
                placeholder="留空 = 1"
                min="0"
                step="any"
                aria-invalid={principalInvalid}
                className={`w-full bg-white/[0.03] border rounded px-2 py-1.5 text-[11px] text-white font-mono placeholder:text-[#6b7280] focus:outline-none ${
                  principalInvalid
                    ? "border-rose-500/50 focus:border-rose-500"
                    : "border-white/10 focus:border-indigo-500/50"
                }`}
              />
              <div className={`text-[10px] mt-0.5 font-mono ${
                principalInvalid ? "text-rose-400" : "text-[#a0aec0]"
              }`}>
                {principalInvalid
                  ? `非法输入，已回退到 1`
                  : `当前：${formatBigNumber(principal, 2)}`}
              </div>
            </div>
          </div>

          {rateOpt.warning && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 mb-3 text-[11px] text-amber-300 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{rateOpt.warning}</span>
            </div>
          )}

          {/* 四联统计卡 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <StatCard
              label="名义终值" value={fmtMoney(finalNominal)}
              hint={`本金 ${formatBigNumber(principal, 2)} · ${fmtMult(multiplier)}`}
              accent="emerald"
            />
            <StatCard
              label="实际购买力" value={fmtMoney(finalReal)}
              hint={`扣 ${fmtPct(INFLATION_RATE, 0)} 通胀 × ${years} 年`}
              accent="sky"
            />
            <StatCard
              label="SPY 基准对照" value={fmtMoney(finalSpy)}
              hint={isSPYRate
                ? `= 名义（你正选 SPY 长期均值）`
                : `年化 ${fmtPct(SPY_LONG_RUN, 0)} × ${years} 年`}
              accent="amber"
            />
            <StatCard
              label="蒙特卡洛中位数"
              value={fmtMoney(mc.summary.p50)}
              hint={`区间 ${fmtMoney(mc.summary.p05)} – ${fmtMoney(mc.summary.p95)}`}
              accent={tierMeta.accent}
              warning={mc.summary.ruinProb > 0.05
                ? `${fmtPct(mc.summary.ruinProb, 1)} 路径终值不到本金一半`
                : null}
            />
          </div>

          {/* lognormal 偏度解读 — 名义复利 vs 中位数严重偏离时显示 */}
          {showDivergenceBanner && (
            <div className="mt-3 rounded-md bg-indigo-500/10 border border-indigo-500/30 px-3 py-2 text-[11px] text-indigo-200 flex items-start gap-2">
              <Info size={12} className="shrink-0 mt-0.5" />
              <span>
                <strong>波动放大：</strong>名义复利
                <span className="font-mono mx-1">{fmtMoney(finalNominal)}</span>
                是"运气一直在线"的上限；蒙特卡洛中位数
                <span className="font-mono mx-1">{fmtMoney(mc.summary.p50)}</span>
                才是 50% 概率水平 — 名义是中位数的
                <span className="font-mono mx-1">{formatBigNumber(divergenceRatio, 1)} 倍</span>。
                σ 越高、年限越长，这个差距越极端（lognormal 偏度）。
              </span>
            </div>
          )}
        </div>

        {/* 增长曲线 */}
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-[11px] font-semibold text-white/90 flex items-center gap-1.5">
              <TrendingUp size={13} className="text-emerald-400" />
              增长曲线 · {fmtPct(selectedRate, 0)} × {years} 年
            </h3>
            <span className="text-[10px] text-[#a0aec0] font-mono space-x-2">
              <span>σ = {fmtPct(RISK_TIERS[autoTier].volatility, 0)} · 1000 路径</span>
              {useLogScale && <span className="text-indigo-400">· 对数 Y 轴</span>}
              {isSPYRate && <span className="text-amber-400">· SPY 重叠已隐藏</span>}
            </span>
          </div>
          <GrowthChart data={chartData} showSpy={!isSPYRate} useLogScale={useLogScale} />
        </div>

        {/* ── §2 风险等级对照表 ─────────────────────── */}
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
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
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
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
            {strategies.map((s, i) => <StrategyCard key={i} strategy={s} />)}
          </div>
          {currentTier === "extreme" && (
            <div className="mt-3 rounded-md bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-300 flex items-start gap-2">
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
