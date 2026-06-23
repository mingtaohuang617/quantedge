// ─────────────────────────────────────────────────────────────
// ScoringDashboard — 评分仪表盘 / 股票列表 / 详情面板
// 从 quant-platform.jsx 抽出（C1 重构第四步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from "react";
import { LineChart, Line, AreaChart, Area, Bar, Brush, Customized, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart, ReferenceLine } from "recharts";
import { Activity, ArrowDownRight, ArrowUpRight, Briefcase, Calendar, Check, ChevronDown, ChevronRight, Clock, Database, Eye, Filter, GripVertical, Info, Layers, Loader, Maximize2, Minus, Plus, RefreshCw, Search, Settings, Star, Trash2, TrendingUp, X, Zap, ArrowLeftRight } from "lucide-react";
import { searchTickers as standaloneSearch, fetchRangePrices, STOCK_CN_NAMES, STOCK_CN_DESCS, STOCK_EN_DESCS } from "../standalone.js";
import { Z_ELEVATED } from "../lib/zIndex.js";
import { useLang, isZh, localeFor, hasCJK, enFallback } from "../i18n.jsx";
import { STOCKS } from "../data.js";
import AIStockSummaryCard from "../components/AIStockSummaryCard.jsx";
import ScoreExplainCard from "../components/ScoreExplainCard.jsx";
import ValuationReadCard from "../components/ValuationReadCard.jsx";
import MacroAdjustBadge from "../components/MacroAdjustBadge.jsx";
import macroSnapshot from "../macroSnapshot.json";
import { TEMP_TEXT, TEMP_LABEL } from "../components/macro/shared.js";
import { macroAdjustedScore } from "../lib/macroAdjust.js";
import {
  DataContext,
  useData,
  useWorkspace,
  apiFetch,
  displayTicker,
  safeChange,
  fmtChange,
  TOOLTIP_STYLE,
  Badge,
  CountUp,
  Highlight,
  ScoreBar,
  SkeletonBlock,
  MobileAccordion,
  MiniSparkline,
  get5DSparkData,
  useContainerSize,
  currencySymbol,
  fmtPrice,
} from "../quant-platform.jsx";
import useIsMobile from "../hooks/useIsMobile";
import { BottomSheet, ThumbActionBar, MobileAppBar, FullscreenChart, Segmented } from "../components/mobile";

// P3 双轨权重：质量/时机两档（localStorage key: quantedge_weights_<wsId>）
// 综合分 = 质量分 × quality% + 时机分 × timing%（对齐后端 COMPOSITE 0.6/0.4）
const DEFAULT_WEIGHTS = { quality: 60, timing: 40 };
function loadWeights(wsId) {
  try {
    const raw = localStorage.getItem(`quantedge_weights_${wsId || 'default'}`);
    if (raw) {
      const w = JSON.parse(raw);
      if (typeof w?.quality === 'number' && typeof w?.timing === 'number') {
        return w;
      }
    }
  } catch { /* 静默回退（含旧三轴格式自动迁移到默认） */ }
  return { ...DEFAULT_WEIGHTS };
}

// ── P3 双轨维度元数据 ──────────────────────────────────────────
// 质量轨：个股 估值/盈利/成长；ETF 成本/流动性/分散。时机轨（通用）：动量/趋势/RSI。
const SUB_LABELS = {
  valuation: '估值', profitability: '盈利', growth: '成长',
  cost: '成本', liquidity: '流动性', diversification: '分散',
  momentum: '动量', trend: '趋势', rsi: 'RSI',
};
const TIMING_KEYS = ['momentum', 'trend', 'rsi'];
const qualityKeys = (isETF) => (isETF ? ['cost', 'liquidity', 'diversification'] : ['valuation', 'profitability', 'growth']);

// ─── 移动端：评分环 + 要素条（v6 全屏个股卡用）──────────────
function ScoreRing({ score = 0, size = 76 }) {
  const r = 42, C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const col = score >= 75 ? "var(--up)" : score >= 50 ? "var(--indigo-2)" : "var(--warn)";
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="7" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="font-mono" style={{ fontSize: size * 0.31, fontWeight: 700, color: "var(--fg-0)", lineHeight: 1 }}>{Number.isFinite(score) ? Math.round(score) : "—"}</span>
      </div>
    </div>
  );
}

function MPillar({ name, v, w, c, hl }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ width: 3, height: 34, borderRadius: 2, background: c, boxShadow: `0 0 8px ${c}66` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-0)" }}>{name}<span style={{ fontSize: 10, color: "var(--fg-3)", fontWeight: 400, marginLeft: 6 }}>权重 {w}%</span></span>
          <span className="font-mono score-accent-num" style={{ fontSize: 18, fontWeight: 700, color: c, lineHeight: 1 }}>{v != null ? Math.round(v) : "—"}</span>
        </div>
        <div style={{ height: 4, background: "rgba(255,255,255,.05)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, v || 0))}%`, height: "100%", background: `linear-gradient(90deg,${c}55,${c})`, borderRadius: 2 }} />
        </div>
        {hl && <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 5 }}>{hl}</div>}
      </div>
    </div>
  );
}

// MA20 趋势均线只在「日线级别」区间有效（interval=1d）。其余区间画 20 点均线
// 会偷换单位（分时/周/月），所以只在这几个区间显示，标注才诚实。
const MA_RANGES = new Set(["1M", "6M", "YTD", "1Y"]);

// ─── 图表技术指标注册表 ────────────────────────────────────
// 周期均以「K 线根数」为单位（与 TradingView 等一致）：在不同区间下
// 一根 K 的跨度不同（分时=5m、5Y=周、ALL=月），但 MA(N)=最近 N 根均值
// 这一定义在任何区间都成立，所以 chip 标注直接用 MA20/EMA12 即可，诚实。
// color 同时充当 chip 高亮色与折线色（chip 即图例）。
const INDICATORS = [
  // MA：周期为 5 的倍数（短→长）
  { key: "ma5",   group: "MA",   type: "sma",  period: 5,   color: "#22d3ee", label: "MA5" },
  { key: "ma10",  group: "MA",   type: "sma",  period: 10,  color: "#818cf8", label: "MA10" },
  { key: "ma20",  group: "MA",   type: "sma",  period: 20,  color: "#F5B53C", label: "MA20", dash: "5 4" },
  { key: "ma30",  group: "MA",   type: "sma",  period: 30,  color: "#fb7185", label: "MA30" },
  { key: "ma60",  group: "MA",   type: "sma",  period: 60,  color: "#f97316", label: "MA60" },
  { key: "ma120", group: "MA",   type: "sma",  period: 120, color: "#e879f9", label: "MA120" },
  // EMA：周期取斐波那契数列
  { key: "ema8",  group: "EMA",  type: "ema",  period: 8,   color: "#34d399", label: "EMA8" },
  { key: "ema13", group: "EMA",  type: "ema",  period: 13,  color: "#a3e635", label: "EMA13" },
  { key: "ema21", group: "EMA",  type: "ema",  period: 21,  color: "#f472b6", label: "EMA21" },
  { key: "ema34", group: "EMA",  type: "ema",  period: 34,  color: "#facc15", label: "EMA34" },
  { key: "ema55", group: "EMA",  type: "ema",  period: 55,  color: "#c084fc", label: "EMA55" },
  { key: "ema89", group: "EMA",  type: "ema",  period: 89,  color: "#2dd4bf", label: "EMA89" },
  // 布林线
  { key: "boll",  group: "BOLL", type: "boll", period: 20, mult: 2, color: "#60a5fa", label: "BOLL(20,2)" },
];
// 指标分组（指标工具栏按 MA / EMA / 布林线 分区展示）
const INDICATOR_GROUPS = [
  { name: "MA", label: "MA 均线" },
  { name: "EMA", label: "EMA 指数均线" },
  { name: "BOLL", label: "布林线" },
];
// 放大弹窗的 K 线周期集合（与收起态 8 档不同）。从收起态打开放大图时，
// 不在此集合的区间(1M/6M/YTD/1D/ALL)归一到「日线」，避免放大工具栏无高亮档。
const MODAL_RANGES = ["5D", "1Y", "5Y", "MONK", "QUARK", "YEARK"];
// 画线持久化 key：趋势线/测量锚定周期相关的 K 线标签，跨周期无法映射，故按 (标的, 周期) 分桶。
const drawingsKey = (ticker, range) => `quantedge_drawings_${ticker}_${range}`;
// 水平线仅锚 price（无日期），天然跨周期通用 → 按标的单独存，所有周期共享同一套。
const hlinesKey = (ticker) => `quantedge_hlines_${ticker}`;

// 简单移动平均：把 key 写到对应数据点上（前 period-1 根无值，连线自动跳过）
function withSMA(data, period, key) {
  if (!Array.isArray(data) || data.length < period) return data;
  const out = data.slice();
  for (let i = period - 1; i < out.length; i++) {
    let sum = 0, ok = true;
    for (let k = i - period + 1; k <= i; k++) {
      const v = out[k].p;
      if (!(v > 0)) { ok = false; break; }
      sum += v;
    }
    if (ok) out[i] = { ...out[i], [key]: +(sum / period).toFixed(2) };
  }
  return out;
}

// 指数移动平均：用前 period 根的 SMA 作种子，再按 k=2/(period+1) 递推
function withEMA(data, period, key) {
  if (!Array.isArray(data) || data.length < period) return data;
  const out = data.slice();
  let seed = 0;
  for (let i = 0; i < period; i++) {
    const v = out[i].p;
    if (!(v > 0)) return out; // 头部含异常价 → 放弃该指标，避免污染递推
    seed += v;
  }
  let ema = seed / period;
  out[period - 1] = { ...out[period - 1], [key]: +ema.toFixed(2) };
  const k = 2 / (period + 1);
  for (let i = period; i < out.length; i++) {
    ema = out[i].p * k + ema * (1 - k);
    out[i] = { ...out[i], [key]: +ema.toFixed(2) };
  }
  return out;
}

// 布林线：中轨 = SMA(period)，上/下轨 = 中轨 ± mult×标准差（同窗口总体标准差）
function withBOLL(data, period, mult) {
  if (!Array.isArray(data) || data.length < period) return data;
  const out = data.slice();
  for (let i = period - 1; i < out.length; i++) {
    let sum = 0, ok = true;
    for (let k = i - period + 1; k <= i; k++) {
      const v = out[k].p;
      if (!(v > 0)) { ok = false; break; }
      sum += v;
    }
    if (!ok) continue;
    const mean = sum / period;
    let varSum = 0;
    for (let k = i - period + 1; k <= i; k++) { const d = out[k].p - mean; varSum += d * d; }
    const sd = Math.sqrt(varSum / period);
    out[i] = { ...out[i], boll_mid: +mean.toFixed(2), boll_up: +(mean + mult * sd).toFixed(2), boll_low: +(mean - mult * sd).toFixed(2) };
  }
  return out;
}

// 在 [lo, hi] 内生成「漂亮刻度」（1/2/5×10^k 步长）——用于价格/百分比轴，
// 避免上压域把刻度算成 17.252000…01 这种带浮点尾巴、且超出真实区间的丑数字。
function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return undefined;
  const rawStep = (hi - lo) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) {
    ticks.push(+v.toFixed(6));
  }
  return ticks.length ? ticks : undefined;
}

// 蜡烛图自定义 shape：Bar 的 dataKey 取 [low, high] → recharts 给出 y(=high 像素)
// 与 height(=high→low 像素跨度)，据此把开/收实体、上下影线画在价格坐标系里。
function CandleShape(props) {
  const { x, width, y, height, payload } = props;
  if (!payload) return null;
  const o = payload.o, h = payload.h, l = payload.l, c = payload.p;
  if (![o, h, l, c].every(Number.isFinite)) return null;
  const up = c >= o;
  const color = up ? "#1ED395" : "#FF6B6B";
  // 阳线空心（仅描边）、阴线实心 —— 复刻 TradingView 默认蜡烛观感
  const fill = up ? "none" : color;
  const cx = x + width / 2;
  // 实体宽度：留 30% 间隙，最细 1px
  const bw = Math.max(1, Math.min(width - 1, width * 0.7));
  const bx = cx - bw / 2;
  if (!(h > l)) {
    // 高=低（单点/异常）→ 退化成一条收盘横线
    return <line x1={bx} y1={y} x2={bx + bw} y2={y} stroke={color} strokeWidth={1} />;
  }
  const ratio = height / (h - l);          // 每价格单位对应的像素
  const yOpen = y + (h - o) * ratio;
  const yClose = y + (h - c) * ratio;
  const bodyTop = Math.min(yOpen, yClose);
  const bodyH = Math.max(1, Math.abs(yClose - yOpen));
  return (
    <g>
      {/* 上下影线（high → low） */}
      <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1} />
      {/* 实体：阳线空心(描边)、阴线实心 */}
      <rect x={bx} y={bodyTop} width={bw} height={bodyH} fill={fill} stroke={color} strokeWidth={up ? 1 : 0.5} rx={0.5} />
    </g>
  );
}

// 成交量副图：用 <Customized> 直接画，绕开 recharts「次坐标轴 Bar 不渲染」的坑。
// 借用主图的 x 轴 scale + plot offset，把量柱画在 plot 底部 ~26%，并跟随 Brush 缩放
// （缩放后 scale 只映射可见区间，区间外的点 scale 返回 undefined → 自动跳过）。
function VolumeLayer(props) {
  const { xAxisMap, offset, clipPathId, data, volMax } = props;
  if (!offset || !xAxisMap || !(volMax > 0) || !Array.isArray(data)) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const scale = xAxis && xAxis.scale;
  if (!scale) return null;
  const hasBand = typeof scale.bandwidth === "function";
  const band = hasBand ? scale.bandwidth() : 0;
  const baseY = offset.top + offset.height;
  const volH = offset.height * 0.26;                 // 量柱占 plot 底部 26%
  const bw = Math.max(1, (band || offset.width / Math.max(1, data.length)) * 0.6);
  const bars = [];
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!(d.v > 0)) continue;
    const xv = scale(d.m);
    if (xv == null || isNaN(xv)) continue;            // 缩放区间外 → 跳过
    const cx = xv + (hasBand ? band / 2 : 0);
    const h = Math.max(0.5, (d.v / volMax) * volH);
    const up = d.o != null ? d.p >= d.o : true;
    bars.push(
      <rect key={i} x={cx - bw / 2} y={baseY - h} width={bw} height={h}
        fill={up ? "rgba(30,211,149,0.42)" : "rgba(255,107,107,0.42)"} />
    );
  }
  // 量价分隔线：在价格区与成交量区交界(底部 ~30%)画一条淡线，明确分栏
  const dividerY = baseY - offset.height * 0.30;
  return (
    <g clipPath={clipPathId ? `url(#${clipPathId})` : undefined}>
      <line x1={offset.left} y1={dividerY} x2={offset.left + offset.width} y2={dividerY} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      {bars}
    </g>
  );
}

// 十字光标轴标签：价格轴(左)弹出价格药丸、时间轴(底)弹出日期药丸，并补一条横向参考线。
// hoverPoint(悬停数据点) 由 ComposedChart 的 onMouseMove 写入；借用主图 x/price 轴 scale 把药丸钉到精确像素。
function CrosshairLayer(props) {
  const { xAxisMap, yAxisMap, offset, point, priceFmt } = props;
  if (!point || !offset || !xAxisMap || !yAxisMap) return null;
  const d = point;
  if (!(d.p > 0)) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap.price || yAxisMap[Object.keys(yAxisMap)[0]];
  if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null;
  const xs = xAxis.scale, ys = yAxis.scale;
  const band = typeof xs.bandwidth === "function" ? xs.bandwidth() : 0;
  const xv = xs(d.m);
  const cy = ys(d.p);
  if (xv == null || isNaN(xv) || cy == null || isNaN(cy)) return null;  // 缩放区间外
  const cx = xv + band / 2;
  const left = offset.left, right = offset.left + offset.width, bottom = offset.top + offset.height;
  const priceTxt = priceFmt ? priceFmt(d.p) : `${Math.round(d.p * 100) / 100}`;
  const dateTxt = String(d.m ?? "");
  const pillH = 15;
  const pw = Math.max(34, priceTxt.length * 6.5 + 10);
  const dw = Math.max(30, dateTxt.length * 6.8 + 10);
  return (
    <g pointerEvents="none">
      <line x1={left} y1={cy} x2={right} y2={cy} stroke="rgba(255,255,255,0.22)" strokeWidth={1} strokeDasharray="3 3" />
      <rect x={left - pw} y={cy - pillH / 2} width={pw} height={pillH} rx={2} fill="#6366f1" />
      <text x={left - pw / 2} y={cy + 3.5} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#fff">{priceTxt}</text>
      <rect x={Math.max(left, Math.min(right - dw, cx - dw / 2))} y={bottom + 2} width={dw} height={pillH} rx={2} fill="#6366f1" />
      <text x={Math.max(left + dw / 2, Math.min(right - dw / 2, cx))} y={bottom + 13} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#fff">{dateTxt}</text>
    </g>
  );
}

// 最新价标线 + 左侧价签：借 price 轴 scale 把虚线与色块药丸钉到最新收盘价处。
function LastPriceLayer(props) {
  const { yAxisMap, offset, price, up, priceFmt } = props;
  if (price == null || !offset || !yAxisMap) return null;
  const yAxis = yAxisMap.price || yAxisMap[Object.keys(yAxisMap)[0]];
  if (!yAxis || !yAxis.scale) return null;
  const cy = yAxis.scale(price);
  if (cy == null || isNaN(cy) || cy < offset.top || cy > offset.top + offset.height) return null;
  const left = offset.left, right = offset.left + offset.width;
  const color = up ? "#1ED395" : "#FF6B6B";
  const txt = priceFmt ? priceFmt(price) : `${Math.round(price * 100) / 100}`;
  const w = Math.max(34, txt.length * 6.5 + 10);
  return (
    <g pointerEvents="none">
      <line x1={left} y1={cy} x2={right} y2={cy} stroke={color} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 2" />
      <rect x={left - w} y={cy - 7.5} width={w} height={15} rx={2} fill={color} />
      <text x={left - w / 2} y={cy + 3.5} textAnchor="middle" fontSize={10} fontFamily="monospace" fontWeight="600" fill="#0b0b15">{txt}</text>
    </g>
  );
}

// 把当前 price 轴 scale 写进 ref：图表外的 onClick 拿到像素 y，用 yScale.invert 反推价格。
function ScaleCapture(props) {
  const { yAxisMap, offset, geomRef } = props;
  if (geomRef && yAxisMap) {
    const yAxis = yAxisMap.price || yAxisMap[Object.keys(yAxisMap)[0]];
    geomRef.current = { yScale: yAxis && yAxis.scale, offset };
  }
  return null;
}

// 画线渲染层：把已画图元(趋势线/水平线/测量)与正在画的草稿，用当前 x/price scale 重绘。
// 图元锚定数据坐标 {m, price}，缩放/平移/周期切换自动跟随。
function DrawingLayer(props) {
  const { xAxisMap, yAxisMap, offset, drawings, draft, cursor, priceFmt, indexOf } = props;
  if (!offset || !xAxisMap || !yAxisMap || (!drawings?.length && !draft)) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap.price || yAxisMap[Object.keys(yAxisMap)[0]];
  if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null;
  const xs = xAxis.scale, ys = yAxis.scale;
  const band = typeof xs.bandwidth === "function" ? xs.bandwidth() : 0;
  const L = offset.left, R = offset.left + offset.width;
  const px = (pt) => { if (pt.m == null) return null; const v = xs(pt.m); return (v == null || isNaN(v)) ? null : v + band / 2; };
  const py = (pt) => { const v = ys(pt.price); return (v == null || isNaN(v)) ? null : v; };
  const items = [];
  const drawOne = (d, key, isDraft) => {
    const color = isDraft ? "#facc15" : (d.color || "#e5e7eb");
    const dash = isDraft ? "4 3" : undefined;
    if (d.type === "hline") {
      const y = py(d.a); if (y == null) return;
      const txt = priceFmt ? priceFmt(d.a.price) : `${Math.round(d.a.price * 100) / 100}`;
      const w = Math.max(34, txt.length * 6.5 + 10);
      items.push(<line key={key} x1={L} y1={y} x2={R} y2={y} stroke={color} strokeWidth={1.2} strokeDasharray={dash} />);
      items.push(<g key={key + "t"}><rect x={R - w} y={y - 7.5} width={w} height={15} rx={2} fill={color} /><text x={R - w / 2} y={y + 3.5} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#0b0b15">{txt}</text></g>);
      return;
    }
    const ax = px(d.a), ay = py(d.a);
    const b = d.b || cursor;
    if (ax == null || ay == null || !b) return;
    const bx = px(b), by = py(b);
    if (bx == null || by == null) return;
    items.push(<line key={key} x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={1.5} strokeDasharray={dash} />);
    if (d.type === "measure") {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      const pos = b.price >= d.a.price;
      const pct = d.a.price > 0 ? ((b.price - d.a.price) / d.a.price * 100) : 0;
      const bars = indexOf ? Math.abs(indexOf(b.m) - indexOf(d.a.m)) : null;
      const label = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%${bars != null && bars >= 0 ? ` · ${bars}根` : ""}`;
      const lw = Math.max(54, label.length * 6.6 + 12), cxm = (x0 + x1) / 2, lyt = y0 - 11;
      items.push(<rect key={key + "r"} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={pos ? "rgba(30,211,149,0.12)" : "rgba(255,107,107,0.12)"} stroke={color} strokeOpacity={0.4} />);
      items.push(<g key={key + "l"}><rect x={cxm - lw / 2} y={lyt - 9} width={lw} height={17} rx={3} fill={pos ? "#1ED395" : "#FF6B6B"} /><text x={cxm} y={lyt + 3} textAnchor="middle" fontSize={11} fontWeight="600" fontFamily="monospace" fill="#0b0b15">{label}</text></g>);
    } else if (!isDraft) {
      items.push(<circle key={key + "a"} cx={ax} cy={ay} r={2.5} fill={color} />);
      items.push(<circle key={key + "b"} cx={bx} cy={by} r={2.5} fill={color} />);
    }
  };
  drawings?.forEach((d, i) => drawOne(d, "d" + i, false));
  if (draft) drawOne(draft, "draft", true);
  return <g pointerEvents="none">{items}</g>;
}

// 对数轴「漂亮刻度」：在正数域 [lo,hi] 内取 1/2/5×10^k
function niceLogTicks(lo, hi) {
  if (!(lo > 0) || !(hi > lo)) return undefined;
  const ticks = [];
  const startExp = Math.floor(Math.log10(lo));
  const endExp = Math.ceil(Math.log10(hi));
  for (let e = startExp; e <= endExp; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(+v.toFixed(6));
    }
  }
  return ticks.length >= 2 ? ticks : undefined;
}

// ─── 市场交易时段判定 ───────────────────────────────────
// 返回 { usOpen, usPre, usPost, hkOpen, cnOpen, krOpen }，仅判断时段（不含节假日）
// 注：使用 IANA 时区名 (America/New_York 等)，DST 由 Intl 自动处理 — 美股冬令时
//     EST UTC-5 / 夏令时 EDT UTC-4 切换无需手动调整
export function getMarketsStatus(now = new Date()) {
  const partsIn = (tz) => {
    const arr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(now);
    const get = k => arr.find(p => p.type === k)?.value;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { d: dayMap[get('weekday')], h: parseInt(get('hour'), 10) % 24, m: parseInt(get('minute'), 10) };
  };
  const inRange = (h, m, h1, m1, h2, m2) => {
    const t = h * 60 + m, t1 = h1 * 60 + m1, t2 = h2 * 60 + m2;
    return t >= t1 && t < t2;
  };
  const isWeekday = d => d >= 1 && d <= 5;
  const ny = partsIn('America/New_York');
  const hk = partsIn('Asia/Hong_Kong');
  const sh = partsIn('Asia/Shanghai');
  const kr = partsIn('Asia/Seoul'); // KST UTC+9, 全年固定不用 DST
  return {
    usOpen: isWeekday(ny.d) && inRange(ny.h, ny.m, 9, 30, 16, 0),
    usPre:  isWeekday(ny.d) && inRange(ny.h, ny.m, 4, 0, 9, 30),
    usPost: isWeekday(ny.d) && inRange(ny.h, ny.m, 16, 0, 20, 0),
    hkOpen: isWeekday(hk.d) && (inRange(hk.h, hk.m, 9, 30, 12, 0) || inRange(hk.h, hk.m, 13, 0, 16, 0)),
    cnOpen: isWeekday(sh.d) && (inRange(sh.h, sh.m, 9, 30, 11, 30) || inRange(sh.h, sh.m, 13, 0, 15, 0)),
    krOpen: isWeekday(kr.d) && inRange(kr.h, kr.m, 9, 0, 15, 30), // 北京时间 08:00–14:30
  };
}

// 多标的对比模态框
const COMPARE_COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#ec4899"];
const CompareModal = ({ open, onClose, stocks }) => {
  const { t, lang } = useLang();
  const [overlay, setOverlay] = useState(true);
  if (!open || !stocks || stocks.length === 0) return null;
  // 统一 6 维度（个股）
  const axes = [
    { key: "pe", label: t("PE估值"), fn: s => s.pe && s.pe > 0 ? Math.max(0, 100 - s.pe * 0.8) : 20 },
    { key: "roe", label: "ROE", fn: s => s.roe ? Math.min(100, Math.max(0, s.roe * 0.8)) : 10 },
    { key: "mom", label: t("动量"), fn: s => s.momentum ?? 0 },
    { key: "rsi", label: "RSI", fn: s => s.rsi ?? 0 },
    { key: "rev", label: t("营收增长"), fn: s => s.revenueGrowth ? Math.min(100, s.revenueGrowth * 0.6) : 0 },
    { key: "mar", label: t("利润率"), fn: s => s.profitMargin ? Math.min(100, Math.max(0, s.profitMargin * 1.5)) : 0 },
  ];
  const radarData = axes.map(a => {
    const row = { factor: a.label };
    stocks.forEach(s => { row[s.ticker] = +a.fn(s).toFixed(1); });
    return row;
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ zIndex: Z_ELEVATED }} onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-cyan-300" />
            <h2 className="text-sm font-semibold text-white">{t('标的对比')}</h2>
            <span className="text-[10px] text-[#a0aec0]">{stocks.length}</span>
          </div>
          <button onClick={onClose} aria-label={t("关闭对比")} className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* 雷达叠加 */}
          <div className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-[#a0aec0]">{t('因子雷达')}</span>
              <div className="flex items-center gap-3">
                {stocks.map((s, i) => (
                  <span key={s.ticker} className="flex items-center gap-1 text-[10px] font-mono text-white">
                    <span className="w-2 h-2 rounded-full" style={{ background: COMPARE_COLORS[i] }} />
                    {s.ticker}
                  </span>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="factor" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {stocks.map((s, i) => (
                  <Radar key={s.ticker} name={s.ticker} dataKey={s.ticker}
                    stroke={COMPARE_COLORS[i]} fill={COMPARE_COLORS[i]} fillOpacity={0.08} strokeWidth={1.8} />
                ))}
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {/* KPI 表（sticky header + 每行 winner 高亮）*/}
          <div className="glass-card p-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                {/* sticky 必须放 <th> 才生效。指标列同时 sticky top + left（z-20 比 top-only 高一级）*/}
                <tr className="text-[10px] text-[#a0aec0] border-b border-white/8">
                  <th className="py-2 pr-2 font-medium sticky top-0 left-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur-sm">{t('指标')}</th>
                  {stocks.map((s, i) => (
                    <th key={s.ticker} className="py-2 px-2 font-medium font-mono sticky top-0 z-10 bg-[var(--bg-card)]/95 backdrop-blur-sm" style={{ color: COMPARE_COLORS[i] }}>{s.ticker}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {[
                  // 第 4 项 winner: "higher" | "lower" | null（null = 不评胜负，纯展示）
                  [t("名称"), s => isZh(lang) ? t(s.nameCN || STOCK_CN_NAMES[s.ticker] || s.name) : enFallback(s.name, s.ticker), "font-sans text-[10px] text-[#a0aec0]", null],
                  [t("现价"), s => `${currencySymbol(s.currency)}${s.price}`, "text-white", null],
                  [t("涨跌"), s => `${safeChange(s.change) >= 0 ? "+" : ""}${fmtChange(s.change)}%`, s => safeChange(s.change) >= 0 ? "text-up" : "text-down", "higher"],
                  [t("评分"), s => s.score?.toFixed(1), "text-indigo-300 font-semibold", "higher"],
                  // 趋势：基于 backend scoreDelta5d（5 日评分变化）。|delta|>2 显示箭头，否则横线。
                  // scoreSmoothed/scoreDelta5d 由 backend/score_history.py 计算，回落 None → "—"。
                  [t("趋势"), s => {
                    const d = s.scoreDelta5d;
                    if (d == null || !isFinite(d)) return "—";
                    if (d > 2) return `↑ +${d.toFixed(1)}`;
                    if (d < -2) return `↓ ${d.toFixed(1)}`;
                    return `→ ${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
                  }, s => {
                    const d = s.scoreDelta5d;
                    if (d == null || !isFinite(d)) return "text-[#778]";
                    if (d > 2) return "text-up";
                    if (d < -2) return "text-down";
                    return "text-[#a0aec0]";
                  }, null],
                  ["PE", s => s.pe?.toFixed(1) ?? "—", "text-white", "lower"],
                  ["ROE", s => s.roe ? `${s.roe.toFixed(1)}%` : "—", "text-white", "higher"],
                  [t("动量"), s => s.momentum?.toFixed(0) ?? "—", "text-white", "higher"],
                  ["RSI", s => s.rsi?.toFixed(0) ?? "—", "text-white", null],
                  [t("营收增长"), s => s.revenueGrowth ? `${s.revenueGrowth.toFixed(1)}%` : "—", "text-white", "higher"],
                  [t("利润率"), s => s.profitMargin ? `${s.profitMargin.toFixed(1)}%` : "—", "text-white", "higher"],
                ].map(([label, fn, klass, winnerDir]) => {
                  // 计算 winner idx（数值型才有，文字行 winnerDir=null 跳过）
                  let winnerIdx = -1;
                  if (winnerDir && stocks.length > 1) {
                    const raws = stocks.map(s => {
                      if (label === t("评分")) return s.score;
                      if (label === "PE") return s.pe;
                      if (label === "ROE") return s.roe;
                      if (label === t("动量")) return s.momentum;
                      if (label === t("营收增长")) return s.revenueGrowth;
                      if (label === t("利润率")) return s.profitMargin;
                      if (label === t("涨跌")) return safeChange(s.change);
                      return null;
                    });
                    let bestVal = winnerDir === "higher" ? -Infinity : Infinity;
                    raws.forEach((r, i) => {
                      if (r == null || !isFinite(r)) return;
                      if (winnerDir === "higher" && r > bestVal) { bestVal = r; winnerIdx = i; }
                      if (winnerDir === "lower" && r > 0 && r < bestVal) { bestVal = r; winnerIdx = i; }
                    });
                  }
                  return (
                    <tr key={label} className="group border-b border-white/5 last:border-0 hover:bg-white/[0.04] transition-colors">
                      <td className="py-1.5 pr-2 text-[#a0aec0] group-hover:text-white transition-colors sticky left-0 z-10 bg-[var(--bg-card)] group-hover:bg-[var(--bg-card-hover)]">{label}</td>
                      {stocks.map((s, idx) => {
                        const v = fn(s);
                        const c = typeof klass === "function" ? klass(s) : klass;
                        const isWinner = idx === winnerIdx;
                        return <td key={s.ticker} className={`py-1.5 px-2 ${c} ${isWinner ? 'bg-indigo-500/15 font-bold rounded' : ''}`}>{v}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};


const ScoringDashboard = () => {
  const { t, lang } = useLang();
  const [sel, setSel] = useState(null);
  // 详情区 scroll-spy：当前可见的 section（overview / fundamental / technical / liquidity / myposition）
  const [activeSection, setActiveSection] = useState("overview");
  // 来自 MacroDashboard alert 跳转的上下文 — 显示一个可关闭的横幅
  const [macroSignal, setMacroSignal] = useState(null);
  const [mkt, setMkt] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL"); // ALL | STOCK | ETF | LEV
  const [mktOpen, setMktOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const filterRef = useRef(null);
  useEffect(() => {
    if (!mktOpen && !typeOpen) return;
    const onDown = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) { setMktOpen(false); setTypeOpen(false); } };
    const onKey = (e) => { if (e.key === 'Escape') { setMktOpen(false); setTypeOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [mktOpen, typeOpen]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("score"); // score | change | name
  // A2/C16: 评分权重 — 按 workspace 隔离 + 工作区切换响应式
  const wsCtx = useWorkspace();
  const wsId = wsCtx?.activeId || 'default';
  const [weights, setWeights] = useState(() => loadWeights(wsId));
  const [showW, setShowW] = useState(false);
  const [weightToast, setWeightToast] = useState(null); // 应用权重后的反馈 { n, ws? }
  const skipNextSaveRef = useRef(false);  // 工作区切换重载时跳过一次回写
  // A2: weights 改动持久化到当前 workspace（切换重载触发的那次跳过）
  useEffect(() => {
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    try { localStorage.setItem(`quantedge_weights_${wsId}`, JSON.stringify(weights)); }
    catch { /* 私密模式可能 setItem 失败，忽略 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights]);
  const [chartRange, setChartRange] = useState("YTD"); // 1D|5D|1M|6M|YTD|1Y|5Y|ALL
  // 放大后的 K 线大图默认就是蜡烛；收起态的内联总览图永远只画面积线（见下方内联图）
  const [chartType, setChartType] = useState("candle"); // 'area' | 'candle'（仅作用于放大弹窗）
  // 默认点亮 MA20，复刻改造前桌面图的金色均线观感
  const [activeInd, setActiveInd] = useState(() => new Set(["ma20"]));
  const toggleInd = (key) => setActiveInd((prev) => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const [loading, setLoading] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false); // mobile: toggle list vs detail
  const isMobile = useIsMobile();
  const [mFilterOpen, setMFilterOpen] = useState(false); // v6 移动端筛选 sheet
  // 关注列表 — localStorage + 服务端(KV/后端)双写持久化
  // 服务端可读：GET /api/watchlist/favorites —— 让监控/AI/月度复盘脱离浏览器读到关注池
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quantedge_favorites') || '[]')); } catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const toggleFav = useCallback((ticker) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      try { localStorage.setItem('quantedge_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  // 服务端同步：整集 PUT（幂等）。失败时 apiFetch 返回 null，本地 localStorage 仍兜底。
  const favSyncReady = useRef(false);   // 首挂载拉取完成前不回写，避免本地覆盖服务端
  const favLastSynced = useRef(null);   // 去重：相同集合不重复 PUT
  const pushFavorites = useCallback((set) => {
    const arr = [...set].sort();
    const key = JSON.stringify(arr);
    if (key === favLastSynced.current) return;
    favLastSynced.current = key;
    apiFetch('/watchlist/favorites', { method: 'PUT', body: JSON.stringify({ tickers: arr }) });
  }, []);
  // 首挂载：服务端为权威。有数据→覆盖本地；服务端空且 KV 已启用→把本地星标种子上云。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await apiFetch('/watchlist/favorites');
      if (cancelled) return;
      if (resp && Array.isArray(resp.tickers)) {
        if (resp.tickers.length > 0) {
          const serverSet = new Set(resp.tickers);
          favLastSynced.current = JSON.stringify([...serverSet].sort());
          setFavorites(serverSet);
          try { localStorage.setItem('quantedge_favorites', JSON.stringify([...serverSet])); } catch {}
        } else if (resp.kv !== false) {
          let localArr = [];
          try { localArr = JSON.parse(localStorage.getItem('quantedge_favorites') || '[]'); } catch {}
          if (localArr.length > 0) pushFavorites(new Set(localArr));
        }
      }
      favSyncReady.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 变更时整集同步（跳过首挂载拉取完成前）
  useEffect(() => {
    if (!favSyncReady.current) return;
    pushFavorites(favorites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites]);
  // 视图模式 — 列表 / 板块聚合
  const [viewMode, setViewMode] = useState("list"); // "list" | "sector"
  // 卡片密度 — 标准 / 紧凑
  const [density, setDensity] = useState(() => localStorage.getItem("quantedge_density") || "standard"); // "standard" | "compact"
  useEffect(() => { localStorage.setItem("quantedge_density", density); }, [density]);
  // 详情面板左列卡片顺序 — 支持拖拽排序
  // PDF1 P0：归因卡（scoreBreakdown）默认置顶，雷达图作为可切换备选
  const DEFAULT_CARD_ORDER = ['scoreBreakdown', 'range52w', 'radar'];
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("quantedge_card_order") || 'null');
      if (Array.isArray(saved) && saved.length === DEFAULT_CARD_ORDER.length && DEFAULT_CARD_ORDER.every(k => saved.includes(k))) {
        // v0.7 一次性迁移：旧用户的 radar 若排在 scoreBreakdown 之前则交换（仅一次）
        const migrationFlag = localStorage.getItem("quantedge_card_order_v07_migrated");
        if (!migrationFlag) {
          try { localStorage.setItem("quantedge_card_order_v07_migrated", "1"); } catch {}
          const radarIdx = saved.indexOf('radar');
          const breakdownIdx = saved.indexOf('scoreBreakdown');
          if (radarIdx >= 0 && breakdownIdx >= 0 && radarIdx < breakdownIdx) {
            const next = [...saved];
            [next[radarIdx], next[breakdownIdx]] = [next[breakdownIdx], next[radarIdx]];
            return next;
          }
        }
        return saved;
      }
    } catch {}
    return DEFAULT_CARD_ORDER;
  });
  useEffect(() => { try { localStorage.setItem("quantedge_card_order", JSON.stringify(cardOrder)); } catch {} }, [cardOrder]);
  const [draggingCard, setDraggingCard] = useState(null);
  const handleCardDrop = useCallback((targetKey) => {
    setCardOrder(prev => {
      if (!draggingCard || draggingCard === targetKey) return prev;
      const next = prev.filter(k => k !== draggingCard);
      const targetIdx = next.indexOf(targetKey);
      next.splice(targetIdx, 0, draggingCard);
      return next;
    });
    setDraggingCard(null);
  }, [draggingCard]);
  const resetCardOrder = useCallback(() => setCardOrder(DEFAULT_CARD_ORDER), []);
  // 对比列表 — Set<ticker>，最多 4 只
  const [compareSet, setCompareSet] = useState(new Set());
  const [showCompare, setShowCompare] = useState(false);
  // v7: 评分页左右栏可折叠（桌面工作站，让中间详情让出更多空间；记忆到 localStorage）
  const [leftCollapsed, setLeftCollapsed] = useState(() => { try { return localStorage.getItem("quantedge_scoring_left_collapsed") === "1"; } catch { return false; } });
  // v7: 对比盘空态默认折叠（compareSet 挂载时恒为空 → 不浪费横向空间）；加标的时自动展开、清空时自动收起
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const setLeftPane = (v) => { setLeftCollapsed(v); try { localStorage.setItem("quantedge_scoring_left_collapsed", v ? "1" : "0"); } catch {} };
  const setRightPane = (v) => setRightCollapsed(v);
  // 对比盘随选择自动开合：加首个对比标的 → 展开；清空 → 收起。仅在 0↔≥1 边界触发，期间用户手动开合仍生效。
  const prevHadCompareRef = useRef(false);
  useEffect(() => {
    const has = compareSet.size > 0;
    if (has && !prevHadCompareRef.current) setRightCollapsed(false);
    else if (!has && prevHadCompareRef.current) setRightCollapsed(true);
    prevHadCompareRef.current = has;
  }, [compareSet]);
  const toggleCompare = useCallback((ticker) => {
    setCompareSet(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else if (next.size < 4) next.add(ticker);
      return next;
    });
  }, []);
  // Quick-add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [quickAddResults, setQuickAddResults] = useState([]);
  const [quickAddSearching, setQuickAddSearching] = useState(false);
  const [quickAdding, setQuickAdding] = useState(null); // ticker key being added
  const [earningsExpanded, setEarningsExpanded] = useState(false);
  // 图表基准叠加 + 全屏
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState([]);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [priceScale, setPriceScale] = useState("linear"); // 'linear' | 'log'（仅放大弹窗价格轴）
  const [hoverPoint, setHoverPoint] = useState(null);      // 放大图悬停数据点：常驻图例 + 十字光标（存 datum 避免 Brush 索引错位）
  const [brushRange, setBrushRange] = useState(null);      // {startIndex,endIndex}：滚轮缩放/拖拽平移窗口
  // PR2 画线/测量：drawTool 当前工具，drawings 已画图元，draftPoint 两点工具的第一点，cursorData 草稿预览第二点
  const [drawTool, setDrawTool] = useState("none");        // 'none' | 'trend' | 'hline' | 'measure'
  const [drawings, setDrawings] = useState([]);            // [{type,a:{m,price},b?,color}]
  const [draftPoint, setDraftPoint] = useState(null);      // {m,price} 等待第二点
  const [cursorData, setCursorData] = useState(null);      // {m,price} 草稿预览游标
  const chartGeomRef = useRef(null);                       // ScaleCapture 写入 {yScale,offset}，供 onClick 反推价格
  // PR2 指标自定义周期：在预设之外追加 {key,type,period,color,label} 实例（活跃指标 = 预设 + 自定义）
  const [customInds, setCustomInds] = useState([]);
  const [customType, setCustomType] = useState("sma");     // 自定义指标表单：均线类型
  const [customPeriod, setCustomPeriod] = useState("");    // 自定义指标表单：周期输入
  // 从收起态打开放大图：把不在放大集合里的区间归一到「日线」，让放大工具栏有高亮档
  const openFullscreen = useCallback(() => {
    setChartRange((r) => (MODAL_RANGES.includes(r) ? r : "1Y"));
    setChartFullscreen(true);
  }, []);
  // 市场指数 (SPX / NDX / HSI / VIX)
  const [indices, setIndices] = useState([]); // [{ sym, close, pct }]
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [indicesTime, setIndicesTime] = useState(null);
  // 市场状态每 30s tick 一次
  const [marketTick, setMarketTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setMarketTick(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);
  const marketStatus = useMemo(() => {
    const ms = getMarketsStatus(new Date(marketTick));
    if (ms.usOpen) return { key: '美股开盘中', dot: 'bg-up animate-pulse' };
    if (ms.hkOpen) return { key: '港股开盘中', dot: 'bg-up animate-pulse' };
    if (ms.cnOpen) return { key: 'A股开盘中', dot: 'bg-up animate-pulse' };
    if (ms.krOpen) return { key: '韩股开盘中', dot: 'bg-up animate-pulse' };
    if (ms.usPre)  return { key: '美股盘前', dot: 'bg-amber-400' };
    if (ms.usPost) return { key: '美股盘后', dot: 'bg-amber-400' };
    return { key: '全部市场休市', dot: 'bg-white/30' };
  }, [marketTick]);
  const fetchIndices = useCallback(async () => {
    setIndicesLoading(true);
    const defs = [
      { sym: "SPX", yf: "^GSPC" },
      { sym: "NDX", yf: "^NDX" },
      { sym: "HSI", yf: "^HSI" },
      { sym: "VIX", yf: "^VIX" },
    ];
    try {
      const results = await Promise.allSettled(defs.map(d => fetchRangePrices(d.yf, "5D")));
      const next = defs.map((d, i) => {
        const r = results[i];
        if (r.status !== "fulfilled" || !r.value || r.value.length < 2) return { ...d, close: null, pct: null };
        const pts = r.value;
        const close = pts[pts.length - 1].p;
        const prev = pts[pts.length - 2].p;
        const pct = prev ? ((close - prev) / prev) * 100 : 0;
        return { ...d, close, pct: +pct.toFixed(2) };
      });
      setIndices(next);
      setIndicesTime(Date.now());
    } catch { /* 静默失败 */ }
    setIndicesLoading(false);
  }, []);
  useEffect(() => {
    fetchIndices();
    const iv = setInterval(fetchIndices, 60_000);
    return () => clearInterval(iv);
  }, [fetchIndices]);
  const { stocks: ctxStocks, setStocks: ctxSetStocks, addTicker, removeTicker, apiOnline, standalone, quickPriceRefresh } = useData() || {};

  // P3 双轨：综合分 = 质量分 × wQ + 时机分 × wT。个股与 ETF 都有 qualityScore/timingScore，
  // 故统一重算（不再像旧三轴那样把 ETF 排除）。返回变更标的数。
  const applyWeights = useCallback((w) => {
    const tw = (w?.quality || 0) + (w?.timing || 0);
    if (tw === 0 || !ctxSetStocks) return 0;
    const wq = w.quality / tw, wt = w.timing / tw;
    let n = 0;
    ctxSetStocks(prev => {
      // 体检修复：合成前把两轨各自横截面标准化到同方差(与后端 scoring.py 一致)。
      // 否则时机分离散度≈2×质量，会主导排序、令 0.6 质量权重名不副实。qualityScore/timingScore 显示值不变。
      const ms = (arr) => { const a = arr.filter(v => v != null); if (!a.length) return [50, 1]; const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); return [m, sd > 1e-9 ? sd : 1]; };
      const [mq, sq] = ms(prev.map(s => s.qualityScore));
      const [mt, st] = ms(prev.map(s => s.timingScore));
      let changed = false;
      const next = prev.map(s => {
        if (s.qualityScore == null || s.timingScore == null) return s;
        const qz = (s.qualityScore - mq) / sq, tz = (s.timingScore - mt) / st;
        const newScore = Math.round(Math.max(0, Math.min(100, 50 + 20 * (qz * wq + tz * wt))) * 10) / 10;
        if (newScore === s.score) return s;
        changed = true; n++;
        return { ...s, score: newScore };
      });
      return changed ? next : prev;   // 无变化返回原引用，避免无谓 re-render 循环
    });
    return n;
  }, [ctxSetStocks]);

  // C16: 工作区切换 → 重载该工作区权重 + 自动重新评分（首次挂载跳过，useState 已加载）
  const wsMountedRef = useRef(false);
  useEffect(() => {
    if (!wsMountedRef.current) { wsMountedRef.current = true; return; }
    const w = loadWeights(wsId);
    const wsName = wsCtx?.active?.name;
    skipNextSaveRef.current = true;   // 切换重载不触发回写
    setWeights(w);
    const n = applyWeights(w);
    setWeightToast({ n, ws: wsName });
    setTimeout(() => setWeightToast(cur => (cur && cur.ws === wsName ? null : cur)), 3200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // 体检修复：挂载/数据刷新后用当前权重重算一次综合分（两轨等方差标准化），
  // 让现有 data.js 的旧 score 立即标准化、不必等后端数据重生。applyWeights 无变化时返回原引用，幂等防循环。
  useEffect(() => {
    if (ctxStocks && ctxStocks.length && ctxStocks.some(s => s.qualityScore != null)) applyWeights(weights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxStocks]);

  // F3 移动端 pull-to-refresh — 列表容器顶部下拉超过 60px 触发刷新
  const [pullDist, setPullDist] = useState(0);
  const pullRef = useRef({ startY: 0, active: false, container: null });
  const onListTouchStart = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollTop > 4) return;  // 仅当滚到顶才允许下拉
    pullRef.current = { startY: e.touches[0].clientY, active: true, container: el };
  }, []);
  const onListTouchMove = useCallback((e) => {
    if (!pullRef.current.active) return;
    const dy = e.touches[0].clientY - pullRef.current.startY;
    if (dy > 0) setPullDist(Math.min(dy * 0.5, 70));
  }, []);
  const onListTouchEnd = useCallback(async () => {
    if (!pullRef.current.active) return;
    pullRef.current.active = false;
    if (pullDist > 50 && quickPriceRefresh) {
      try { await quickPriceRefresh(); } catch {}
    }
    setPullDist(0);
  }, [pullDist, quickPriceRefresh]);
  // 使用 context 中的 stocks（响应式），而非模块级 STOCKS（可能过时）
  const liveStocks = ctxStocks || STOCKS;
  // 保持 sel 与 liveStocks 同步：初始化 + 数据更新时刷新 sel 对象
  useEffect(() => {
    if (!liveStocks || liveStocks.length === 0) return;
    if (!sel) {
      setSel(liveStocks[0]);
    } else {
      // 当 stocks 数据更新时（如 priceRanges 变化），用最新对象替换 sel
      const fresh = liveStocks.find(s => s.ticker === sel.ticker);
      if (fresh && fresh !== sel) setSel(fresh);
    }
  }, [liveStocks]);

  // 按需加载图表数据：选中股票或切换 chartRange 时，缺失对应维度则拉取
  useEffect(() => {
    if (!sel || !sel.ticker) return;
    const cur = sel.priceRanges && sel.priceRanges[chartRange];
    const hasCurRange = cur && cur.length >= 2;
    // 候选股初始 bundled 数据只含收盘价；放大全屏开 K 线时才重拉一次带 OHLC+成交量的数据（桌面模态 + 移动端横屏全屏共用）
    const rangeHasOHLC = hasCurRange && cur.some(d => d.h != null && d.l != null && d.h > d.l);
    const needOHLCUpgrade = chartFullscreen && chartType === "candle" && hasCurRange && !rangeHasOHLC;
    if (hasCurRange && !needOHLCUpgrade) return;
    let cancelled = false;
    (async () => {
      try {
        let yfSym = sel.ticker;
        if (sel.ticker.endsWith(".HK")) {
          yfSym = sel.ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
        }
        // 首次加载（完全无数据）→ 并行拉常用 4 档；否则仅拉当前缺的维度
        const hasAny = sel.priceRanges && Object.keys(sel.priceRanges).length > 0;
        const toFetch = hasAny ? [chartRange] : ["1M", "6M", "YTD", "1Y", chartRange];
        // 去重（首次加载可能已含 chartRange）
        const uniq = [...new Set(toFetch)];
        const results = await Promise.allSettled(uniq.map(r => fetchRangePrices(yfSym, r)));
        if (cancelled) return;
        const ranges = {};
        uniq.forEach((r, i) => {
          if (results[i].status === "fulfilled" && results[i].value?.length) ranges[r] = results[i].value;
        });
        if (Object.keys(ranges).length === 0) return;
        // 更新 sel 和 liveStocks 中对应的股票（priceHistory 始终保 1Y 作为降级兜底）
        const nextHistory = ranges["1Y"] || sel.priceHistory;
        if (ctxSetStocks) {
          ctxSetStocks(prev => prev.map(s => s.ticker === sel.ticker ? { ...s, priceRanges: { ...(s.priceRanges || {}), ...ranges }, priceHistory: nextHistory } : s));
        }
        setSel(s => s && s.ticker === sel.ticker ? { ...s, priceRanges: { ...(s.priceRanges || {}), ...ranges }, priceHistory: nextHistory } : s);
        // 触发 resize 强制 Recharts ResponsiveContainer 重新测量尺寸
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
          });
        });
      } catch { /* 静默失败 */ }
    })();
    return () => { cancelled = true; };
  }, [sel?.ticker, chartRange, chartType, chartFullscreen, isMobile]);

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, ticker, name }
  const ctxMenuRef = useCallback(node => { /* ref only for positioning */ }, []);
  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e) => {
      // Don't close if clicking inside the context menu itself
      const menu = document.getElementById("ctx-menu");
      if (menu && menu.contains(e.target)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);
  useEffect(() => { setCtxMenu(null); }, [sel?.ticker]);

  // 外部触发选中（命令面板）
  useEffect(() => {
    const handler = (e) => {
      const want = e.detail?.ticker;
      if (!want) return;
      const stk = liveStocks.find(s => s.ticker === want);
      if (stk) { setSel(stk); setMobileShowDetail(true); }
    };
    window.addEventListener("quantedge:selectStock", handler);
    return () => window.removeEventListener("quantedge:selectStock", handler);
  }, [liveStocks]);

  // J/K 全局键盘上下导航 — 用 ref 持有最新 filtered/sel，避免重注册
  const navRefs = useRef({ filtered: [], sel: null });
  useEffect(() => {
    const handler = (e) => {
      const dir = e.detail;
      const list = navRefs.current.filtered;
      const cur = navRefs.current.sel;
      if (!list || list.length === 0) return;
      const curIdx = cur ? list.findIndex(s => s.ticker === cur.ticker) : -1;
      const nextIdx = dir === "next"
        ? (curIdx + 1) % list.length
        : (curIdx - 1 + list.length) % list.length;
      const next = list[nextIdx];
      if (next) { setSel(next); setMobileShowDetail(true); }
    };
    window.addEventListener("quantedge:navStock", handler);
    return () => window.removeEventListener("quantedge:navStock", handler);
  }, []);

  // v7 工作站：W / C 键盘动作 — 对当前选中标的 加自选 / 加对比
  // （由全局键盘 handler 派发事件；非评分页无监听器 → 无副作用）
  useEffect(() => {
    const onAction = (e) => {
      const cur = navRefs.current.sel;
      if (!cur) return;
      if (e.detail === "fav") toggleFav(cur.ticker);
      else if (e.detail === "compare") toggleCompare(cur.ticker);
    };
    window.addEventListener("quantedge:stockAction", onAction);
    return () => window.removeEventListener("quantedge:stockAction", onAction);
  }, [toggleFav, toggleCompare]);

  // 详情区 scroll-spy：IntersectionObserver 跟踪 #detail-* sections，更新 activeSection
  useEffect(() => {
    if (!sel) return;
    const ids = ["overview", "fundamental", "technical", "liquidity", "myposition"];
    const nodes = ids.map(id => document.getElementById(`detail-${id}`)).filter(Boolean);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // 取交集度最大的 entry 作为 active
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = visible[0].target.id.replace("detail-", "");
          setActiveSection(id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.1, 0.5] }
    );
    nodes.forEach(n => observer.observe(n));
    return () => observer.disconnect();
  }, [sel]);

  // 来自 macro alert 的跨 tab 跳转 → 显示一个临时横幅，提示用户当前查看持仓的宏观背景
  useEffect(() => {
    const onSignal = (e) => {
      const sig = e.detail;
      if (sig && typeof sig === "object") setMacroSignal(sig);
    };
    window.addEventListener("quantedge:macroSignal", onSignal);
    return () => window.removeEventListener("quantedge:macroSignal", onSignal);
  }, []);
  const handleContextMenu = (e, stk) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, ticker: stk.ticker, name: stk.name });
  };

  // v7 工作站：hover peek — 停留 ~280ms 浮出迷你卡（分项评分 + 走势 + W/C 提示）
  // 仅支持 hover 的设备（桌面）；选中行不浮（与详情区重复）。
  const [peek, setPeek] = useState(null); // { ticker, x, y }
  const peekTimerRef = useRef(null);
  const canHover = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches, []);
  const schedulePeek = useCallback((e, stk) => {
    if (!canHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => {
      const W = 248, H = 210, pad = 8;
      let x = rect.right + pad;
      if (x + W > window.innerWidth) x = rect.left - W - pad; // 右侧放不下→放左侧
      if (x < pad) x = pad;
      let y = rect.top;
      if (y + H > window.innerHeight) y = window.innerHeight - H - pad;
      if (y < pad) y = pad;
      setPeek({ ticker: stk.ticker, x, y });
    }, 280);
  }, [canHover]);
  const cancelPeek = useCallback(() => { clearTimeout(peekTimerRef.current); setPeek(null); }, []);
  useEffect(() => () => clearTimeout(peekTimerRef.current), []);
  const handleDeleteTicker = async () => {
    if (!ctxMenu) return;
    const key = ctxMenu.ticker;
    const name = ctxMenu.name;
    setCtxMenu(null);
    if (removeTicker) {
      const res = await removeTicker(key);
      if (res?.success) {
        // If we deleted the currently selected stock, switch to first available
        if (sel?.ticker === key) {
          setTimeout(() => { if (liveStocks.length > 0) setSel(liveStocks[0]); }, 50);
        }
      }
    }
  };

  // Skeleton on ticker change
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 180);
    return () => clearTimeout(t);
  }, [sel?.ticker]);

  // 根据选择的时间维度获取图表数据（含收益率百分比）
  const chartData = useMemo(() => {
    if (!sel) return [];
    // 优先使用 priceRanges 中对应维度的数据；若为空数组（新上市标的等）则降级到 priceHistory
    const candidate = sel.priceRanges?.[chartRange];
    const rawAll = (Array.isArray(candidate) && candidate.length > 0)
      ? candidate
      : (sel.priceHistory || []);
    // Filter out null/0/negative prices (sanitized NaN + dividend-adjusted 异常)
    // 例: yfinance 韩股 SK 海力士 25Y ALL 调整后 close 可能出现负值，导致 basePrice
    // 算反 + 区间收益变成 -647% 之类的不可能值。
    const raw = rawAll.filter(d => d.p != null && d.p > 0);
    if (raw.length === 0) return [];
    const basePrice = raw[0].p;
    if (basePrice <= 0) return [];   // 防御性二次校验
    return raw.map(d => ({
      ...d,
      pct: +((d.p - basePrice) / basePrice * 100).toFixed(2),
    }));
  }, [sel, chartRange]);

  // 区间收益率
  const periodReturn = useMemo(() => {
    if (chartData.length < 2) return null;
    return chartData[chartData.length - 1].pct;
  }, [chartData]);

  // ESC 键关闭图表全屏
  useEffect(() => {
    if (!chartFullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setChartFullscreen(false); };
    window.addEventListener("keydown", onKey);
    // 锁背景滚动：放大图用滚轮缩放，避免滚轮穿透滚动页面（也省去 preventDefault 的 passive 警告）
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [chartFullscreen]);

  // 周期/标的切换 → 重置缩放/悬停/草稿，并载入画线：
  //   趋势线/测量 取 (标的,周期) 桶；水平线取按标的的共享桶（跨周期通用）。
  //   兼容旧版：旧水平线曾混存进周期桶 → 一并读入并按 price 去重（下次回存会迁移到共享桶）。
  useEffect(() => {
    setBrushRange(null); setHoverPoint(null); setDraftPoint(null); setCursorData(null);
    let merged = [];
    if (sel?.ticker) {
      try {
        const rawP = localStorage.getItem(drawingsKey(sel.ticker, chartRange));
        const perPeriod = rawP ? JSON.parse(rawP) : [];
        const others = Array.isArray(perPeriod) ? perPeriod.filter((d) => d.type !== "hline") : [];
        const legacyH = Array.isArray(perPeriod) ? perPeriod.filter((d) => d.type === "hline") : [];
        const rawH = localStorage.getItem(hlinesKey(sel.ticker));
        const sharedH = rawH ? JSON.parse(rawH) : [];
        const seen = new Set();
        const hlines = [...(Array.isArray(sharedH) ? sharedH : []), ...legacyH]
          .filter((d) => { const p = d?.a?.price; if (p == null || seen.has(p)) return false; seen.add(p); return true; });
        merged = [...others, ...hlines];
      } catch { merged = []; }
    }
    setDrawings(merged);
  }, [sel?.ticker, chartRange]);

  // 画线变化 → 回存到当前 (标的,周期)。仅依赖 drawings：切标的时本副作用不触发（drawings 尚未变），
  // 待载入把 drawings 改为新桶内容后才存，此时 sel.ticker/chartRange 已是新值，key 正确，无错存。
  useEffect(() => {
    if (!sel?.ticker) return;
    // 拆分回存：水平线 → 按标的共享桶（跨周期）；趋势线/测量 → (标的,周期) 桶。
    const hlines = drawings.filter((d) => d.type === "hline");
    const others = drawings.filter((d) => d.type !== "hline");
    const pKey = drawingsKey(sel.ticker, chartRange);
    const hKey = hlinesKey(sel.ticker);
    try {
      if (others.length) localStorage.setItem(pKey, JSON.stringify(others)); else localStorage.removeItem(pKey);
      if (hlines.length) localStorage.setItem(hKey, JSON.stringify(hlines)); else localStorage.removeItem(hKey);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings]);

  // 画线快捷键：Esc 取消当前草稿（捕获阶段优先于 PR1 的 ESC 关闭）；Del/Backspace 删最后一条
  useEffect(() => {
    if (!chartFullscreen) return;
    const onKey = (e) => {
      if (e.key === "Escape" && draftPoint) { e.stopPropagation(); setDraftPoint(null); setCursorData(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && drawings.length) { setDrawings((d) => d.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chartFullscreen, draftPoint, drawings.length]);

  // 基准指数数据加载（开启时拉取对应市场基准）
  useEffect(() => {
    if (!showBenchmark || !sel) { setBenchmarkData([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const benchSym = sel.market === "HK" ? "^HSI" : "^GSPC";
        const raw = await fetchRangePrices(benchSym, chartRange);
        if (cancelled || !raw || raw.length < 2) return;
        const base = raw[0].p;
        setBenchmarkData(raw.map(d => ({ m: d.m, bpct: +((d.p - base) / base * 100).toFixed(2) })));
      } catch { /* 静默失败 */ }
    })();
    return () => { cancelled = true; };
  }, [showBenchmark, sel?.ticker, sel?.market, chartRange]);

  // 合并基准 + MA20 趋势均线到图表数据
  // MA20 = 20 个收盘价的简单移动平均。只有「日线级别」区间（interval=1d，即
  // 1M/6M/YTD/1Y）才是货真价实的「20 个交易日」；1D/5D 是分时、5Y 是周线、ALL
  // 是月线，画 20 点均线会把单位偷换成「20 根分时/20 周/20 月」——所以那些区间不画，
  // 避免误导。1M 只有 ~21 个交易日、MA20 几乎只剩 1 个有效点，也一并跳过（要求 ≥30 点）。
  const chartDataWithBench = useMemo(() => {
    let base = chartData;
    if (showBenchmark && benchmarkData.length > 0) {
      const benchMap = new Map(benchmarkData.map(b => [b.m, b.bpct]));
      base = base.map(d => ({ ...d, bpct: benchMap.get(d.m) ?? null }));
    }
    if (MA_RANGES.has(chartRange) && base.length >= 30) {
      const W = 20;
      base = base.map((d, i) => {
        if (i < W - 1) return d;
        let sum = 0;
        for (let k = i - W + 1; k <= i; k++) sum += base[k].p;
        return { ...d, ma20: +(sum / W).toFixed(2) };
      });
    }
    return base;
  }, [chartData, benchmarkData, showBenchmark, chartRange]);

  // MA20 信号：现价 vs 均线 → 趋势加仓位 / 均线下方观望
  const maSignal = useMemo(() => {
    if (!MA_RANGES.has(chartRange)) return null;
    const withMa = chartDataWithBench.filter(d => d.ma20 != null);
    if (withMa.length === 0) return null;
    const last = withMa[withMa.length - 1];
    if (!(last.p > 0) || !(last.ma20 > 0)) return null;
    const above = last.p >= last.ma20;
    const gap = ((last.p - last.ma20) / last.ma20) * 100;
    return { above, gap, ma: last.ma20, px: last.p };
  }, [chartDataWithBench, chartRange]);

  // 当前点亮的指标（按注册表顺序，稳定）
  const activeIndList = useMemo(
    () => [...INDICATORS.filter((i) => activeInd.has(i.key)), ...customInds],
    [activeInd, customInds]
  );

  // 桌面图最终数据：在 chartDataWithBench 基础上补 OHLC（hl 供蜡烛 Bar 定位）
  // 并叠加用户点亮的 MA/EMA 序列。移动端图表仍直接用 chartDataWithBench，互不影响。
  const chartSeries = useMemo(() => {
    let base = chartDataWithBench.map((d, i, arr) => {
      const o = d.o ?? d.p, h = d.h ?? d.p, l = d.l ?? d.p;
      // hl 夹住 o/h/l/收，保证影线与实体都落在 Bar 的 y 区间内
      const lo = Math.min(l, o, h, d.p), hi = Math.max(l, o, h, d.p);
      // 当根涨跌幅 = 相对上一根收盘（日线即「当日涨跌」）
      const prevC = i > 0 ? arr[i - 1].p : null;
      const chg = (prevC > 0 && d.p > 0) ? +(((d.p - prevC) / prevC) * 100).toFixed(2) : null;
      return { ...d, o, h, l, hl: [lo, hi], chg };
    });
    for (const ind of activeIndList) {
      if (ind.type === "boll") base = withBOLL(base, ind.period, ind.mult);
      else if (ind.type === "ema") base = withEMA(base, ind.period, ind.key);
      else base = withSMA(base, ind.period, ind.key);
    }
    return base;
  }, [chartDataWithBench, activeIndList]);

  // 当前区间是否真的拿到了 OHLC（旧缓存可能只有收盘价）→ 没有就别假装画 K 线
  const hasOHLC = useMemo(
    () => chartSeries.some((d) => d.h > d.l),
    [chartSeries]
  );
  const showCandle = chartType === "candle" && hasOHLC;

  // 放大弹窗专用：成交量副图 + 价格/百分比轴「上压」到顶部 ~62%，给底部成交量柱腾位置。
  // 单图实现 K 线平台：价格轴留底、成交量轴压顶，两者在同一 ComposedChart 里叠放不打架。
  const volMax = useMemo(
    () => chartSeries.reduce((m, d) => Math.max(m, d.v || 0), 0),
    [chartSeries]
  );
  const hasVolume = volMax > 0;
  // 价格轴上压域：数据落在顶部 ~62%，底部 ~34% 留给成交量
  const priceDomainTop = useMemo(() => {
    const lows = [], highs = [];
    for (const d of chartSeries) {
      const l = d.l ?? d.p, h = d.h ?? d.p;
      if (l > 0) lows.push(l);
      if (h > 0) highs.push(h);
    }
    if (!lows.length) return ["auto", "auto"];
    const lo = Math.min(...lows), hi = Math.max(...highs), span = hi - lo || hi * 0.1 || 1;
    return [Math.max(0, lo - span * 0.55), hi + span * 0.05];
  }, [chartSeries]);
  // 百分比轴（基准对比线）同样上压，保证与价格在同一顶部区域对齐
  const pctDomainTop = useMemo(() => {
    const arr = [];
    for (const d of chartSeries) {
      if (d.pct != null) arr.push(d.pct);
      if (d.bpct != null) arr.push(d.bpct);
    }
    if (!arr.length) return ["auto", "auto"];
    const lo = Math.min(...arr), hi = Math.max(...arr), span = hi - lo || 1;
    return [lo - span * 0.55, hi + span * 0.05];
  }, [chartSeries]);
  // 上压域会让 recharts 把刻度算到真实区间外（如 $17 而股价没到过）。
  // 显式只在「真实价格/百分比区间」打漂亮刻度，底部留白区不打刻度。
  const priceTicks = useMemo(() => {
    if (!hasVolume) return undefined;
    let lo = Infinity, hi = -Infinity;
    for (const d of chartSeries) {
      const l = d.l ?? d.p, h = d.h ?? d.p;
      if (l > 0) lo = Math.min(lo, l);
      if (h > 0) hi = Math.max(hi, h);
    }
    return isFinite(lo) && isFinite(hi) ? niceTicks(lo, hi, 5) : undefined;
  }, [chartSeries, hasVolume]);
  const pctTicks = useMemo(() => {
    if (!hasVolume) return undefined;
    let lo = Infinity, hi = -Infinity;
    for (const d of chartSeries) {
      if (d.pct != null) { lo = Math.min(lo, d.pct); hi = Math.max(hi, d.pct); }
      if (d.bpct != null) { lo = Math.min(lo, d.bpct); hi = Math.max(hi, d.bpct); }
    }
    return isFinite(lo) && isFinite(hi) ? niceTicks(lo, hi, 5) : undefined;
  }, [chartSeries, hasVolume]);
  // 对数轴域：正数域，并在 log 空间把最低价钉到 ~34% 高度处，给底部成交量留位
  const priceDomainLog = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of chartSeries) {
      const l = d.l ?? d.p, h = d.h ?? d.p;
      if (l > 0) lo = Math.min(lo, l);
      if (h > 0) hi = Math.max(hi, h);
    }
    if (!isFinite(lo) || !isFinite(hi) || lo <= 0) return ["auto", "auto"];
    const d1 = hi * 1.03, frac = hasVolume ? 0.34 : 0.02;
    const Ld0 = (Math.log10(lo) - frac * Math.log10(d1)) / (1 - frac);
    return [Math.pow(10, Ld0), d1];
  }, [chartSeries, hasVolume]);
  const priceTicksLog = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of chartSeries) {
      const l = d.l ?? d.p, h = d.h ?? d.p;
      if (l > 0) lo = Math.min(lo, l);
      if (h > 0) hi = Math.max(hi, h);
    }
    return isFinite(lo) && isFinite(hi) ? niceLogTicks(lo, hi) : undefined;
  }, [chartSeries]);
  const isLogScale = priceScale === "log";
  const priceDomainFinal = isLogScale ? priceDomainLog : (hasVolume ? priceDomainTop : ["auto", "auto"]);
  const priceTicksFinal = isLogScale ? priceTicksLog : priceTicks;
  // 最新价（A2 标线 + 常驻图例默认点）；priceAxisFmt 供价格轴/光标药丸/标线共用
  const lastPoint = chartSeries.length ? chartSeries[chartSeries.length - 1] : null;
  const lastClose = lastPoint && lastPoint.p > 0 ? lastPoint.p : null;
  const lastUp = lastPoint ? (lastPoint.chg != null ? lastPoint.chg >= 0 : (lastPoint.o != null ? lastPoint.p >= lastPoint.o : true)) : true;
  const priceAxisFmt = (v) => (sel && (sel.currency === "KRW" || sel.currency === "JPY"))
    ? Math.round(v).toLocaleString()
    : (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // PR2 画线：放置一个点（hline 一点成线；trend/measure 两点成段）
  const placePoint = (pt) => {
    if (!pt || !(pt.price >= 0)) return;
    if (drawTool === "hline") { setDrawings((ds) => [...ds, { type: "hline", a: { price: pt.price }, color: "#60a5fa" }]); return; }
    if (drawTool === "trend" || drawTool === "measure") {
      if (!draftPoint) setDraftPoint(pt);
      else {
        const type = drawTool === "measure" ? "measure" : "trend";
        setDrawings((ds) => [...ds, { type, a: draftPoint, b: pt, color: type === "measure" ? "#f59e0b" : "#e5e7eb" }]);
        setDraftPoint(null); setCursorData(null);
      }
    }
  };
  const indexOfLabel = useCallback((m) => chartSeries.findIndex((d) => d.m === m), [chartSeries]);
  // 移除指标：预设走 toggleInd，自定义从 customInds 删
  const removeInd = (ind) => {
    if (activeInd.has(ind.key)) toggleInd(ind.key);
    else setCustomInds((cs) => cs.filter((c) => c.key !== ind.key));
  };
  // 添加自定义均线：type='sma'|'ema'，period 2..400 整数，去重（含预设）
  const CUSTOM_COLORS = ["#fb923c", "#4ade80", "#f0abfc", "#38bdf8", "#fbbf24", "#a78bfa"];
  const addCustomInd = (type, period) => {
    const p = Math.round(Number(period));
    if (!(p >= 2 && p <= 400)) return;
    const key = `c${type}${p}`;
    if (INDICATORS.some((i) => i.key === key) || customInds.some((c) => c.key === key)) return;
    setCustomInds((cs) => [...cs, { key, type, period: p, color: CUSTOM_COLORS[cs.length % CUSTOM_COLORS.length], label: `${type === "ema" ? "EMA" : "MA"}${p}` }]);
  };

  // 自己测量图表容器尺寸，避免 ResponsiveContainer 在 StrictMode 下的初次挂载 bug
  const [chartContainerRef, chartSize] = useContainerSize();

  const benchmarkLabel = sel?.market === "HK" ? "HSI" : "SPX";

  const filtered = useMemo(() => {
    let list = liveStocks;
    // 市场筛选
    if (mkt !== "ALL") list = list.filter(s => s.market === mkt);
    // 类型筛选
    if (typeFilter === "STOCK") list = list.filter(s => !s.isETF);
    else if (typeFilter === "ETF") list = list.filter(s => s.isETF && !s.leverage);
    else if (typeFilter === "LEV") list = list.filter(s => s.isETF && s.leverage);
    // 关注列表筛选
    if (showFavOnly) list = list.filter(s => favorites.has(s.ticker));
    // 搜索
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(s =>
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (STOCK_CN_NAMES[s.ticker] && STOCK_CN_NAMES[s.ticker].includes(q)) ||
        (s.sector && s.sector.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    }
    // 排序
    if (sortBy === "score") return [...list].sort((a, b) => b.score - a.score);
    if (sortBy === "change") return [...list].sort((a, b) => b.change - a.change);
    if (sortBy === "name") return [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
    if (sortBy === "macroAdj") {
      const temp = macroSnapshot?.composite?.market_temperature;
      // 用 macroAdjustedScore（base + Δ）排；无 sub-scores 的（ETF）回退到 base score
      return [...list].sort((a, b) =>
        (macroAdjustedScore(b, temp) ?? b.score ?? 0) -
        (macroAdjustedScore(a, temp) ?? a.score ?? 0)
      );
    }
    return [...list].sort((a, b) => b.score - a.score);
  }, [liveStocks, mkt, typeFilter, searchTerm, sortBy, showFavOnly, favorites]);

  // J/K 导航 ref 同步（filtered/sel 变化时更新最新引用）
  navRefs.current.filtered = filtered;
  navRefs.current.sel = sel;

  // 板块聚合 — 基于 filtered 结果
  const sectorGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(s => {
      const sec = s.sector || "其他";
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(s);
    });
    return Object.entries(groups).map(([name, stocks]) => ({
      name,
      stocks,
      count: stocks.length,
      avgScore: stocks.reduce((a, s) => a + (s.score || 0), 0) / stocks.length,
      avgChange: stocks.reduce((a, s) => a + safeChange(s.change), 0) / stocks.length,
      top: [...stocks].sort((a, b) => b.score - a.score).slice(0, 3),
    })).sort((a, b) => b.avgScore - a.avgScore);
  }, [filtered]);

  // 统计 — 根据市场筛选动态计算
  const counts = useMemo(() => {
    const base = mkt === "ALL" ? liveStocks : liveStocks.filter(s => s.market === mkt);
    return {
      all: base.length,
      stocks: base.filter(s => !s.isETF).length,
      etfs: base.filter(s => s.isETF && !s.leverage).length,
      lev: base.filter(s => s.isETF && s.leverage).length,
    };
  }, [liveStocks, mkt]);

  // 行业中位数 — 用于"vs 行业中位"对比
  const sectorMedians = useMemo(() => {
    if (!sel) return null;
    const median = (arr) => {
      const a = arr.filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y);
      if (a.length === 0) return null;
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const peers = liveStocks.filter(s => s.sector === sel.sector && s.isETF === sel.isETF && s.ticker !== sel.ticker);
    if (peers.length === 0) return null;
    // v5.3：最佳同行（同业评分最高者）— 给三要素卡一个具体参照锚点（"对比 AVGO 74.9"）
    const best = peers.reduce((b, s) => (s.score != null && Number.isFinite(s.score) && (b == null || s.score > b.score)) ? s : b, null);
    const topPeer = best ? { ticker: best.ticker, score: best.score } : null;
    // P3 双轨：同行中位覆盖 质量/时机 综合 + 各 6 维（个股/ETF 自适应键集）
    const subKeys = [...qualityKeys(sel.isETF), ...TIMING_KEYS];
    const med = {
      score: median(peers.map(s => s.score)),    // PDF1 评分锚点：详情头部 vs 行业中位
      quality: median(peers.map(s => s.qualityScore)),
      timing: median(peers.map(s => s.timingScore)),
      peerCount: peers.length,
      topPeer,
    };
    for (const k of subKeys) med[k] = median(peers.map(s => s.subScores?.[k]));
    return med;
  }, [sel, liveStocks]);

  const radar = sel ? (sel.isETF ? [
    { factor: t("费率优势"), value: sel.expenseRatio <= 0.5 ? 90 : sel.expenseRatio <= 1 ? 70 : sel.expenseRatio <= 2 ? 40 : 20, fullMark: 100 },
    sel.leverage
      ? { factor: t("波动磨损"), value: sel.decayRate == null ? 50 : sel.decayRate < 5 ? 90 : sel.decayRate < 15 ? 60 : sel.decayRate < 30 ? 35 : 15, fullMark: 100 }
      : { factor: t("折溢价"), value: Math.abs(sel.premiumDiscount || 0) < 1 ? 95 : Math.abs(sel.premiumDiscount || 0) < 5 ? 70 : Math.abs(sel.premiumDiscount || 0) < 10 ? 40 : 20, fullMark: 100 },
    { factor: t("规模(AUM)"), value: parseFloat(sel.aum) > 1000 ? 90 : parseFloat(sel.aum) > 100 ? 60 : 30, fullMark: 100 },
    { factor: t("动量"), value: sel.momentum, fullMark: 100 },
    { factor: t("流动性"), value: sel.adv && sel.adv !== "N/A" ? 70 : 40, fullMark: 100 },
    { factor: t("集中度风险"), value: sel.concentrationTop3 > 70 ? 25 : sel.concentrationTop3 > 50 ? 50 : 80, fullMark: 100 },
  ] : [
    { factor: t("PE估值"), value: sel.pe && sel.pe > 0 ? Math.max(0, 100 - sel.pe * 0.8) : 20, fullMark: 100 },
    { factor: "ROE", value: sel.roe ? Math.min(100, Math.max(0, sel.roe * 0.8)) : 10, fullMark: 100 },
    { factor: t("动量"), value: sel.momentum, fullMark: 100 },
    { factor: "RSI", value: sel.rsi, fullMark: 100 },
    { factor: t("营收增长"), value: sel.revenueGrowth ? Math.min(100, sel.revenueGrowth * 0.6) : 0, fullMark: 100 },
    { factor: t("利润率"), value: sel.profitMargin ? Math.min(100, Math.max(0, sel.profitMargin * 1.5)) : 0, fullMark: 100 },
  ]) : [];

  // Quick-add search
  const quickAddSearch = useCallback(async (q) => {
    if (!q.trim()) { setQuickAddResults([]); return; }
    setQuickAddSearching(true);
    try {
      const existing = new Set(liveStocks.map(s => s.ticker));
      if (standalone) {
        // 独立模式：前端直接搜索 Yahoo Finance
        const results = await standaloneSearch(q.trim());
        setQuickAddResults(results.map(r => ({
          ...r,
          alreadyAdded: existing.has(r.symbol),
        })).slice(0, 6));
      } else {
        const res = await apiFetch(`/search?q=${encodeURIComponent(q.trim())}`);
        if (res?.results) {
          setQuickAddResults(res.results.map(r => ({
            ...r,
            alreadyAdded: r.alreadyAdded || existing.has(r.symbol),
          })).slice(0, 6));
        }
      }
    } catch { setQuickAddResults([]); }
    setQuickAddSearching(false);
  }, [standalone, liveStocks]);

  // Debounced quick-add search
  useEffect(() => {
    if (!quickAddQuery.trim()) { setQuickAddResults([]); return; }
    const t = setTimeout(() => quickAddSearch(quickAddQuery), 400);
    return () => clearTimeout(t);
  }, [quickAddQuery, quickAddSearch]);

  const handleQuickAdd = async (result) => {
    setQuickAdding(result.symbol);
    try {
      // For HK stocks, ticker is 5-digit (00005.HK), yf_symbol is 4-digit (0005.HK)
      const sym = result.symbol;
      const isHK = sym.endsWith(".HK");
      const yfSym = isHK ? sym.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK" : sym;
      const tickerData = {
        ticker: sym,
        name: result.name,
        yf_symbol: yfSym,
        market: result.market || (isHK ? "HK" : "US"),
        sector: result.sector || "未知",
        currency: result.currency || (isHK ? "HKD" : "USD"),
        type: result.type || "stock",
      };
      const res = await addTicker(tickerData);
      if (res?.success) {
        setQuickAddQuery("");
        setQuickAddResults([]);
        setQuickAddOpen(false);
      }
    } catch {}
    setQuickAdding(null);
  };

  // ─────────────────────────────────────────────────────────────
  // v6 移动端：列表 → 全屏个股卡（左右滑切换）→ 筛选 Sheet → 横屏图表
  // 复用桌面端全部数据/状态（filtered / sel / weights / chartData…）
  // ─────────────────────────────────────────────────────────────
  if (isMobile) {
    const rows = filtered;
    const idx = sel ? rows.findIndex((s) => s.ticker === sel.ticker) : -1;
    const goRel = (d) => { const n = rows[idx + d]; if (n) setSel(n); };
    const cur = (s) => currencySymbol(s?.currency);
    const px = (s) => (s?.price != null ? fmtPrice(s.price, s.currency) : "—"); // fmtPrice 已含币种符号
    const seg = typeFilter === "ETF" ? "ETF" : mkt === "US" ? "US" : mkt === "HK" ? "HK" : "ALL";
    const setSeg = (v) => { if (v === "ETF") { setTypeFilter("ETF"); setMkt("ALL"); } else { setTypeFilter("ALL"); setMkt(v); } };
    const nFilters = (mkt !== "ALL" ? 1 : 0) + (typeFilter !== "ALL" ? 1 : 0) + (showFavOnly ? 1 : 0) + (sortBy !== "score" ? 1 : 0);
    const isFav = sel ? favorites.has(sel.ticker) : false;
    const pillars = sel?.qualityScore != null ? [
      { name: t("质量分"), v: sel.qualityScore, w: weights.quality, c: "#818CF8", hl: sel.isETF ? "成本 / 流动性 / 分散" : "估值 / 盈利 / 成长" },
      { name: t("时机分"), v: sel.timingScore, w: weights.timing, c: "#F5B53C", hl: "动量 / 趋势 / RSI" },
    ] : [];
    let tStart = null;
    const onTS = (e) => { const p = e.touches[0]; tStart = { x: p.clientX, y: p.clientY }; };
    const onTE = (e) => { if (!tStart) return; const p = e.changedTouches[0]; const dx = p.clientX - tStart.x, dy = p.clientY - tStart.y; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goRel(dx < 0 ? 1 : -1); tStart = null; };
    const segBtn = (on) => on
      ? { color: "var(--indigo-2)", borderColor: "rgba(99,102,241,.3)", background: "rgba(99,102,241,.15)" }
      : { color: "var(--fg-2)", borderColor: "var(--line)", background: "rgba(255,255,255,.03)" };

    return (
      <div className="h-full flex flex-col" style={{ background: "var(--bg-0)" }}>
        {/* ── 列表 ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
            <h1 className="text-[22px] font-bold" style={{ color: "var(--fg-0)" }}>{t("量化评分")}</h1>
            <button onClick={() => setMFilterOpen(true)} className="relative w-9 h-9 rounded-[10px] border flex items-center justify-center active:scale-95"
              style={{ borderColor: nFilters ? "rgba(99,102,241,.3)" : "var(--line)", background: nFilters ? "rgba(99,102,241,.12)" : "rgba(255,255,255,.03)" }}>
              <Filter size={17} style={{ color: nFilters ? "var(--indigo-2)" : "var(--fg-1)" }} />
              {nFilters > 0 && <span className="absolute -top-1 -right-1 w-[15px] h-[15px] rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: "var(--indigo)" }}>{nFilters}</span>}
            </button>
          </div>
          <div className="px-4 mb-2 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--fg-3)" }} />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={t("搜索代码 / 名称")}
              className="w-full rounded-[10px] pl-9 pr-3 py-2.5 text-[13px] outline-none border"
              style={{ background: "rgba(255,255,255,.04)", borderColor: "var(--line)", color: "var(--fg-0)" }} />
          </div>
          <div className="px-4 mb-2">
            <Segmented value={seg} onChange={setSeg} options={[{ value: "ALL", label: t("全部") }, { value: "US", label: t("美股") }, { value: "HK", label: t("港股") }, { value: "ETF", label: "ETF" }]} />
          </div>
          <div className="px-4 mb-1 text-[11px]" style={{ color: "var(--fg-3)" }}>{rows.length} {t("只标的")}</div>
          <div className="px-2.5 pb-6">
            {rows.map((stk) => {
              const up = safeChange(stk.change) >= 0;
              return (
                <button key={stk.ticker} onClick={() => setSel(stk)} className="w-full flex items-center gap-3 px-2.5 py-3 rounded-xl active:scale-[0.99] transition text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[14px] font-semibold" style={{ color: "var(--fg-0)" }}>{stk.ticker}</span>
                      <span className="text-[11px] truncate" style={{ color: "var(--fg-3)" }}>{isZh(lang) ? t(stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : enFallback(stk.name, stk.ticker)}</span>
                    </div>
                    <div className="font-mono text-[11px] mt-1" style={{ color: up ? "var(--up)" : "var(--down)" }}>
                      {stk.price != null ? `${px(stk)} · ` : ""}{up ? "+" : ""}{fmtChange(stk.change)}%
                    </div>
                  </div>
                  <div className="w-[54px] shrink-0"><MiniSparkline data={get5DSparkData(stk)} w={54} h={20} /></div>
                  <span className="font-mono text-[19px] font-bold w-8 text-right" style={{ color: (stk.score ?? 0) >= 75 ? "var(--up)" : "var(--indigo-2)", lineHeight: 1 }}>{stk.score?.toFixed?.(0)}</span>
                  <ChevronRight size={16} style={{ color: "var(--fg-4)" }} />
                </button>
              );
            })}
            {rows.length === 0 && <div className="text-center py-12 text-[12px]" style={{ color: "var(--fg-3)" }}>{t("无匹配标的")}</div>}
          </div>
        </div>

        {/* ── 全屏个股卡 ── */}
        {sel && (
          <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--bg-0)" }}>
            <MobileAppBar onBack={() => setSel(null)}
              title={<span className="flex items-center gap-2">
                <span className="font-mono text-[15px] font-bold" style={{ color: "var(--fg-0)" }}>{sel.ticker}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(30,211,149,.12)", color: "var(--up)" }}>{(sel.score ?? 0).toFixed(0)}</span>
              </span>}
              actions={<button onClick={() => toggleFav(sel.ticker)} aria-label={t("自选")} className="p-0.5 active:scale-90"><Star size={19} style={{ color: isFav ? "var(--warn)" : "var(--fg-3)" }} fill={isFav ? "var(--warn)" : "none"} /></button>}
            />
            <div className="flex-1 overflow-y-auto overscroll-contain" onTouchStart={onTS} onTouchEnd={onTE} style={{ paddingBottom: "calc(74px + env(safe-area-inset-bottom))" }}>
              <div className="px-4 pt-3">
                {idx >= 0 && rows.length > 1 && (
                  <div className="flex items-center justify-center gap-2 mb-3 text-[10px]" style={{ color: "var(--fg-3)" }}>
                    <ArrowLeftRight size={11} /> {t("左右滑动切换")} · {idx + 1}/{rows.length}
                  </div>
                )}
                <div className="flex justify-between items-start mb-4">
                  <div className="min-w-0">
                    <div className="text-[13px] mb-1 truncate" style={{ color: "var(--fg-2)" }}>{isZh(lang) ? t(sel.nameCN || STOCK_CN_NAMES[sel.ticker] || sel.name) : enFallback(sel.name, sel.ticker)}</div>
                    <div className="font-mono" style={{ fontSize: 36, fontWeight: 600, color: "var(--fg-0)", lineHeight: 1 }}>{px(sel)}</div>
                    <div className="mt-2">
                      <span className="font-mono text-[12px] px-2 py-1 rounded" style={{ background: safeChange(sel.change) >= 0 ? "rgba(30,211,149,.12)" : "rgba(255,107,107,.12)", color: safeChange(sel.change) >= 0 ? "var(--up)" : "var(--down)" }}>
                        {safeChange(sel.change) >= 0 ? "▲" : "▼"} {fmtChange(sel.change)}%
                      </span>
                    </div>
                  </div>
                  <ScoreRing score={sel.score ?? 0} />
                </div>
                {sel.week52Low != null && sel.week52High != null && sel.price != null && (() => {
                  const lo = sel.week52Low, hi = sel.week52High, pct = Math.max(0, Math.min(100, ((sel.price - lo) / ((hi - lo) || 1)) * 100));
                  return (
                    <div className="mb-4">
                      <div className="flex justify-between font-mono text-[9px] mb-1.5" style={{ color: "var(--fg-3)" }}>
                        <span>52W {cur(sel)}{lo}</span><span style={{ color: "var(--up)" }}>P{pct.toFixed(0)}</span><span>{cur(sel)}{hi}</span>
                      </div>
                      <div className="relative h-1 rounded-full" style={{ background: "rgba(255,255,255,.06)" }}>
                        <div className="absolute top-0 bottom-0 left-0 rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,rgba(255,107,107,.3),rgba(245,181,60,.4) 50%,rgba(30,211,149,.5))" }} />
                        <div className="absolute w-2.5 h-2.5 rounded-full" style={{ left: `calc(${pct}% - 5px)`, top: -3, background: "#fff", boxShadow: "0 0 0 1.5px var(--up)" }} />
                      </div>
                    </div>
                  );
                })()}
                <div className="mb-4"><AIStockSummaryCard stock={sel} /></div>
                {pillars.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[12px] font-semibold mb-1" style={{ color: "var(--fg-0)" }}>{t("双轨评分")}</div>
                    {pillars.map((p) => <MPillar key={p.name} {...p} />)}
                  </div>
                )}
                <div className="mb-4"><ScoreExplainCard stock={sel} weights={weights} /></div>
                {!sel.isETF && <div className="mb-4"><ValuationReadCard stock={sel} /></div>}
                <div className="rounded-[14px] border p-3.5 mb-2" style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--fg-0)" }}>{t("价格走势")} · {chartRange}</span>
                    <button onClick={openFullscreen} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold active:scale-95" style={{ background: "rgba(99,102,241,.12)", border: "1px solid rgba(99,102,241,.3)", color: "var(--indigo-2)" }}><Maximize2 size={11} />{t("全屏")}</button>
                  </div>
                  <div style={{ height: 92 }}>
                    {chartData.length >= 2 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                          <defs><linearGradient id="mScoreArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5EE6E6" stopOpacity="0.25" /><stop offset="100%" stopColor="#5EE6E6" stopOpacity="0" /></linearGradient></defs>
                          <Area type="monotone" dataKey="p" stroke="#5EE6E6" strokeWidth={2} fill="url(#mScoreArea)" dot={false} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-[11px]" style={{ color: "var(--fg-3)" }}>{t("暂无价格数据")}</div>}
                  </div>
                </div>
              </div>
            </div>
            <ThumbActionBar
              secondary={[
                { icon: <Layers size={20} />, label: t("对比"), onClick: () => setCompareSet((s) => { const n = new Set(s); n.has(sel.ticker) ? n.delete(sel.ticker) : n.add(sel.ticker); return n; }) },
                { icon: <ArrowLeftRight size={20} />, label: t("下一只"), onClick: () => goRel(1) },
              ]}
              primary={{ icon: <Star size={18} fill={isFav ? "#fff" : "none"} />, label: isFav ? t("已自选") : t("加自选"), onClick: () => toggleFav(sel.ticker) }}
            />
          </div>
        )}

        {/* ── 筛选 Sheet ── */}
        <BottomSheet open={mFilterOpen} onClose={() => setMFilterOpen(false)} title={t("筛选标的")}
          footer={<button onClick={() => setMFilterOpen(false)} className="w-full h-12 rounded-[13px] text-white text-[15px] font-bold" style={{ background: "linear-gradient(180deg,var(--indigo-2),var(--indigo))", boxShadow: "0 8px 22px -6px rgba(99,102,241,.6)" }}>{t("显示")} {rows.length} {t("只标的")}</button>}>
          <div className="text-[11px] font-mono uppercase tracking-wider mb-2.5" style={{ color: "var(--fg-3)" }}>{t("类型")}</div>
          <div className="flex gap-2 mb-5">
            {[["ALL", t("全部")], ["STOCK", t("个股")], ["ETF", "ETF"], ["LEV", t("杠杆")]].map(([v, l]) => (
              <button key={v} onClick={() => setTypeFilter(v)} className="flex-1 py-2.5 rounded-[10px] text-[12px] font-medium border" style={segBtn(typeFilter === v)}>{l}</button>
            ))}
          </div>
          <div className="text-[11px] font-mono uppercase tracking-wider mb-2.5" style={{ color: "var(--fg-3)" }}>{t("排序")}</div>
          <div className="flex flex-wrap gap-2 mb-5">
            {[["score", t("评分")], ["change", t("涨跌")], ["name", t("代码")], ["macroAdj", t("宏观调整")]].map(([v, l]) => (
              <button key={v} onClick={() => setSortBy(v)} className="px-3.5 py-2 rounded-full text-[12px] font-medium border" style={segBtn(sortBy === v)}>{l}</button>
            ))}
          </div>
          <button onClick={() => setShowFavOnly((v) => !v)} className="w-full flex items-center justify-between py-3 mb-2">
            <span className="text-[13.5px]" style={{ color: "var(--fg-1)" }}>{t("只看关注")}</span>
            <span className="w-11 h-6 rounded-full relative transition-colors" style={{ background: showFavOnly ? "var(--indigo)" : "var(--line-2)" }}><span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: showFavOnly ? 22 : 2 }} /></span>
          </button>
        </BottomSheet>

        {/* ── 横屏全屏图表 ── */}
        <FullscreenChart open={chartFullscreen} onClose={() => setChartFullscreen(false)} title={sel?.ticker}
          meta={sel && <span className="font-mono text-[13px]" style={{ color: safeChange(sel.change) >= 0 ? "var(--up)" : "var(--down)" }}>{px(sel)} {safeChange(sel.change) >= 0 ? "+" : ""}{fmtChange(sel.change)}%</span>}
          indicators={
            <>
              {/* 面积 / K线 切换 */}
              <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,.04)" }}>
                {[["candle", t("K线")], ["area", t("面积")]].map(([v, l]) => (
                  <button key={v} onClick={() => setChartType(v)} className="px-2.5 py-1 rounded-md text-[11px] transition active:scale-95"
                    style={chartType === v ? { background: "var(--bg-2)", color: "var(--fg-0)", fontWeight: 600 } : { color: "var(--fg-3)" }}>{l}</button>
                ))}
              </div>
              {maSignal && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border text-warn bg-warn/10 border-warn/30">
                  <span className="inline-block w-3" style={{ borderTop: "2px dashed #F5B53C" }} />
                  MA20 {maSignal.above ? `↗ 站上 +${maSignal.gap.toFixed(1)}%` : `↘ 跌破 ${maSignal.gap.toFixed(1)}%`}
                </span>
              )}
              {chartType === "candle" && !hasOHLC && <span className="text-[10px]" style={{ color: "var(--fg-3)" }}>{t("K线数据加载中，刷新后显示")}</span>}
            </>
          }
          ranges={["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "ALL"]} activeRange={chartRange} onRangeChange={setChartRange}>
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartSeries} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <defs><linearGradient id="mKlineArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1ED395" stopOpacity="0.22" /><stop offset="100%" stopColor="#1ED395" stopOpacity="0" /></linearGradient></defs>
                <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 9, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} minTickGap={50} interval="preserveStartEnd" />
                <YAxis yAxisId="price" domain={priceDomainFinal} ticks={priceTicksFinal} width={48} tick={{ fontSize: 10, fill: "var(--fg-3)" }} axisLine={false} tickLine={false} tickFormatter={priceAxisFmt} />
                <Tooltip cursor={{ stroke: "rgba(99,102,241,0.6)", strokeWidth: 1.5, strokeDasharray: "4 3" }} content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload; const cur = currencySymbol(sel.currency); const up = (d.chg ?? d.pct ?? 0) >= 0;
                  return (
                    <div className="glass-card border border-indigo-500/40 px-2 py-1.5 tabular-nums font-mono" style={{ minWidth: 96 }}>
                      <div className="text-[9px] text-[#778] mb-0.5">{label}</div>
                      <div className="text-[12px] font-semibold text-white">{cur}{Number(d.p).toFixed(2)}</div>
                      {d.chg != null && <div className={`text-[11px] ${up ? "text-up" : "text-down"}`}>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(2)}%</div>}
                    </div>
                  );
                }} />
                {hasVolume && <Customized component={(p) => <VolumeLayer {...p} data={chartSeries} volMax={volMax} />} />}
                {showCandle ? (
                  <Bar yAxisId="price" dataKey="hl" shape={<CandleShape />} isAnimationActive={false} />
                ) : (
                  <Area yAxisId="price" type="monotone" dataKey="p" stroke="#1ED395" strokeWidth={2.2} fill="url(#mKlineArea)" dot={false} isAnimationActive={false} />
                )}
                {maSignal && <Line yAxisId="price" type="monotone" dataKey="ma20" stroke="#F5B53C" strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls activeDot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-[12px]" style={{ color: "var(--fg-3)" }}>{t("暂无价格数据")}</div>}
        </FullscreenChart>
      </div>
    );
  }

  return (<div className="flex flex-col h-full min-h-0">
    {/* ── 来自 macro alert 的上下文横幅（可关闭） ── */}
    {macroSignal && (
      <div className={`flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border text-[11px] flex-shrink-0 ${
        macroSignal.level === "critical"
          ? "bg-red-500/10 border-red-400/30 text-red-200"
          : macroSignal.level === "warning"
          ? "bg-orange-500/10 border-orange-400/30 text-orange-100"
          : "bg-slate-500/10 border-slate-400/30 text-slate-200"
      }`}>
        <span className="font-mono text-[10px] opacity-70">{t("来自宏观看板")}</span>
        <span className="font-medium">{macroSignal.title}</span>
        {macroSignal.summary && <span className="opacity-75 hidden md:inline">— {macroSignal.summary}</span>}
        {macroSignal.action && (
          <span className="ml-2 opacity-90 hidden lg:inline">{t("建议")}：{macroSignal.action}</span>
        )}
        <button
          onClick={() => setMacroSignal(null)}
          className="ml-auto p-0.5 rounded hover:bg-white/10 opacity-60 hover:opacity-100"
          title={t("关闭")}
        >
          <X size={12} />
        </button>
      </div>
    )}
    {/* ── 市场指数条（分层响应：核心 always · F&G/HSI/VIX md+ · 板块 xl+） ── */}
    <div className="hidden md:flex items-center gap-3 px-3 py-1.5 mb-2 glass-card text-[10px] flex-shrink-0">
      <span className="flex items-center gap-1.5 text-[#a0aec0] shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.dot}`} />
        <span className="font-medium">{t(marketStatus.key)}</span>
      </span>
      <span className="text-white/10 shrink-0">|</span>
      {indices.length === 0 && indicesLoading ? (
        <span className="text-[#667] font-mono animate-pulse">{t('指数加载中…')}</span>
      ) : indices.map((idx, i) => (
        // SPX/NDX 永远显示；HSI/VIX 仅 lg+ 显示（窄屏避免溢出）
        <div key={idx.sym} className={`flex items-center gap-1.5 shrink-0 ${i >= 2 ? 'hidden lg:flex' : ''}`}>
          <span className="text-[#a0aec0] font-medium">{idx.sym}</span>
          <span className="font-mono tabular-nums text-white">{idx.close != null ? idx.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
          {idx.pct != null && (
            <span className={`font-mono tabular-nums ${idx.pct >= 0 ? 'text-up' : 'text-down'}`}>
              {idx.pct >= 0 ? '+' : ''}{idx.pct.toFixed(2)}%
            </span>
          )}
        </div>
      ))}
      {/* C8: 恐惧贪婪指数 + 板块热力 — 复用 stocks 数据，无额外网络 */}
      {(() => {
        if (!liveStocks?.length) return null;
        const valid = liveStocks.map(s => safeChange(s.change)).filter(c => isFinite(c));
        if (valid.length === 0) return null;
        const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
        const breadth = valid.filter(c => c > 0).length / valid.length;
        const fearGreed = Math.round(Math.min(100, Math.max(0, 50 + avg * 8)) * 0.6 + breadth * 100 * 0.4);
        const fgLabel = fearGreed > 75 ? t('极度贪婪') : fearGreed > 60 ? t('贪婪') : fearGreed > 40 ? t('中性') : fearGreed > 25 ? t('恐惧') : t('极度恐惧');
        const fgColor = fearGreed > 60 ? 'text-up' : fearGreed > 40 ? 'text-amber-400' : 'text-down';
        const fgBg = fearGreed > 60 ? 'bg-up' : fearGreed > 40 ? 'bg-amber-400' : 'bg-down';
        // 板块聚合 — 取前 5 个 |avg| 最大
        const groups = {};
        liveStocks.forEach(s => {
          const c = safeChange(s.change);
          if (!isFinite(c) || !s.sector) return;
          const k = s.sector.split('/')[0];
          if (!groups[k]) groups[k] = { sum: 0, n: 0 };
          groups[k].sum += c; groups[k].n += 1;
        });
        const sectors = Object.entries(groups)
          .map(([name, { sum, n }]) => ({ name, val: +(sum / n).toFixed(2), n }))
          .filter(s => s.n >= 2)
          .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
          .slice(0, 5);
        return (
          <>
            <span className="text-white/10 shrink-0">|</span>
            <div className="flex items-center gap-1.5 shrink-0" title={t('恐惧贪婪指数：基于今日涨跌均值 + 上涨宽度')}>
              <span className="text-[#a0aec0] font-medium uppercase text-[9px]">F&G</span>
              <span className={`w-1.5 h-1.5 rounded-full ${fgBg}`} />
              <span className={`font-mono tabular-nums font-bold ${fgColor}`}>{fearGreed}</span>
              <span className={`text-[9px] ${fgColor}`}>{fgLabel}</span>
            </div>
            {sectors.length > 0 && (
              // 板块热力：占 ~500px，只在 xl+ 显示（避免窄屏溢出）
              <>
                <span className="hidden xl:inline text-white/10 shrink-0">|</span>
                <div className="hidden xl:flex items-center gap-2 shrink-0">
                  <span className="text-[#a0aec0] font-medium uppercase text-[9px]">{t('板块')}</span>
                  {sectors.map(s => (
                    <span key={s.name} className="flex items-center gap-1" title={`${s.name} · ${s.n} ${t('只')}`}>
                      <span className="text-[10px] text-[#a0aec0] truncate max-w-[60px]">{t(s.name)}</span>
                      <span className={`font-mono tabular-nums text-[10px] ${s.val >= 0 ? 'text-up' : 'text-down'}`}>
                        {s.val >= 0 ? '+' : ''}{s.val.toFixed(2)}%
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        );
      })()}
      {/* 宏观温度 badge — 让用户看持仓时不脱离市场上下文 */}
      {(() => {
        const temp = macroSnapshot?.composite?.market_temperature;
        if (temp == null) return null;
        const cls = TEMP_TEXT(temp);
        const label = t(TEMP_LABEL(temp));
        return (
          <>
            <span className="text-white/10 shrink-0">|</span>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "macro" }))}
              className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
              title={t('点击查看宏观看板 · 综合 17 因子方向化温度')}
            >
              <span className="text-[#a0aec0] font-medium uppercase text-[9px]">{t('宏观')}</span>
              <span className={`font-mono tabular-nums font-bold ${cls}`}>{temp.toFixed(0)}</span>
              <span className={`text-[9px] ${cls}`}>{label}</span>
            </button>
          </>
        );
      })()}
      <span className="ml-auto flex items-center gap-2 text-[9px] text-[#778] shrink-0">
        <Clock size={9} className="opacity-60" />
        {indicesTime ? new Date(indicesTime).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        <button onClick={fetchIndices} disabled={indicesLoading} aria-label={t('刷新指数')} className="p-1 rounded hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40" title={t('刷新')}>
          <RefreshCw size={10} className={`${indicesLoading ? 'animate-spin' : ''} text-[#a0aec0]`} />
        </button>
      </span>
    </div>
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 min-h-0 overflow-auto md:overflow-hidden">
      {/* Right-click context menu */}
      {/* v7 工作站：hover peek 迷你卡 — 分项评分（行内没有）+ 走势 + W/C 提示。pointer-events-none 避免 hover 抖动 */}
      {peek && (() => {
        const pk = liveStocks.find(s => s.ticker === peek.ticker);
        if (!pk || pk.ticker === sel?.ticker) return null;
        const ch = safeChange(pk.change);
        const ss = pk.subScores;
        return (
          <div className="hidden md:block fixed glass-card border border-white/15 shadow-2xl shadow-black/60 p-3 animate-stagger pointer-events-none" style={{ left: peek.x, top: peek.y, width: 248, zIndex: 45 }}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <div className="min-w-0 flex items-baseline gap-1.5">
                <span className="font-mono font-bold text-sm text-white shrink-0">{pk.ticker}</span>
                <span className="text-[10px] text-[#778] truncate">{isZh(lang) ? t(pk.nameCN || STOCK_CN_NAMES[pk.ticker] || pk.name) : enFallback(pk.name, pk.ticker)}</span>
              </div>
              <span className={`font-mono text-sm font-bold shrink-0 ${pk.score >= 75 ? 'text-up' : 'text-indigo-300'}`}>{pk.score != null ? pk.score.toFixed(0) : '—'}</span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-mono text-base font-semibold text-white">{currencySymbol(pk.currency)}{pk.price}</span>
              <span className={`text-[11px] font-mono ${ch >= 0 ? 'text-up' : 'text-down'}`}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(2)}%</span>
            </div>
            <div className="mb-2"><MiniSparkline data={get5DSparkData(pk)} w={224} h={34} /></div>
            {ss ? (
              <div className="space-y-1">
                {[[t('质量'), pk.qualityScore], [t('时机'), pk.timingScore]].map(([lbl, v]) => (
                  <div key={lbl} className="flex items-center gap-2">
                    <span className="text-[9px] text-[#a0aec0] w-10 shrink-0">{lbl}</span>
                    <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, v || 0))}%`, background: 'var(--brand-gradient)' }} />
                    </div>
                    <span className="text-[9px] font-mono text-white w-6 text-right">{v != null ? Math.round(v) : '—'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-[#667]">{t('暂无分项评分')}</div>
            )}
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/8 text-[9px] text-[#778]">
              <kbd className="px-1 rounded bg-white/5 border border-white/10 font-mono">W</kbd><span>{t('自选')}</span>
              <kbd className="px-1 rounded bg-white/5 border border-white/10 font-mono ml-1">C</kbd><span>{t('对比')}</span>
              <span className="ml-auto font-mono uppercase">{pk.market}</span>
            </div>
          </div>
        );
      })()}
      {ctxMenu && (
        <div id="ctx-menu" className="fixed z-50 glass-card border border-white/15 shadow-2xl shadow-black/50 py-1 min-w-[160px] animate-slide-up" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="px-3 py-1.5 text-[10px] text-[#778] border-b border-white/8 truncate max-w-[200px]">{ctxMenu.ticker} · {ctxMenu.name}</div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { setSel(liveStocks.find(s => s.ticker === ctxMenu.ticker) || sel); setCtxMenu(null); }}
            className="w-full text-left px-3 py-2 text-[11px] text-[#c8cdd3] hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Eye size={12} /> {t('查看详情')}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { toggleFav(ctxMenu.ticker); setCtxMenu(null); }}
            className="w-full text-left px-3 py-2 text-[11px] text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
          >
            <Star size={12} className={favorites.has(ctxMenu.ticker) ? "fill-amber-400" : ""} />
            {favorites.has(ctxMenu.ticker) ? t('移出关注') : t('加入关注')}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { toggleCompare(ctxMenu.ticker); setCtxMenu(null); }}
            disabled={!compareSet.has(ctxMenu.ticker) && compareSet.size >= 4}
            className="w-full text-left px-3 py-2 text-[11px] text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Layers size={12} />
            {compareSet.has(ctxMenu.ticker) ? t('移出对比') : (compareSet.size >= 4 ? t('对比已满(4)') : t('加入对比'))}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleDeleteTicker}
            className="w-full text-left px-3 py-2 text-[11px] text-down hover:bg-down/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 size={12} /> {t('删除标的')}
          </button>
        </div>
      )}
      <div className={leftCollapsed ? `${mobileShowDetail ? "hidden" : "flex"} md:hidden flex-col gap-2` : `md:col-span-5 xl:col-span-4 flex flex-col gap-2 md:min-h-0 ${mobileShowDetail ? "hidden md:flex" : "flex"}`}>
        {/* 移动端置顶区：搜索 + 筛选 + 排序 一起粘在顶部 */}
        <div className="sticky top-0 z-10 flex flex-col gap-2 -mx-1 px-1 py-1 bg-[#0b0b14]/85 backdrop-blur-md md:static md:mx-0 md:p-0 md:bg-transparent md:backdrop-blur-none">
        {/* 搜索栏 + 新增标的 */}
        <div className="flex items-center gap-1.5">
          {/* v7 折叠自选列表（桌面） */}
          <button onClick={() => setLeftPane(true)} title={t('折叠自选列表')} className="hidden md:flex shrink-0 items-center justify-center w-7 h-7 rounded-md text-[#778] hover:text-white hover:bg-white/10 border border-white/8 transition-colors"><ChevronRight size={14} className="rotate-180" /></button>
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a0aec0]" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t("搜索标的 / 代码 / 板块...")}
              autoCorrect="off" autoCapitalize="none" spellCheck={false}
              className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-8 py-2 md:py-1.5 text-xs text-white placeholder-[#667] outline-none focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-1 focus:ring-indigo-500/30 focus:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#778] hover:text-white transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setQuickAddOpen(true);
              // 滚动到底部的快速添加输入框，让用户能立刻看到搜索结果
              setTimeout(() => {
                const target = document.querySelector('[data-quickadd-panel]');
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 50);
            }}
            title={t("新增标的")}
            className="shrink-0 flex items-center gap-1 px-2.5 py-2 md:py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 hover:text-indigo-200 hover:shadow-[0_0_12px_rgba(99,102,241,0.2)] active:scale-95 transition-all"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">{t('新增')}</span>
          </button>
        </div>
        {/* 市场 + 类型 筛选 — 折叠下拉（仿 "持仓 ▼" 设计） */}
        <div className="flex items-center gap-1">
          <div ref={filterRef} className="flex items-center gap-1">
            {/* 市场下拉 */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setMktOpen(v => !v); setTypeOpen(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all active:scale-95 ${
                  mkt !== "ALL" || mktOpen
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/8 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{mkt === "ALL" ? t("全部") : mkt === "US" ? t("美股") : t("港股")}</span>
                <ChevronDown size={10} className={`transition-transform ${mktOpen ? "rotate-180" : ""}`} />
              </button>
              {mktOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 glass-card p-1 min-w-[80px] animate-slide-up">
                  {[["ALL", t("全部")], ["US", t("美股")], ["HK", t("港股")]].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setMkt(key); setMktOpen(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                        mkt === key ? "bg-indigo-500/20 text-indigo-300" : "text-[#a0aec0] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 类型下拉 */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setTypeOpen(v => !v); setMktOpen(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all active:scale-95 ${
                  typeFilter !== "ALL" || typeOpen
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/8 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="tabular-nums">
                  {typeFilter === "ALL" ? `${t("全部")} ${counts.all}`
                    : typeFilter === "STOCK" ? `${t("个股")} ${counts.stocks}`
                    : typeFilter === "ETF" ? `ETF ${counts.etfs}`
                    : `${t("杠杆")} ${counts.lev}`}
                </span>
                <ChevronDown size={10} className={`transition-transform ${typeOpen ? "rotate-180" : ""}`} />
              </button>
              {typeOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 glass-card p-1 min-w-[100px] animate-slide-up">
                  {[
                    ["ALL", `${t("全部")} ${counts.all}`],
                    ["STOCK", `${t("个股")} ${counts.stocks}`],
                    ["ETF", `ETF ${counts.etfs}`],
                    ["LEV", `${t("杠杆")} ${counts.lev}`],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setTypeFilter(key); setTypeOpen(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                        typeFilter === key ? "bg-indigo-500/20 text-indigo-300" : "text-[#a0aec0] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowFavOnly(v => !v)}
            title={t("只看关注")}
            className={`ml-auto flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[9px] font-medium transition-all active:scale-95 border shrink-0 ${showFavOnly ? "bg-amber-400/15 border-amber-400/40 text-amber-300" : "bg-white/5 border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/10"}`}
          >
            <Star size={11} className={showFavOnly ? "fill-amber-400 text-amber-400" : ""} />
            {favorites.size > 0 && <span className="font-mono tabular-nums">{favorites.size}</span>}
          </button>
          <button
            onClick={() => setViewMode(v => v === "list" ? "sector" : "list")}
            title={viewMode === "list" ? t("切换到板块视图") : t("切换到列表视图")}
            className={`p-1 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0 border ${viewMode === "sector" ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300" : "bg-white/5 border-white/8"}`}
          >
            <Layers size={12} />
          </button>
          <button
            onClick={() => setDensity(d => d === "standard" ? "compact" : "standard")}
            title={density === "standard" ? t("切换到紧凑") : t("切换到标准")}
            className={`p-1 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0 border ${density === "compact" ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300" : "bg-white/5 border-white/8"}`}
          >
            {density === "standard" ? <Minus size={12} /> : <Filter size={12} />}
          </button>
          <button onClick={() => setShowW(!showW)} className="p-1 rounded-md bg-white/5 border border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0">
            <Settings size={12} />
          </button>
        </div>
        {/* 对比条 — 有项时显示 */}
        {compareSet.size > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 animate-slide-up">
            <Layers size={12} className="text-cyan-300 shrink-0" />
            <span className="text-[10px] text-cyan-200 font-medium shrink-0">{t('对比')}</span>
            <div className="flex items-center gap-1 flex-1 overflow-x-auto">
              {[...compareSet].map(tk => (
                <span key={tk} className="text-[10px] font-mono text-white bg-white/10 rounded px-1.5 py-0.5 flex items-center gap-1 shrink-0">
                  {tk}
                  <span role="button" onClick={() => toggleCompare(tk)} className="text-cyan-300/70 hover:text-white cursor-pointer"><X size={10} /></span>
                </span>
              ))}
            </div>
            <button onClick={() => setShowCompare(true)} disabled={compareSet.size < 2} className="text-[10px] px-2 py-1 rounded bg-cyan-500 text-white font-medium hover:bg-cyan-400 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('查看')} ({compareSet.size})
            </button>
          </div>
        )}
        {/* 排序 + 结果统计 */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[#778] font-mono">{filtered.length} <span className="font-sans">{t('个标的')}</span></span>
          <div className="flex items-center gap-1">
            {[["score", t("评分")], ["macroAdj", t("宏观调整")], ["change", t("涨跌")], ["name", t("代码")]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-2 py-1 rounded text-[10px] transition-all active:scale-95 ${
                  sortBy === key
                    ? (key === "macroAdj" ? "text-emerald-400 bg-emerald-500/10" : "text-indigo-400 bg-indigo-500/10")
                    : "text-[#778] hover:text-[#a0aec0]"
                }`}
                title={key === "macroAdj" ? t("按宏观调整后评分排序（评分 + 当前 regime × 风格调整）") : undefined}
              >
                {label}{sortBy === key && (key === "name" ? " ↑" : " ↓")}
              </button>
            ))}
          </div>
        </div>
        </div>
        {showW && (
          <div className="glass-card p-3 space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>{t('双轨权重配置')}</div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-up/10 text-up border border-up/20">
                {t('质量')} {weights.quality}% · {t('时机')} {weights.timing}%
              </span>
            </div>
            {/* 策略预设 */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[9px] text-[#778] mr-1">{t('预设')}</span>
              {[
                [t('持有视角'), { quality: 70, timing: 30 }],
                [t('均衡'), { quality: 60, timing: 40 }],
                [t('交易视角'), { quality: 30, timing: 70 }],
              ].map(([label, preset]) => {
                const isActive = weights.quality === preset.quality && weights.timing === preset.timing;
                return (
                  <button key={label} onClick={() => setWeights(preset)} className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all active:scale-95 ${isActive ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border border-white/10 hover:bg-white/10'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {/* 质量 ↔ 时机 单滑块：拖动改变两者占比（恒和 100） */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium">
                <span className="flex items-center gap-1" style={{ color: "#818CF8" }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: "#818CF8" }} />{t('质量分')} {weights.quality}%
                </span>
                <span className="flex items-center gap-1" style={{ color: "#F5B53C" }}>
                  {t('时机分')} {weights.timing}%<span className="w-2 h-2 rounded-full" style={{ background: "#F5B53C" }} />
                </span>
              </div>
              <div className="relative h-6 flex items-center">
                <div className="absolute inset-x-0 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, #818CF8, #F5B53C)" }} />
                <input
                  type="range" min="0" max="100" step="5" value={weights.quality}
                  onChange={e => { const q = +e.target.value; setWeights({ quality: q, timing: 100 - q }); }}
                  className="weight-slider absolute inset-0 w-full appearance-none bg-transparent cursor-pointer z-10"
                  style={{ "--slider-color": "#cbd5e1" }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px]" style={{ color: "var(--text-muted)" }}>
                <span>← {t('持有视角')}</span>
                <span>{t('交易视角')} →</span>
              </div>
            </div>
            {/* 公式说明 */}
            <div className="text-[9px] leading-relaxed px-2 py-1.5 rounded-md flex items-start gap-1.5" style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}>
              <Info size={11} className="shrink-0 mt-px opacity-70" />
              <span>{t('综合分 = 质量分 × 质量权重 + 时机分 × 时机权重；个股与 ETF 同此公式')}</span>
            </div>
            {/* 确认应用按钮 */}
            <button
              onClick={() => {
                // 双轨：质量×wQ + 时机×wT，对个股与 ETF 统一重算（详见 applyWeights）
                const n = applyWeights(weights);
                setWeightToast({ n });
                setTimeout(() => setWeightToast(cur => (cur && cur.n === n && !cur.ws ? null : cur)), 3200);
                setShowW(false);
              }}
              className="w-full py-2 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-indigo-500 to-cyan-500 text-white flex items-center justify-center gap-1.5 shadow-glow-indigo btn-tactile btn-shine mt-1"
            >
              <Zap size={12} /> {t('应用权重并重新评分')}
            </button>
          </div>
        )}
        {weightToast && (
          <div className="mb-2 px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1.5 bg-up/10 border border-up/20 text-up animate-slide-up">
            <Check size={12} className="shrink-0" />
            <span>
              {weightToast.ws && <b className="font-semibold text-white/90">{weightToast.ws} · </b>}
              {weightToast.n > 0
                ? t('已按双轨权重重算 {n} 只标的评分', { n: weightToast.n })
                : t('评分无变化：当前已是该权重')}
            </span>
          </div>
        )}
        <div
          className="space-y-0.5 pr-1 md:flex-1 md:overflow-auto relative"
          onTouchStart={onListTouchStart}
          onTouchMove={onListTouchMove}
          onTouchEnd={onListTouchEnd}
          style={pullDist > 0 ? { transform: `translateY(${pullDist}px)`, transition: pullDist === 0 ? 'transform 0.25s ease-out' : 'none' } : undefined}
        >
          {/* F3: pull-to-refresh hint（仅移动端 + 下拉中可见） */}
          {pullDist > 0 && (
            <div
              className="md:hidden absolute left-0 right-0 -top-7 flex items-center justify-center gap-1.5 text-[10px] font-mono pointer-events-none"
              style={{ color: pullDist > 50 ? 'var(--sem-up)' : 'var(--text-muted)' }}
            >
              <RefreshCw size={11} className={pullDist > 50 ? 'animate-spin' : ''} />
              {pullDist > 50 ? t('松开刷新') : t('下拉刷新行情')}
            </div>
          )}
          {/* List header — visible only in list view with results */}
          {viewMode === "list" && filtered.length > 0 && (
            density === "compact" ? (
              <div className="hidden md:flex items-center gap-2 px-2.5 py-1 text-[9px] uppercase tracking-wider text-[#667] sticky top-0 bg-[#0b0b14]/85 backdrop-blur-sm border-b border-white/5 z-[1]">
                <span className="w-4 text-center font-mono">#</span>
                <span className="font-mono shrink-0">{t('代码')}</span>
                <span className="flex-1 ml-1">{t('名称')}</span>
                <span className="shrink-0 w-14 text-center">5D</span>
                <span className="shrink-0">{t('评分')}</span>
                <span className="shrink-0 w-14 text-right">{t('涨跌')}</span>
                <span className="w-3" />
              </div>
            ) : (
              <div className="hidden md:flex items-center justify-between px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-wider text-[#667] sticky top-0 bg-[#0b0b14]/85 backdrop-blur-sm border-b border-white/5 z-[1]">
                <span>{t('标的 · 名称')}</span>
                <span>5D · {t('评分 · 涨跌')}</span>
              </div>
            )
          )}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#778]">
              <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/8 flex items-center justify-center mb-3">
                <Search size={20} className="opacity-30" />
              </div>
              <span className="text-xs mb-1">{showFavOnly && favorites.size === 0 ? t('关注列表为空 — 点击列表中的 ⭐ 添加') : t('未找到匹配的标的')}</span>
              <button onClick={() => { setSearchTerm(""); setMkt("ALL"); setTypeFilter("ALL"); setShowFavOnly(false); }} className="text-[10px] text-indigo-400 mt-1 hover:underline px-3 py-1 rounded-md bg-indigo-500/5 border border-indigo-500/10 transition-all hover:bg-indigo-500/10">{t('清除筛选')}</button>
            </div>
          ) : viewMode === "sector" ? (
            <div className="space-y-1.5">
              {sectorGroups.map((g, i) => (
                <div key={g.name} className="glass-card p-2.5 animate-stagger" style={{ animationDelay: `${i * 0.03}s` }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Layers size={11} className="text-indigo-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-white truncate">{g.name}</span>
                      <span className="text-[9px] text-[#778] font-mono shrink-0">{g.count}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] text-[#778]">{t('均分')}</span>
                      <span className="text-[11px] font-mono font-bold tabular-nums text-indigo-300">{g.avgScore.toFixed(1)}</span>
                      <span className={`text-[10px] font-mono tabular-nums ${g.avgChange >= 0 ? "text-up" : "text-down"}`}>
                        {g.avgChange >= 0 ? "+" : ""}{g.avgChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {g.top.map((stk, j) => (
                      <button key={stk.ticker} onClick={() => { setSel(stk); setMobileShowDetail(true); }}
                        className={`w-full flex items-center justify-between px-2 py-1 rounded-md transition-colors text-left ${sel?.ticker === stk.ticker ? "bg-indigo-500/20" : "hover:bg-white/5"}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] w-3 text-center text-[#667] font-mono">{j + 1}</span>
                          <span className="text-[11px] font-mono font-semibold text-white shrink-0">{stk.ticker}</span>
                          <span className="text-[9px] text-[#a0aec0] truncate">{isZh(lang) ? t(stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : enFallback(stk.name, stk.ticker)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <MiniSparkline data={get5DSparkData(stk)} w={40} h={12} />
                          <span className="text-[10px] font-mono tabular-nums text-indigo-300">{stk.score?.toFixed(1)}</span>
                          <span className={`text-[10px] font-mono tabular-nums ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                            {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                          </span>
                        </div>
                      </button>
                    ))}
                    {g.count > 3 && (
                      <div className="text-[9px] text-[#667] text-center pt-0.5">+{g.count - 3} {t('更多')}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.map((stk, i) => (
            <button key={stk.ticker} onClick={() => { cancelPeek(); setSel(stk); setMobileShowDetail(true); }} onContextMenu={(e) => handleContextMenu(e, stk)} onMouseEnter={(e) => schedulePeek(e, stk)} onMouseLeave={cancelPeek} className={`virt-row w-full text-left px-2.5 ${density === "compact" ? "py-1" : "py-2.5 md:py-2"} rounded-lg transition-all duration-200 border ${i < 30 ? 'animate-stagger' : ''} active:scale-[0.98] group relative overflow-hidden ${sel?.ticker === stk.ticker ? "bg-gradient-to-r from-indigo-500/35 via-indigo-500/15 to-transparent border-indigo-500/30 shadow-lg shadow-indigo-500/5" : "bg-white/[0.02] border-transparent hover:bg-white/[0.04] hover:border-white/10"}`} style={{ animationDelay: i < 30 ? `${i * 0.03}s` : undefined }}>
              {/* PDF2 抛光 Phase 1.1：选中态 2px 渐变光条 indigo→cyan（无入场动画，直接显示） */}
              {sel?.ticker === stk.ticker && (
                <span aria-hidden="true" className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r" style={{ background: 'var(--brand-gradient)' }} />
              )}
              {density === "compact" ? (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] w-4 text-center text-[#667] font-mono shrink-0">{i + 1}</span>
                  <span className="font-semibold text-[11px] text-white shrink-0 font-mono"><Highlight text={stk.ticker} query={searchTerm} /></span>
                  <span className="text-[9px] text-[#a0aec0] truncate flex-1"><Highlight text={isZh(lang) ? t(stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : enFallback(stk.name, stk.ticker)} query={searchTerm} /></span>
                  <MiniSparkline data={get5DSparkData(stk)} w={56} h={16} />
                  <span className="text-[10px] font-mono tabular-nums text-indigo-300 shrink-0">{stk.score?.toFixed(1)}</span>
                  <span className={`text-[10px] font-mono tabular-nums shrink-0 w-14 text-right ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); toggleFav(stk.ticker); }}
                    className={`p-0.5 rounded shrink-0 transition-all ${favorites.has(stk.ticker) ? "text-amber-400" : "text-[#556] opacity-0 group-hover:opacity-100 hover:text-amber-300"}`}
                    title={favorites.has(stk.ticker) ? t("移出关注") : t("加入关注")}
                  >
                    <Star size={11} className={favorites.has(stk.ticker) ? "fill-amber-400" : ""} />
                  </span>
                </div>
              ) : (
              <>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`rank-badge ${i < 3 ? "rank-top" : "rank-mid"}`}>{i + 1}</span>
                  <span className="font-semibold text-xs text-white shrink-0"><Highlight text={stk.ticker} query={searchTerm} /></span>
                  {/* PDF1 P0 收敛：市场标签从彩色 Badge 改 neutral mono 文字。ETF/leverage 是功能性识别，保留 Badge */}
                  <span className="text-[9px] font-mono uppercase tracking-wide" style={{ color: 'var(--sem-neutral)' }}>{stk.market}</span>
                  {stk.isETF && !stk.leverage && <Badge variant="accent" size="sm">ETF</Badge>}
                  {stk.isETF && stk.leverage && <Badge variant="danger" size="sm">{stk.leverage}</Badge>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-semibold font-mono tabular-nums ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); toggleFav(stk.ticker); }}
                    className={`p-1 -m-1 rounded transition-all ${favorites.has(stk.ticker) ? "text-amber-400" : "text-[#556] opacity-0 group-hover:opacity-100 hover:text-amber-300"}`}
                    title={favorites.has(stk.ticker) ? t("移出关注") : t("加入关注")}
                  >
                    <Star size={12} className={favorites.has(stk.ticker) ? "fill-amber-400" : ""} />
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#b0b8c4] truncate flex-1 min-w-0"><Highlight text={isZh(lang) ? t(stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : enFallback(stk.name, stk.ticker)} query={searchTerm} /></span>
                <MiniSparkline data={get5DSparkData(stk)} w={48} h={14} />
                <div className="flex items-center gap-1 w-20 shrink-0">
                  <ScoreBar score={stk.score} />
                  <MacroAdjustBadge stock={stk} temp={macroSnapshot?.composite?.market_temperature} />
                </div>
              </div>
              </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`detail-ambient ${leftCollapsed ? "md:col-span-12" : "md:col-span-7"} ${leftCollapsed && rightCollapsed ? "xl:col-span-12" : leftCollapsed ? "xl:col-span-9" : rightCollapsed ? "xl:col-span-8" : "xl:col-span-5"} md:min-h-0 md:overflow-auto pr-0 md:pr-1 pb-16 md:pb-0 ${mobileShowDetail ? "flex flex-col" : "hidden md:block"}`}>
        {/* Mobile back button */}
        <button onClick={() => setMobileShowDetail(false)} className="md:hidden flex items-center gap-1.5 text-xs text-indigo-400 mb-2 py-2 px-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/15 w-fit active:scale-95 transition-all">
          <ChevronRight size={14} className="rotate-180" /> {t('返回列表')}
        </button>
        {/* v7 桌面：折叠态展开条（sticky，不随详情滚动；左/右栏各自折叠时出现对应展开按钮）*/}
        {(leftCollapsed || rightCollapsed) && (
          <div className="hidden md:flex sticky top-0 z-20 items-center gap-2 mb-2 py-1.5 bg-[#0b0b14]/85 backdrop-blur-sm">
            {leftCollapsed && (
              <button onClick={() => setLeftPane(false)} title={t('展开自选列表')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-white/5 border border-white/10 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-colors"><ChevronRight size={12} /> {t('自选列表')}</button>
            )}
            <span className="flex-1" />
            {rightCollapsed && (
              <button onClick={() => setRightPane(false)} title={t('展开对比盘')} className="hidden xl:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-white/5 border border-white/10 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-colors">{t('对比盘')} <ChevronRight size={12} className="rotate-180" /></button>
            )}
          </div>
        )}
        {sel && loading ? (
          <div className="flex flex-col gap-3 animate-slide-up">
            <div className="glass-card p-4">
              <div className="flex items-start justify-between mb-3">
                <div><SkeletonBlock className="h-5 w-32 mb-1.5" /><SkeletonBlock className="h-3 w-48" /></div>
                <div className="text-right"><SkeletonBlock className="h-7 w-24 mb-1" /><SkeletonBlock className="h-4 w-16 ml-auto" /></div>
              </div>
              <SkeletonBlock className="h-3 w-full mb-1" /><SkeletonBlock className="h-3 w-3/4 mb-3" />
              <SkeletonBlock className="h-36 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card p-3"><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-40 w-full" /></div>
              <div className="glass-card p-3"><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-40 w-full" /></div>
            </div>
          </div>
        ) : sel && (
          <div className="flex flex-col gap-3">
            <div className="glass-card p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-1">
                <div>
                  {/* v5 编辑式 hero：ticker 抬到 28/36px + Fraunces serif — 让单只标的成为主角 */}
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-[34px] sm:text-[42px] font-serif font-semibold text-white leading-none tracking-tight" style={{ letterSpacing: '-0.02em' }}>{sel.ticker}</h3>
                    {/* PDF1 收敛：sector 从 accent Badge 改 neutral 文字（信息性，无需视觉权重） */}
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{sel.market} · {isZh(lang) ? t(sel.sector) : sel.sector}</span>
                    {/* v5.2：下次财报倒计时 chip — 提前把加/减仓窗口与财报日对齐 */}
                    {(() => {
                      if (!sel.nextEarnings) return null;
                      const d = new Date(sel.nextEarnings);
                      if (isNaN(d.getTime())) return null;
                      const days = Math.ceil((d - new Date()) / 86400000);
                      if (days < 0) return null;
                      const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      return (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/[0.12] text-amber-300 border border-amber-500/25" title={t('下次财报')}>
                          {t('财报')} {md} · T-{days}d
                        </span>
                      );
                    })()}
                    {/* PDF1 P0 收敛：etfType（国家/主题/行业 ETF）是分类信息，不是 warning。
                        leverage 保留 danger（杠杆是真风险标记）；普通 ETF 用 default neutral。 */}
                    {sel.isETF && <Badge variant={sel.leverage ? "danger" : "default"} size="sm">{t(sel.etfType)}</Badge>}
                    {/* v5 编辑式：评分环抬到 40px（含中心数字）— 让评分作为视觉锚点而非小图标 */}
                    {sel.score != null && (() => {
                      const C = 100.53;  // 2π × r=16
                      const s = Math.min(100, Math.max(0, sel.score));
                      const gradId = `score-ring-grad-${sel.ticker || 'sel'}`;
                      return (
                        <div className="relative w-10 h-10 shrink-0" aria-hidden="true">
                          <svg width="40" height="40" viewBox="0 0 40 40">
                            <defs>
                              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="var(--accent-indigo)" />
                                <stop offset="100%" stopColor="var(--accent-cyan)" />
                              </linearGradient>
                            </defs>
                            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                            <circle cx="20" cy="20" r="16" fill="none"
                              stroke={`url(#${gradId})`} strokeWidth="3" strokeLinecap="round"
                              strokeDasharray={C}
                              strokeDashoffset={C * (1 - s / 100)}
                              transform="rotate(-90 20 20)"
                              style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.2,0.7,0.1,1)' }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-[11px] font-mono font-bold tabular-nums text-white leading-none">{s.toFixed(0)}</span>
                          </div>
                        </div>
                      );
                    })()}
                    {/* PDF1 P0：评分数字 + vs 行业中位 ▲▼ delta（chip 与环并排） */}
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-white">
                      <CountUp value={sel.score} decimals={1} duration={500} />
                      <span className="text-[#778] font-normal">/100</span>
                    </span>
                    {sectorMedians?.score != null && (
                      <span
                        className={`text-[9px] font-mono ${(sel.score - sectorMedians.score) >= 0 ? 'text-up' : 'text-down'}`}
                        title={t('vs 行业中位 {n}（{p} 同行）', { n: sectorMedians.score.toFixed(1), p: sectorMedians.peerCount })}
                      >
                        {(sel.score - sectorMedians.score) >= 0 ? '▲' : '▼'} {Math.abs(sel.score - sectorMedians.score).toFixed(1)}
                      </span>
                    )}
                    <MacroAdjustBadge stock={sel} temp={macroSnapshot?.composite?.market_temperature} size="sm" />
                  </div>
                  <div className="text-xs text-[#a0aec0]">{isZh(lang) ? t(sel.nameCN || STOCK_CN_NAMES[sel.ticker] || sel.name) : enFallback(sel.name, sel.ticker)}</div>
                </div>
                <div className="sm:text-right flex sm:block items-center gap-2">
                  {/* PDF2 抛光 4.2：主价格抬到 24/28px + 渐变文字（白→slate-300）让数字有金属感 */}
                  <div
                    className="num-gradient text-[32px] sm:text-[40px] font-bold font-mono tabular-nums leading-none"
                    style={{
                      background: 'linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    <CountUp value={parseFloat(sel.price) || 0} decimals={(sel.currency === "KRW" || sel.currency === "JPY") ? 0 : 2} duration={600} prefix={currencySymbol(sel.currency)} thousands />
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${safeChange(sel.change) >= 0 ? "text-up" : "text-down"}`}>
                    <span>{safeChange(sel.change) >= 0 ? "▲" : "▼"} </span>
                    <CountUp value={Math.abs(safeChange(sel.change))} decimals={2} duration={500} suffix="%" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#a0aec0] leading-relaxed mb-2 border-l-2 border-indigo-500/30 pl-2">{(() => {
                if (isZh(lang)) return t(STOCK_CN_DESCS[sel.ticker] || sel.descriptionCN || sel.description);
                // 英文模式：优先用 STOCK_EN_DESCS（与 STOCK_CN_DESCS 一一对应的英文描述），
                // 否则退到 data 自带英文描述；都没有再用英文公司名兜底（不显示中文）。
                const enDesc = STOCK_EN_DESCS[sel.ticker] || sel.descriptionEN || sel.description;
                if (enDesc && !hasCJK(enDesc)) return enDesc;
                return sel.name || sel.ticker;
              })()}</p>
              {/* PDF2 抛光：AI 评分解读卡前置 — 紧贴评分块，回答「为什么是这个分」（默认折叠） */}
              {sel.subScores && (
                <div className="mb-2">
                  <ScoreExplainCard stock={sel} weights={weights} />
                </div>
              )}
              {/* v7: ETF 评分归因前置 — 个股有「三大要素」(下方)，ETF 用成本/流动性/动量/风险四维，同样提到首屏，让「为什么是这个分」对 ETF 也可见（桌面；真实 subScores）*/}
              {sel.subScores && sel.isETF && (
                <div className="hidden md:block mb-3">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <h3 className="text-[11px] font-medium text-white/90">{t('评分构成 · ETF 四维')}</h3>
                    {sectorMedians?.score != null && (
                      <span className="text-[9px] text-[#778] font-mono">{t('行业中位')} <span className="text-white/70">{sectorMedians.score.toFixed(0)}</span></span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['cost', t('成本效率'), '#818cf8'],
                      ['liquidity', t('流动性'), '#8b5cf6'],
                      ['momentum', t('动量趋势'), '#06b6d4'],
                      ['risk', t('风险分散'), '#f5b53c'],
                    ].filter(([k]) => Number.isFinite(sel.subScores[k])).map(([k, label, color]) => {
                      const v = Number(sel.subScores[k]);
                      return (
                        <div key={k} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-[#a0aec0]">{label}</span>
                            <span className="text-[13px] font-mono font-bold tabular-nums score-accent-num" style={{ color }}>{Math.round(v)}</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* v5 编辑式：三大要素 pillar cards — 把评分归因从深埋的 hover tooltip 提升为主视图
                  顶部色条 + 32px 大数字 + 进度条 + 高亮指标 — 一眼 grok "为什么是 X 分"
                  仅非 ETF：ETF 用 cost/liquidity/momentum/risk 四维（已有深处归因卡覆盖） */}
              {sel.qualityScore != null && (
                <div className="mb-3">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <h3 className="text-[11px] font-medium text-white/90">{t('双轨评分：质量 + 时机')}</h3>
                    {/* 给综合分一个坐标系 — 对比同业最佳 + 行业中位的绝对锚点 */}
                    {sectorMedians?.score != null && (
                      <span className="text-[9px] text-[#778] font-mono">
                        {sectorMedians.topPeer?.score != null && (
                          <>{t('对比')} <span className="text-white/70">{sectorMedians.topPeer.ticker} {sectorMedians.topPeer.score.toFixed(1)}</span> · </>
                        )}
                        {t('行业中位')} <span className="text-white/70">{sectorMedians.score.toFixed(0)}</span>
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'quality', label: t('质量分'), color: '#818cf8', score: sel.qualityScore, weight: weights.quality, med: sectorMedians?.quality, dims: qualityKeys(sel.isETF), sub: sel.isETF ? t('费率·流动性·分散') : t('值不值得长期持有') },
                      { key: 'timing', label: t('时机分'), color: '#f5b53c', score: sel.timingScore, weight: weights.timing, med: sectorMedians?.timing, dims: TIMING_KEYS, sub: t('现在是不是买点') },
                    ].map(trk => {
                      const sc = Number.isFinite(trk.score) ? trk.score : 0;
                      return (
                        <div
                          key={trk.key}
                          className="pillar-card"
                          style={{ '--pillar-color': trk.color }}
                          title={`${trk.label} ${sc.toFixed(1)} / 100 · ${t('权重')} ${trk.weight}%`}
                        >
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-white">{trk.label}</span>
                            <span className="text-[9px] font-mono" style={{ color: trk.color }}>{t('权重')} {trk.weight}%</span>
                          </div>
                          <div className="flex items-baseline gap-1 mb-1.5">
                            <span className="pillar-card__num">{sc.toFixed(0)}</span>
                            <span className="text-[9px] text-[#778] font-mono">/100</span>
                            {trk.med != null && Number.isFinite(trk.score) && (
                              <span className={`text-[9px] font-mono ml-1 ${sc >= trk.med ? 'text-up' : 'text-down'}`} title={t('vs 行业中位')}>
                                {sc >= trk.med ? '▲' : '▼'} {Math.abs(sc - trk.med).toFixed(0)}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {trk.dims.map(k => {
                              const dv = Number.isFinite(sel.subScores?.[k]) ? sel.subScores[k] : null;
                              return (
                                <div key={k} className="flex items-center gap-1.5">
                                  <span className="text-[9px] text-[#a0aec0] w-8 shrink-0">{t(SUB_LABELS[k] || k)}</span>
                                  <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, dv || 0))}%`, background: trk.color }} />
                                  </div>
                                  <span className="text-[9px] font-mono text-white/90 w-6 text-right">{dv != null ? Math.round(dv) : '—'}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="text-[9px] text-[#778] mt-1.5">{trk.sub}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 图表标题 */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity size={11} className="text-indigo-400" />
                <span className="text-[11px] font-medium text-white/90">{t('价格走势')}</span>
                <span className="text-[10px] font-mono text-[#778]">— {sel.ticker}</span>
                {showBenchmark && <span className="text-[10px] font-mono text-[#94a3b8]">· {benchmarkLabel} {t('基准')}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => setShowBenchmark(v => !v)} title={showBenchmark ? t('隐藏基准') : t('对比基准')} className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-all active:scale-95 ${showBenchmark ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border-white/10 hover:bg-white/10'}`}>
                    {benchmarkLabel}
                  </button>
                  <button onClick={openFullscreen} title={t('全屏')} className="p-1 rounded text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all active:scale-95">
                    <Maximize2 size={11} />
                  </button>
                </div>
              </div>
              {/* 时间维度选择器 */}
              <div className="flex items-center gap-0.5 mb-2 bg-white/5 rounded-lg p-0.5 border border-white/8 w-full md:w-fit overflow-x-auto">
                {["1D","5D","1M","6M","YTD","1Y","5Y","ALL"].map(r => {
                  const label = r === "1D" ? t("分时") : r === "5D" ? t("五日") : r === "1M" ? t("月") : r === "6M" ? t("6月") : r === "YTD" ? t("今年") : r === "1Y" ? t("1年") : r === "5Y" ? t("5年") : t("全部");
                  const hasData = sel.priceRanges && sel.priceRanges[r];
                  return (
                    <button key={r} onClick={() => setChartRange(r)}
                      className={`px-1.5 md:px-1.5 py-1 md:py-0.5 rounded text-[10px] font-medium transition-all flex-1 md:flex-none active:scale-95 ${chartRange === r ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                    >{label}{!hasData && r !== "6M" && chartRange !== r ? "" : ""}</button>
                  );
                })}
              </div>
              {/* 区间收益率 + MA20 趋势信号 */}
              {(periodReturn !== null || maSignal) && (
                <div className="flex items-center gap-1.5 mb-1">
                  {maSignal && (
                    <span
                      title={t('MA20 = 最近 20 个交易日收盘均价 {sym}{ma}；现价{pos} {gap}', { sym: currencySymbol(sel.currency), ma: maSignal.ma.toFixed(2), pos: maSignal.above ? t('在 20 日均线上方') : t('在 20 日均线下方'), gap: `${maSignal.gap >= 0 ? '+' : ''}${maSignal.gap.toFixed(1)}%` })}
                      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${maSignal.above ? 'text-warn bg-warn/10 border-warn/30' : 'text-[#a0aec0] bg-white/5 border-white/10'}`}
                    >
                      <span className="inline-block w-3" style={{ borderTop: '2px dashed #F5B53C' }} />
                      MA20 {maSignal.above ? `↗ ${t('站上均线')} +${maSignal.gap.toFixed(1)}%` : `↘ ${t('跌破均线')} ${maSignal.gap.toFixed(1)}%`}
                    </span>
                  )}
                  {periodReturn !== null && (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <span className="text-[10px] text-[#778]">{t('区间收益')}</span>
                      <span className={`text-xs font-bold font-mono tabular-nums px-1.5 py-0.5 rounded ${safeChange(periodReturn) >= 0 ? "text-up bg-up/10" : "text-down bg-down/10"}`}>
                        {safeChange(periodReturn) >= 0 ? "+" : ""}{fmtChange(periodReturn)}%
                      </span>
                    </span>
                  )}
                </div>
              )}
              <div
                ref={chartContainerRef}
                onClick={() => { if (chartData.length >= 2) openFullscreen(); }}
                title={t("点击放大 · K线 / 成交量 / 指标")}
                className={`h-36 chart-glow relative group ${chartData.length >= 2 ? "cursor-pointer" : ""}`}
              >
                {/* 悬停提示：整块可点击放大成 K 线大图 */}
                {chartData.length >= 2 && (
                  <div className="absolute top-1 right-1 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 border border-white/10 text-[9px] font-medium text-white/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <Maximize2 size={9} /> {t("点击看 K 线")}
                  </div>
                )}
                {chartData.length < 2 && (
                  loading ? (
                    /* C13: 加载中显示 skeleton shimmer */
                    <div className="absolute inset-0 z-10 flex flex-col gap-1 p-2 rounded-lg overflow-hidden">
                      <div className="skeleton h-3 w-1/3 rounded-md" />
                      <div className="flex-1 flex items-end gap-px mt-1">
                        {[...Array(20)].map((_, i) => (
                          <div key={i} className="skeleton flex-1 rounded-sm" style={{ height: `${30 + Math.sin(i * 0.6) * 30 + Math.random() * 20}%`, animationDelay: `${i * 0.05}s` }} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.02] border border-dashed border-white/10">
                      <Activity size={20} className="text-[#778] opacity-50" />
                      <span className="text-[10px] text-[#778]">{t('该周期暂无价格数据')}</span>
                      <span className="text-[9px] text-[#556]">{sel.priceHistory && sel.priceHistory.length > 0 ? t('请尝试其他时间维度') : t('数据加载中或不可用')}</span>
                    </div>
                  )
                )}
                {chartSize.w > 0 && chartSize.h > 0 && (
                <ComposedChart width={chartSize.w} height={chartSize.h} data={chartDataWithBench} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8A2BE2" />
                        <stop offset="100%" stopColor="#4169E1" />
                      </linearGradient>
                      {/* C3: Bloomberg 风激光十字光标渐变 */}
                      <linearGradient id="crossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
                        <stop offset="50%" stopColor="#6366f1" stopOpacity="1" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} minTickGap={28} interval="preserveStartEnd" />
                    <YAxis yAxisId="price" tick={{ fontSize: 10, fill: "#667" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={(sel.currency === "KRW" || sel.currency === "JPY") ? 64 : 45}
                      tickFormatter={(v) => {
                        // KRW/JPY 用千分位整数；其他取整到 2 位，避免浮点尾巴(与放大图一致)
                        if (sel.currency === "KRW" || sel.currency === "JPY") return Math.round(v).toLocaleString();
                        return (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
                      }}
                    />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 9, fill: "#778" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={52} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                    <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 3" />
                    {/* C3: 自定义 Bloomberg 风 Tooltip + 激光十字光标 */}
                    <Tooltip
                      cursor={{ stroke: "url(#crossGrad)", strokeWidth: 1.5, strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        const cur = currencySymbol(sel.currency);
                        const sign = (n) => (n >= 0 ? '+' : '');
                        return (
                          <div className="glass-card border border-indigo-500/40 shadow-2xl px-2.5 py-2 tabular-nums" style={{ minWidth: 180 }}>
                            <div className="text-[9px] text-[#778] uppercase tracking-wider mb-1 font-mono">{label}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div>
                                <div className="text-[9px] text-[#778] uppercase">{t('价格')}</div>
                                <div className="text-sm font-bold font-mono text-white leading-tight">{cur}{Number(d.p).toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-[9px] text-[#778] uppercase">{t('区间')}</div>
                                <div className={`text-sm font-bold font-mono leading-tight ${d.pct >= 0 ? 'text-up' : 'text-down'}`}>
                                  {sign(d.pct)}{Number(d.pct).toFixed(2)}%
                                </div>
                              </div>
                              {d.bpct != null && (
                                <>
                                  <div>
                                    <div className="text-[9px] text-[#778] uppercase">{benchmarkLabel}</div>
                                    <div className={`text-xs font-mono leading-tight ${d.bpct >= 0 ? 'text-up' : 'text-down'}`}>
                                      {sign(d.bpct)}{Number(d.bpct).toFixed(2)}%
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-[#778] uppercase">α</div>
                                    <div className={`text-xs font-mono leading-tight ${(d.pct - d.bpct) >= 0 ? 'text-up' : 'text-down'}`}>
                                      {sign(d.pct - d.bpct)}{Number(d.pct - d.bpct).toFixed(2)}%
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    />
                    {/* 收起态总览图：永远只画干净面积线（K线/指标在点击放大后的大图里）。
                        PDF2 抛光 4.4：1100ms 描边 + ease-out 让线"画出来"而不是突然显形 */}
                    <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGrad)" : "#FF6B6B"} strokeWidth={2} fill="url(#pg)" dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2, filter: "drop-shadow(0 0 4px rgba(138,43,226,0.6))" }} animationDuration={1100} animationEasing="ease-out" />
                    {maSignal && <Line yAxisId="price" type="monotone" dataKey="ma20" stroke="#F5B53C" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls activeDot={false} isAnimationActive={false} name="MA20" />}
                    <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} />
                    {showBenchmark && <Line yAxisId="pct" type="monotone" dataKey="bpct" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 1.5 }} animationDuration={1100} animationEasing="ease-out" />}
                  </ComposedChart>
                )}
              </div>
            </div>

            {/* C7: 我的持仓快照（如果该 ticker 在 journal 里） */}
            {(() => {
              try {
                const wsId = localStorage.getItem('quantedge_active_workspace') || 'default';
                const raw = localStorage.getItem(`quantedge_journal_${wsId}`);
                if (!raw) return null;
                const entries = JSON.parse(raw);
                const myEntries = entries.filter(e => e.ticker === sel.ticker);
                if (myEntries.length === 0) return null;
                const totalShares = myEntries.reduce((s, e) => s + (Number(e.shares) || 0), 0);
                const totalCost = myEntries.reduce((s, e) => {
                  const sh = Number(e.shares) || 0;
                  const cb = e.costBasis != null ? Number(e.costBasis) : Number(e.anchorPrice) || 0;
                  return s + sh * cb;
                }, 0);
                const curPrice = Number(sel.price) || 0;
                const curValue = totalShares * curPrice;
                const gain = curValue - totalCost;
                const gainPct = totalCost > 0 ? (gain / totalCost * 100) : 0;
                const cur = currencySymbol(sel.currency);
                return (
                  <div id="detail-myposition" className="glass-card border border-cyan-500/25 bg-cyan-500/[0.03] px-3 py-2 flex items-center gap-3 flex-wrap scroll-mt-12">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Briefcase size={12} className="text-cyan-400" />
                      <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{t('我的持仓')}</span>
                      <span className="text-[9px] text-[#778] font-mono">{myEntries.length} {t('条记录')}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] tabular-nums">
                      {totalShares > 0 && (
                        <>
                          <div><span className="text-[#778]">{t('股数')} </span><span className="text-white font-mono">{totalShares}</span></div>
                          <div><span className="text-[#778]">{t('均价')} </span><span className="text-white font-mono">{cur}{(totalCost/totalShares).toFixed(2)}</span></div>
                          <div><span className="text-[#778]">{t('市值')} </span><span className="text-white font-mono">{cur}{curValue.toFixed(0)}</span></div>
                          <div><span className="text-[#778]">{t('盈亏')} </span><span className={`font-mono font-bold ${gain >= 0 ? 'text-up' : 'text-down'}`}>{gain >= 0 ? '+' : ''}{cur}{gain.toFixed(0)} ({gain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%)</span></div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "journal" }))}
                      className="ml-auto text-[9px] px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-400/20 transition shrink-0"
                    >{t('打开日志')} →</button>
                  </div>
                );
              } catch { return null; }
            })()}

            {/* C7: 详情 Tab 锚点导航条 */}
            <div className="flex items-center gap-1 sticky top-0 z-10 px-1 py-1.5 -mt-1 mb-1 backdrop-blur-md bg-[var(--bg-card)]/85 border-b border-white/5 rounded-t overflow-x-auto">
              {[
                { id: "overview", label: t("综合") },
                { id: "fundamental", label: t("基本面") },
                { id: "technical", label: t("技术面") },
                { id: "liquidity", label: t("资金面") },
                { id: "myposition", label: t("我的持仓") },
              ].map((tabItem) => {
                const isActive = activeSection === tabItem.id;
                return (
                  <button
                    key={tabItem.id}
                    onClick={() => {
                      const target = document.getElementById(`detail-${tabItem.id}`);
                      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`relative px-2.5 py-1 text-[10px] font-medium rounded-md transition-all whitespace-nowrap shrink-0 ${
                      isActive
                        ? "text-white bg-white/[0.06]"
                        : "text-[#a0aec0] hover:text-white hover:bg-white/[0.04]"
                    }`}
                  >
                    {tabItem.label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-2.5 right-2.5 -bottom-0.5 h-[2px] rounded-full"
                        style={{ background: 'var(--brand-gradient)' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── KPI 速览条（综合评分 + 关键因子） ── */}
            <div id="detail-overview" className="grid grid-cols-2 sm:grid-cols-4 gap-2 scroll-mt-12">
              {/* S6: 综合评分 + 鼠标悬停展示子分数构成 */}
              <div className="glass-card p-2.5 group relative cursor-help">
                <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                  {t('综合评分')}
                  <Info size={9} className="opacity-40 group-hover:opacity-80 transition" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.score?.toFixed(1)}</span>
                  <span className="text-[10px] text-[#778] font-mono">/100</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${sel.score}%`, background: sel.score >= 80 ? "var(--accent-up)" : sel.score >= 60 ? "var(--accent-amber)" : "var(--accent-down)" }} />
                </div>
                {/* 子分数 Tooltip */}
                {sel.subScores && Object.keys(sel.subScores).length > 0 && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 hidden group-hover:block pointer-events-none">
                    <div className="glass-card p-2 min-w-[180px] border border-indigo-500/30 shadow-xl">
                      <div className="text-[9px] text-indigo-300 uppercase tracking-wider mb-1.5 font-medium">{t('分数构成')}</div>
                      <div className="space-y-1">
                        {Object.entries(sel.subScores).map(([k, v]) => {
                          const labelMap = { valuation: t('估值'), profitability: t('盈利'), growth: t('成长'), cost: t('成本'), liquidity: t('流动性'), diversification: t('分散'), momentum: t('动量'), trend: t('趋势'), rsi: 'RSI' };
                          const label = labelMap[k] || k;
                          const pct = Math.max(0, Math.min(100, Number(v) || 0));
                          // 用 CSS 语义 token（之前硬编码 Tailwind 默认 hex 绕过了项目调色板）
                          const color = pct >= 80 ? 'var(--accent-up)' : pct >= 60 ? 'var(--accent-amber)' : 'var(--accent-down)';
                          return (
                            <div key={k} className="flex items-center gap-2">
                              <span className="text-[9px] text-[#a0aec0] w-10 shrink-0">{label}</span>
                              <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                              </div>
                              <span className="text-[9px] font-mono tabular-nums w-8 text-right" style={{ color }}>{pct.toFixed(0)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[9px] text-[#666]">{t('加权综合 = 各因子加权平均')}</div>
                    </div>
                  </div>
                )}
              </div>
              {sel.isETF ? (
                <>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">{t('总费率')}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.expenseRatio ?? '—'}</span>
                      {sel.expenseRatio != null && <span className="text-[10px] text-[#778] font-mono">%</span>}
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.expenseRatio == null ? t('暂无') : sel.expenseRatio <= 0.5 ? t('低成本') : sel.expenseRatio <= 1 ? t('中等') : t('偏高')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">AUM</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white truncate">{sel.aum || '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{t('资产规模')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">{t('动量')}</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.momentum >= 70 ? 'text-up' : sel.momentum >= 40 ? 'text-white' : 'text-down'}`}>{sel.momentum ?? '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.momentum == null ? t('暂无') : sel.momentum >= 70 ? t('强势') : sel.momentum >= 40 ? t('中性') : t('弱势')}</div>
                  </div>
                </>
              ) : (
                <>
                  <div id="detail-fundamental" className="glass-card p-2.5 scroll-mt-12">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">P/E</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.pe != null && sel.pe > 0 ? sel.pe.toFixed(1) : '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.pe == null || sel.pe <= 0 ? t('暂无') : sel.pe < 15 ? t('低估') : sel.pe < 30 ? t('合理') : t('高估')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">ROE</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.roe != null && sel.roe >= 15 ? 'text-up' : 'text-white'}`}>{sel.roe != null ? sel.roe.toFixed(1) : '—'}</span>
                      {sel.roe != null && <span className="text-[10px] text-[#778] font-mono">%</span>}
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.roe == null ? t('暂无') : sel.roe >= 20 ? t('优秀') : sel.roe >= 10 ? t('良好') : t('一般')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">RSI(14)</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.rsi > 70 ? 'text-down' : sel.rsi < 30 ? 'text-up' : 'text-white'}`}>{sel.rsi ?? '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.rsi == null ? t('暂无') : sel.rsi > 70 ? t('超买') : sel.rsi < 30 ? t('超卖') : t('中性')}</div>
                  </div>
                </>
              )}
            </div>

            {/* AI 解读卡（B1 - DeepSeek 集成）— ScoreExplainCard 已前置到详情头部紧贴评分块 */}
            {!sel.isETF && (
              <div>
                <AIStockSummaryCard stock={sel} />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:flex-1 md:min-h-0">
              <div className="flex flex-col gap-3 md:overflow-auto md:min-h-0 pr-0 md:pr-1">
                {/* ── 多因子雷达图 ── */}
                <div
                  id="detail-radar"
                  className={`glass-card p-3 relative group/drag cursor-move transition-all scroll-mt-12 ${draggingCard === 'radar' ? 'opacity-40 scale-95' : ''}`}
                  style={{ order: cardOrder.indexOf('radar') }}
                  draggable
                  onDragStart={() => setDraggingCard('radar')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleCardDrop('radar')}
                  onDragEnd={() => setDraggingCard(null)}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                    <GripVertical size={11} className="text-[#778]" />
                  </div>
                  <div className="section-header">
                    <Star size={11} className="text-indigo-400" />
                    <span className="section-title">{sel.isETF ? t("ETF 评估雷达") : t("多因子雷达")}</span>
                  </div>
                  <ResponsiveContainer key={`radar-${sel.ticker}`} width="100%" height={160}>
                    <RadarChart data={radar}>
                      <defs>
                        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={sel.isETF ? "#f59e0b" : "#8A2BE2"} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={sel.isETF ? "#f59e0b" : "#4169E1"} stopOpacity={0.08} />
                        </radialGradient>
                      </defs>
                      <PolarGrid stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                      <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 500 }} />
                      <Radar dataKey="value" stroke={sel.isETF ? "#f59e0b" : "#8A2BE2"} fill="url(#radarFill)" strokeWidth={2.5}
                        dot={{ r: 4, fill: "var(--radar-dot-fill)", stroke: sel.isETF ? "#f59e0b" : "#8A2BE2", strokeWidth: 2.5, filter: `drop-shadow(0 0 4px ${sel.isETF ? "rgba(245,158,11,0.6)" : "rgba(138,43,226,0.6)"})` }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* ── 52周价格区间 + 技术信号 ── */}
                <div
                  id="detail-technical"
                  className={`glass-card p-3 relative group/drag cursor-move transition-all scroll-mt-12 ${draggingCard === 'range52w' ? 'opacity-40 scale-95' : ''}`}
                  style={{ order: cardOrder.indexOf('range52w') }}
                  draggable
                  onDragStart={() => setDraggingCard('range52w')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleCardDrop('range52w')}
                  onDragEnd={() => setDraggingCard(null)}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                    <GripVertical size={11} className="text-[#778]" />
                  </div>
                  <div className="section-header">
                    <TrendingUp size={11} className="text-indigo-400" />
                    <span className="section-title">{t('52周价格区间')}</span>
                  </div>
                  {sel.week52Low != null && sel.week52High != null && (() => {
                    const lo = sel.week52Low, hi = sel.week52High;
                    const range = hi - lo || 1;
                    const pct = Math.max(0, Math.min(100, ((sel.price - lo) / range) * 100));
                    const currSymbol = currencySymbol(sel.currency);
                    return (
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1.5">
                          <span className="text-down font-mono">{currSymbol}{lo}</span>
                          <span className="text-up font-mono">{currSymbol}{hi}</span>
                        </div>
                        <div className="relative w-full h-3 rounded-full overflow-visible">
                          {/* Background track with gradient */}
                          <div className="absolute inset-0 h-1.5 top-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-down/30 via-amber-500/30 to-up/30" />
                          {/* Tick marks at 0/25/50/75/100% */}
                          {[0, 25, 50, 75, 100].map(tick => (
                            <div key={tick} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${tick}%` }}>
                              <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[9px] text-[#778]">{tick}</span>
                            </div>
                          ))}
                          {/* Floating pill slider for current price */}
                          <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-300" style={{ left: `calc(${pct}% - 18px)` }}>
                            <div className="px-1.5 py-0.5 rounded-full bg-indigo-500 text-[9px] font-mono text-white font-medium shadow-md shadow-indigo-500/30 whitespace-nowrap">
                              {pct.toFixed(0)}%
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] mt-4">
                          <span className="text-[#a0aec0]">{t('52周低')}</span>
                          <span className="font-mono text-white font-medium">{currSymbol}{sel.price}</span>
                          <span className="text-[#a0aec0]">{t('52周高')}</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* 技术信号小标签 */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {sel.rsi != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.rsi > 70 ? "text-down bg-down/10 border-down/20" :
                        sel.rsi < 30 ? "text-up bg-up/10 border-up/20" :
                        "text-[#a0aec0] bg-white/5 border-white/10"
                      }`}>
                        <Activity size={9} />
                        RSI {sel.rsi} {sel.rsi > 70 ? t("超买") : sel.rsi < 30 ? t("超卖") : t("中性")}
                      </span>
                    )}
                    {sel.momentum != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.momentum >= 70 ? "text-up bg-up/10 border-up/20" :
                        sel.momentum <= 30 ? "text-down bg-down/10 border-down/20" :
                        "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      }`}>
                        <TrendingUp size={9} />
                        {t('动量')} {sel.momentum}
                      </span>
                    )}
                    {sel.beta != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.beta > 1.5 ? "text-down bg-down/10 border-down/20" :
                        sel.beta < 0.8 ? "text-up bg-up/10 border-up/20" :
                        "text-[#a0aec0] bg-white/5 border-white/10"
                      }`}>
                        <Zap size={9} />
                        Beta {sel.beta}
                      </span>
                    )}
                    {sel.change != null && Math.abs(safeChange(sel.change)) > 3 && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        safeChange(sel.change) > 0 ? "text-up bg-up/10 border-up/20" : "text-down bg-down/10 border-down/20"
                      }`}>
                        {safeChange(sel.change) > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                        {t('日内')} {safeChange(sel.change) > 0 ? "+" : ""}{fmtChange(sel.change)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* ── 评分拆解 ── */}
                {sel.subScores && (
                  <div
                    className={`glass-card p-3 relative group/drag cursor-move transition-all ${draggingCard === 'scoreBreakdown' ? 'opacity-40 scale-95' : ''}`}
                    style={{ order: cardOrder.indexOf('scoreBreakdown') }}
                    draggable
                    onDragStart={() => setDraggingCard('scoreBreakdown')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleCardDrop('scoreBreakdown')}
                    onDragEnd={() => setDraggingCard(null)}
                  >
                    <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                      <GripVertical size={11} className="text-[#778]" />
                    </div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-medium text-[#a0aec0]">{t('评分归因')}</span>
                      <span className="text-xs font-mono font-bold text-white">{sel.score}<span className="text-[10px] text-[#a0aec0] font-normal">/100</span></span>
                    </div>
                    <div className="space-y-2.5">
                      {(sel.isETF ? [
                        [t("成本"), sel.subScores.cost, "indigo", sectorMedians?.cost,
                          [
                            sel.expenseRatio != null && [t('费率'), `${sel.expenseRatio}%`],
                          ].filter(Boolean)],
                        [t("流动性"), sel.subScores.liquidity, "violet", sectorMedians?.liquidity,
                          [
                            sel.aum && ['AUM', sel.aum],
                            sel.adv && [t('日均'), sel.adv],
                          ].filter(Boolean)],
                        [t("分散"), sel.subScores.diversification, "amber", sectorMedians?.diversification,
                          [
                            sel.concentrationTop3 != null && ['Top3', `${sel.concentrationTop3}%`],
                          ].filter(Boolean)],
                        [t("动量"), sel.subScores.momentum, "cyan", sectorMedians?.momentum,
                          [
                            sel.momentum != null && [t('动量'), sel.momentum],
                          ].filter(Boolean)],
                        [t("趋势"), sel.subScores.trend, "up", sectorMedians?.trend, []],
                        ["RSI", sel.subScores.rsi, "violet", sectorMedians?.rsi,
                          [
                            sel.rsi != null && ['RSI', typeof sel.rsi === 'number' ? sel.rsi.toFixed(0) : sel.rsi],
                          ].filter(Boolean)],
                      ] : [
                        [t("估值"), sel.subScores.valuation, "indigo", sectorMedians?.valuation,
                          [
                            sel.pe != null && sel.pe > 0 && ['PE', sel.pe.toFixed(1)],
                            sel.pb != null && ['PB', sel.pb.toFixed(2)],
                          ].filter(Boolean)],
                        [t("盈利"), sel.subScores.profitability, "violet", sectorMedians?.profitability,
                          [
                            sel.roe != null && ['ROE', `${sel.roe.toFixed(1)}%`],
                            sel.profitMargin != null && [t('利润率'), `${sel.profitMargin.toFixed(1)}%`],
                          ].filter(Boolean)],
                        [t("成长"), sel.subScores.growth, "up", sectorMedians?.growth,
                          [
                            sel.revenueGrowth != null && [t('营收'), `${sel.revenueGrowth.toFixed(1)}%`],
                          ].filter(Boolean)],
                        [t("动量"), sel.subScores.momentum, "cyan", sectorMedians?.momentum,
                          [
                            sel.momentum != null && [t('动量'), sel.momentum],
                          ].filter(Boolean)],
                        [t("趋势"), sel.subScores.trend, "amber", sectorMedians?.trend, []],
                        ["RSI", sel.subScores.rsi, "violet", sectorMedians?.rsi,
                          [
                            sel.rsi != null && ['RSI', typeof sel.rsi === 'number' ? sel.rsi.toFixed(0) : sel.rsi],
                          ].filter(Boolean)],
                      ]).map(([label, value, colorKey, peerMed, subInds]) => {
                        const delta = peerMed != null && Number.isFinite(value) ? +(value - peerMed).toFixed(1) : null;
                        // P3 双轨：综合分由 质量/时机 两轨加权得到，不再按单维度算贡献
                        const weightKey = null;
                        const wPct = 0;
                        const contribution = null;
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-[#a0aec0]">
                                {label}
                                {weightKey && <span className="ml-1 text-[9px] text-[#556] font-mono">{wPct}%</span>}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {delta != null && (
                                  <span className={`text-[9px] font-mono ${delta >= 0 ? 'text-up' : 'text-down'}`} title={t('vs 行业中位')}>
                                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-white">{value}</span>
                                {contribution != null && (
                                  <span className="text-[9px] font-mono text-indigo-300/90" title={t('贡献 = 分值 × 权重')}>
                                    +{contribution.toFixed(1)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: `linear-gradient(90deg, var(--accent-${colorKey}-soft), var(--accent-${colorKey}))` }} />
                              {peerMed != null && (
                                <div className="absolute top-0 h-full w-px bg-white/40" style={{ left: `${peerMed}%` }} title={`${t('行业中位')} ${peerMed.toFixed(1)}`} />
                              )}
                            </div>
                            {subInds && subInds.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {subInds.map(([k, v]) => (
                                  <span key={k} className="inline-flex items-center gap-0.5 text-[9px] text-[#778] bg-white/[0.03] border border-white/8 rounded px-1 py-0.5">
                                    <span className="text-[#556]">{k}</span>
                                    <span className="font-mono text-[#a0aec0]">{v}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {sectorMedians && (
                      <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[9px] text-[#778]">
                        <span>{t('vs 行业中位')} · <span className="font-mono">{isZh(lang) ? t(sel.sector) : sel.sector} · {sectorMedians.peerCount} {t('对比')}</span></span>
                        {/* PDF1 推荐：归因卡为主，雷达保留为可切换备选视图 */}
                        <button
                          onClick={() => document.getElementById('detail-radar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                          className="text-indigo-300/80 hover:text-indigo-200 transition-colors"
                          title={t('滚动到雷达图卡')}
                        >
                          {t('切换到雷达视图')} →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="glass-card p-3 overflow-auto">
                {sel.isETF ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="section-header mb-0" style={{ marginBottom: 0, flex: 1 }}>
                        <Database size={11} className="text-indigo-400" />
                        <span className="section-title">{t('ETF 核心指标')}</span>
                      </div>
                      {/* PDF1 P0 收敛：etfType 分类标签用 neutral，不抢 ETF 核心指标的视觉权重 */}
                      <Badge variant={sel.leverage ? "danger" : "default"} size="sm">{t(sel.etfType)}</Badge>
                    </div>
                    <div className="space-y-2">
                      {/* 成本与费用 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-1 mb-0.5">{t('成本与费用')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('总费率 (ER)')}</span>
                        <Badge variant={sel.expenseRatio <= 0.5 ? "success" : sel.expenseRatio <= 1 ? "warning" : "danger"}>{sel.expenseRatio}%</Badge>
                      </div>
                      {sel.leverage ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">{t('年化波动磨损')}</span>
                          <Badge variant={
                            sel.decayRate == null ? "info"
                              : sel.decayRate < 5 ? "success"
                              : sel.decayRate < 15 ? "warning"
                              : "danger"
                          }>
                            {sel.decayRate != null ? `≈ ${sel.decayRate}% / ${t("年")}` : t("数据不足")}
                          </Badge>
                        </div>
                      ) : sel.premiumDiscount != null ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">{t('折溢价率')}</span>
                          <Badge variant={Math.abs(sel.premiumDiscount) < 1 ? "success" : Math.abs(sel.premiumDiscount) < 5 ? "warning" : "danger"}>
                            {sel.premiumDiscount > 0 ? "+" : ""}{sel.premiumDiscount}% {sel.premiumDiscount > 0 ? t("溢价") : sel.premiumDiscount < 0 ? t("折价") : t("平价")}
                          </Badge>
                        </div>
                      ) : null}
                      {sel.nav && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">NAV ({sel.navDate})</span>
                          <Badge variant="info">HK${sel.nav}</Badge>
                        </div>
                      )}
                      {/* 跟踪效果 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('跟踪效果')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('标的指数')}</span>
                        <span className="text-[10px] text-white max-w-[140px] text-right truncate">{sel.benchmark}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('跟踪误差')}</span>
                        <Badge variant={sel.trackingError == null ? "default" : "info"}>{sel.trackingError || t("N/A (主动管理)")}</Badge>
                      </div>
                      {/* 流动性与规模 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('流动性与规模')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">AUM</span>
                        <Badge variant="info">{sel.aum}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('日均成交')}</span>
                        <Badge variant="default">{sel.adv}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('买卖价差')}</span>
                        <Badge variant="default">{sel.bidAskSpread}</Badge>
                      </div>
                      {/* 定性信息 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('定性信息')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('基金管理人')}</span>
                        <span className="text-[10px] text-white">{sel.issuer}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('分红政策')}</span>
                        <Badge variant="default">{sel.dividendPolicy}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('成立日期')}</span>
                        <Badge variant="default">{sel.inceptionDate}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('52周区间')}</span>
                        <Badge variant="info">{currencySymbol(sel.currency)}{sel.week52Low} - {sel.week52High}</Badge>
                      </div>
                      {/* 持仓明细 */}
                      {sel.topHoldings && (
                        <>
                          <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">
                            {t('持仓分布')} ({sel.totalHoldings}{t('只')} · Top3{t('集中度')} {sel.concentrationTop3}%)
                          </div>
                          {sel.topHoldings.map((h, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-white">{h.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-14 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full rounded-full bg-indigo-500/60" style={{ width: `${h.weight}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-[#a0aec0] w-10 text-right">{h.weight}%</span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div id="detail-liquidity" className="section-header scroll-mt-12">
                      <Database size={11} className="text-indigo-400" />
                      <span className="section-title">{t('核心指标 · 真实数据')}</span>
                    </div>
                    <div className="space-y-0">
                      {[
                        ["PE (TTM)", sel.pe ? Number(sel.pe).toFixed(1) : "N/A", sel.pe && sel.pe > 0 && sel.pe < 25 ? "success" : sel.pe && sel.pe > 0 && sel.pe < 50 ? "warning" : "danger"],
                        [t("52周区间"), `${currencySymbol(sel.currency)}${sel.week52Low} – ${sel.week52High}`, "info"],
                        [t("营收增长"), sel.revenueGrowth ? `${sel.revenueGrowth}%` : "N/A", sel.revenueGrowth && sel.revenueGrowth > 20 ? "success" : sel.revenueGrowth && sel.revenueGrowth > 5 ? "warning" : "default"],
                        [t("利润率"), sel.profitMargin ? `${sel.profitMargin}%` : "N/A", sel.profitMargin && sel.profitMargin > 20 ? "success" : sel.profitMargin && sel.profitMargin > 0 ? "warning" : "danger"],
                        [t("年营收"), sel.revenue || "N/A", "info"],
                        [t("市值"), sel.marketCap, "info"],
                        ["EBITDA", sel.ebitda || "N/A", "info"],
                        ["EPS", sel.eps != null ? String(sel.eps) : "N/A", sel.eps != null && !String(sel.eps).startsWith("-") ? "success" : "danger"],
                        ["Beta", sel.beta || "N/A", "default"],
                        [t("下次财报"), sel.nextEarnings || "N/A", "accent"],
                      ].map(([l, v, vt]) => (
                        <div key={l} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                          <span className="text-[11px] text-[#a0aec0]">{l}</span>
                          <Badge variant={vt} size="sm">{v}</Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* xl 桌面 · 常驻对比盘第三栏 — 研究即并排比较（复用真实对比数据，不另起模态）*/}
      <aside className={rightCollapsed ? "hidden" : "hidden xl:flex xl:col-span-3 flex-col min-h-0 rounded-lg border border-white/8 bg-white/[0.015] overflow-hidden"}>
        {(() => {
          const cmp = [...compareSet].map(tk => liveStocks.find(s => s.ticker === tk)).filter(Boolean);
          const primaryTk = compareSet.has(sel?.ticker) ? sel.ticker : cmp[0]?.ticker;
          const subCls = v => v == null ? "text-[#667]" : v >= 80 ? "text-up" : v >= 60 ? "text-[#c9cdda]" : "text-amber-400";
          const ROWS = [
            [t("评分"), s => ({ txt: s.score != null ? s.score.toFixed(0) : "—", cls: s.score >= 75 ? "text-up" : "text-indigo-300" }), "score"],
            [t("质量"), s => ({ txt: s.qualityScore != null ? Math.round(s.qualityScore) : "—", cls: subCls(s.qualityScore) })],
            [t("时机"), s => ({ txt: s.timingScore != null ? Math.round(s.timingScore) : "—", cls: subCls(s.timingScore) })],
            ["PE", s => ({ txt: s.pe ? s.pe.toFixed(1) : "—", cls: "text-[#c9cdda]" })],
            ["ROE", s => ({ txt: s.roe ? `${s.roe.toFixed(0)}%` : "—", cls: "text-[#c9cdda]" })],
            [t("营收YoY"), s => ({ txt: s.revenueGrowth != null ? `${s.revenueGrowth >= 0 ? "+" : ""}${s.revenueGrowth.toFixed(0)}%` : "—", cls: s.revenueGrowth >= 0 ? "text-up" : "text-down" })],
            ["RSI", s => ({ txt: s.rsi != null ? s.rsi.toFixed(0) : "—", cls: "text-[#c9cdda]" })],
            [t("52W位"), s => { const lo = s.week52Low, hi = s.week52High, p = s.price; if (lo == null || hi == null || p == null || hi <= lo) return { txt: "—", cls: "text-[#667]" }; const pos = Math.max(0, Math.min(100, Math.round((p - lo) / (hi - lo) * 100))); return { txt: `P${pos}`, cls: "text-[#c9cdda]" }; }],
          ];
          const exportCSV = () => {
            const lines = [["指标", ...cmp.map(s => s.ticker)].join(",")];
            ROWS.forEach(([label, get]) => lines.push([label, ...cmp.map(s => String(get(s).txt).replace(/,/g, ""))].join(",")));
            const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `compare_${cmp.map(s => s.ticker).join("_")}.csv`; a.click();
            URL.revokeObjectURL(url);
          };
          return (
            <>
              <div className="flex items-center gap-2 px-3 h-11 border-b border-white/8 shrink-0">
                <Layers size={14} className="text-indigo-400" />
                <span className="text-[13px] font-semibold text-white">{t('对比盘')}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">{cmp.length}</span>
                <span className="flex-1" />
                {cmp.length > 0 && (
                  <button onClick={() => setCompareSet(new Set())} title={t('清空对比')} className="text-[#778] hover:text-white transition-colors"><X size={14} /></button>
                )}
                <button onClick={() => setRightPane(true)} title={t('折叠对比盘')} className="text-[#778] hover:text-white transition-colors"><ChevronRight size={14} /></button>
              </div>
              {cmp.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.03] border border-white/8 flex items-center justify-center"><Layers size={18} className="text-[#556]" /></div>
                  <div className="text-[11px] text-[#a0aec0]">{t('勾选标的 · 或右键「加入对比」')}</div>
                  <div className="text-[10px] text-[#667] leading-relaxed px-2">{t('多只标的 8 项因子逐行并排 — 桌面才做得到的并排决策')}</div>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <div className="flex border-b border-white/8">
                      <div className="w-16 shrink-0 h-14" />
                      {cmp.map(s => {
                        const isPri = s.ticker === primaryTk;
                        return (
                          <div key={s.ticker} className={`flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-0.5 relative group ${isPri ? "bg-indigo-500/[0.06]" : ""}`}>
                            <span className="text-[12px] font-mono font-bold text-white">{s.ticker}</span>
                            {isPri
                              ? <span className="text-[8.5px] font-mono px-1.5 py-px rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">{t('主')}</span>
                              : <span className="text-[8px] uppercase tracking-wider text-[#667] font-mono">PIN</span>}
                            <button onClick={() => toggleCompare(s.ticker)} title={t('移出对比')} className="absolute top-1 right-1 text-[#556] opacity-0 group-hover:opacity-100 hover:text-white transition-all"><X size={10} /></button>
                          </div>
                        );
                      })}
                    </div>
                    {ROWS.map(([label, get, kind]) => (
                      <div key={label} className="flex border-b border-white/5 last:border-0">
                        <div className="w-16 shrink-0 h-9 flex items-center px-3 text-[11px] text-[#a0aec0]">{label}</div>
                        {cmp.map(s => {
                          const { txt, cls } = get(s);
                          const isPri = s.ticker === primaryTk;
                          return (
                            <div key={s.ticker} className={`flex-1 min-w-0 h-9 flex items-center justify-center font-mono tabular-nums ${kind === "score" ? "text-[14px] font-bold" : "text-[11.5px]"} ${cls} ${isPri ? "bg-indigo-500/[0.04]" : ""}`}>{txt}</div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/8 shrink-0">
                    <button onClick={exportCSV} className="flex-1 text-center py-1.5 rounded-md text-[11px] font-medium bg-indigo-500/12 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/20 active:scale-[0.98] transition-all">{t('导出对比 CSV')}</button>
                    <span className="text-[9px] text-[#667] shrink-0">{t('右键加入')}</span>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </aside>
    </div>
    {/* 底部工具行：近期财报（可折叠） + 快速添加标的 */}
    {(() => {
      const upcoming = (liveStocks || [])
        .filter(s => s.nextEarnings && !isNaN(new Date(s.nextEarnings).getTime()) && new Date(s.nextEarnings) >= new Date())
        .sort((a, b) => new Date(a.nextEarnings) - new Date(b.nextEarnings))
        .slice(0, 5);
      const showEarnings = upcoming.length > 0;
      const showQuickAdd = apiOnline || standalone;
      if (!showEarnings && !showQuickAdd) return null;
      const today = new Date();
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0 mt-1 items-start">
          {/* 近期财报（折叠式） */}
          {showEarnings && (
            <div className="relative">
              <button
                onClick={() => setEarningsExpanded(v => !v)}
                className={`w-full flex items-center justify-between gap-1.5 py-2 px-3 rounded-lg border text-[11px] transition-all group ${earningsExpanded ? "border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-300" : "border-dashed border-white/10 text-[#a0aec0] hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5"}`}
              >
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} className={earningsExpanded ? "text-indigo-400" : "text-[#778] group-hover:text-indigo-400 transition-colors"} />
                  <span>{t('近期财报')}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#a0aec0]">{upcoming.length}</span>
                </span>
                <ChevronRight size={12} className={`transition-transform ${earningsExpanded ? "-rotate-90" : ""}`} />
              </button>
              {earningsExpanded && (
                <div className="absolute left-0 right-0 bottom-full mb-1 glass-card p-2.5 animate-slide-up z-10">
                  <div className="space-y-1">
                    {upcoming.map(s => {
                      const d = new Date(s.nextEarnings);
                      const days = Math.ceil((d - today) / 86400000);
                      const urgent = days <= 7;
                      const label = displayTicker(s.ticker, s, lang);
                      const isHK = s.ticker?.endsWith(".HK");
                      return (
                        <div key={s.ticker} className="flex items-center justify-between py-0.5 gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-[10px] font-semibold text-white truncate ${isHK ? "" : "font-mono"}`} title={s.ticker}>{label}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-mono text-[#a0aec0]">{s.nextEarnings}</span>
                            <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${urgent ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "text-[#778]"}`}>
                              {days === 0 ? t("今天") : days === 1 ? t("明天") : `${days}${t("天")}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 快速添加标的 */}
          {showQuickAdd && (
            <div className={`relative ${!showEarnings ? "md:col-span-2" : ""}`}>
              {!quickAddOpen ? (
                <button
                  onClick={() => setQuickAddOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-[#778] hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all group"
                >
                  <Plus size={13} className="group-hover:scale-110 transition-transform" />
                  <span>{t('快速添加标的')}</span>
                </button>
              ) : (
                <div data-quickadd-panel className="glass-card p-2 animate-slide-up space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#778]" />
                      <input
                        type="text"
                        autoFocus
                        value={quickAddQuery}
                        onChange={e => setQuickAddQuery(e.target.value)}
                        placeholder={t("输入代码或名称搜索...")}
                        autoCorrect="off" autoCapitalize="none" spellCheck={false}
                        className="w-full bg-white/5 border border-white/10 rounded-md pl-7 pr-2 py-2 md:py-1.5 text-[11px] text-white placeholder-[#667] outline-none focus:border-indigo-500/50 transition-all"
                      />
                    </div>
                    <button onClick={() => { setQuickAddOpen(false); setQuickAddQuery(""); setQuickAddResults([]); }} className="p-1 rounded-md text-[#778] hover:text-white hover:bg-white/10 transition-all">
                      <X size={13} />
                    </button>
                  </div>
                  {quickAddSearching && (
                    <div className="flex items-center justify-center py-2 text-[10px] text-[#778]">
                      <Loader size={12} className="animate-spin mr-1.5" /> {t('搜索中...')}
                    </div>
                  )}
                  {!quickAddSearching && quickAddResults.length > 0 && (
                    <div className="space-y-0.5 max-h-[160px] overflow-auto">
                      {quickAddResults.map(r => (
                        <div key={r.symbol} className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all group ${r.alreadyAdded ? "bg-white/[0.02] opacity-70" : "bg-white/[0.03] hover:bg-white/[0.06]"}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-semibold ${r.alreadyAdded ? "text-[#a0aec0]" : "text-white"}`}>{r.symbol}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300">{r.market || "US"}</span>
                              {r.alreadyAdded && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5"><Check size={8} /> {t('已添加')}</span>}
                              {r.price && <span className="text-[10px] font-mono tabular-nums text-[#a0aec0]">${r.price}</span>}
                            </div>
                            <div className="text-[10px] text-[#778] truncate">{isZh(lang) ? t(STOCK_CN_NAMES[r.symbol] || r.name) : enFallback(r.name, r.symbol)}</div>
                          </div>
                          {r.alreadyAdded ? (
                            <button
                              onClick={() => { setSel(liveStocks.find(s => s.ticker === r.symbol)); setQuickAddOpen(false); setQuickAddQuery(""); setQuickAddResults([]); }}
                              className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:bg-white/10 hover:text-white transition-all"
                            >
                              <Eye size={10} /> {t('查看')}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleQuickAdd(r)}
                              disabled={quickAdding === r.symbol}
                              className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/30 hover:text-indigo-200 disabled:opacity-50 transition-all"
                            >
                              {quickAdding === r.symbol
                                ? <Loader size={10} className="animate-spin" />
                                : <><Plus size={10} /> {t('添加')}</>}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!quickAddSearching && quickAddQuery.trim() && quickAddResults.length === 0 && (
                    <div className="text-center py-2 text-[10px] text-[#778]">{t('未找到匹配标的')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    })()}
    <CompareModal
      open={showCompare}
      onClose={() => setShowCompare(false)}
      stocks={[...compareSet].map(tk => liveStocks.find(s => s.ticker === tk)).filter(Boolean)}
    />
    {/* ── 图表全屏 Modal ── */}
    {chartFullscreen && sel && (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up" onClick={() => setChartFullscreen(false)}>
        <div className="glass-card w-full max-w-6xl h-[85vh] p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" />
              <span className="text-sm font-semibold text-white">{t('价格走势')}</span>
              <span className="text-xs font-mono text-[#a0aec0]">— {sel.ticker}</span>
              {showBenchmark && <span className="text-xs font-mono text-[#94a3b8]">· {benchmarkLabel} {t('基准')}</span>}
              <span className="text-[10px] text-[#778] ml-2">{chartRange}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowBenchmark(v => !v)} className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${showBenchmark ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border-white/10 hover:bg-white/10'}`}>
                {benchmarkLabel} {t('基准')}
              </button>
              <button onClick={() => setChartFullscreen(false)} className="p-1.5 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all">
                <X size={14} />
              </button>
            </div>
          </div>
          {/* 全屏图工具栏：面积/K线 + K线周期(五日/月线/季线/年线)。指标移到左侧竖向栏 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap shrink-0">
            {/* 面积 / K线 */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["area", t("面积")], ["candle", t("K线")]].map(([v, l]) => (
                <button key={v} onClick={() => setChartType(v)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all active:scale-95 ${chartType === v ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{l}</button>
              ))}
            </div>
            {/* K 线周期切换（每根 K 的跨度） —— 放大后直接改周期 */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8 overflow-x-auto max-w-full">
              {[["5D", t("五日")], ["1Y", t("日线")], ["5Y", t("周线")], ["MONK", t("月线")], ["QUARK", t("季线")], ["YEARK", t("年线")]].map(([r, label]) => (
                <button key={r} onClick={() => setChartRange(r)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all active:scale-95 shrink-0 ${chartRange === r ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{label}</button>
              ))}
            </div>
            {/* 线性 / 对数 价格轴（长周期看复利更合理） */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["linear", t("线性")], ["log", t("对数")]].map(([v, l]) => (
                <button key={v} onClick={() => setPriceScale(v)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all active:scale-95 ${priceScale === v ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{l}</button>
              ))}
            </div>
            {/* 画线工具：光标/趋势线/水平线/测量 + 清空 */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["none", t("光标")], ["trend", t("趋势线")], ["hline", t("水平线")], ["measure", t("测量")]].map(([v, l]) => (
                <button key={v} onClick={() => { setDrawTool(v); setDraftPoint(null); setCursorData(null); }}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all active:scale-95 ${drawTool === v ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{l}</button>
              ))}
              {drawings.length > 0 && (
                <button onClick={() => { setDrawings([]); setDraftPoint(null); setCursorData(null); }} title={t("清空画线")} className="ml-0.5 px-1 py-0.5 rounded text-[#889] hover:text-white hover:bg-white/10 inline-flex items-center gap-0.5"><Trash2 size={11} /><span className="text-[10px]">{drawings.length}</span></button>
              )}
            </div>
            {/* 自定义指标周期：MA/EMA + 周期输入 + 添加 */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["sma", "MA"], ["ema", "EMA"]].map(([v, l]) => (
                <button key={v} onClick={() => setCustomType(v)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${customType === v ? "bg-white/15 text-white" : "text-[#a0aec0] hover:text-white"}`}
                >{l}</button>
              ))}
              <input type="number" min="2" max="400" value={customPeriod} onChange={(e) => setCustomPeriod(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { addCustomInd(customType, customPeriod); setCustomPeriod(""); } }}
                placeholder={t("周期")} className="w-12 px-1 py-0.5 rounded bg-white/5 text-[11px] text-white placeholder-[#667] outline-none border border-white/10 focus:border-indigo-500/50" />
              <button onClick={() => { addCustomInd(customType, customPeriod); setCustomPeriod(""); }} title={t("添加指标")} className="px-1 py-0.5 rounded text-indigo-300 hover:bg-indigo-500/20"><Plus size={12} /></button>
            </div>
            {chartType === "candle" && !hasOHLC && (
              <span className="text-[10px] text-[#778] italic">{t("K线数据加载中，刷新后显示")}</span>
            )}
          </div>
          <div className="flex-1 min-h-0 flex gap-1.5">
            {/* 左侧竖向指标栏：MA / EMA / 布林线，点击即叠加（颜色即图例） */}
            <div className="w-[58px] shrink-0 overflow-y-auto flex flex-col gap-0.5 pr-1 border-r border-white/8">
              {INDICATOR_GROUPS.map((g) => (
                <div key={g.name} className="flex flex-col gap-0.5 mb-1">
                  <div className="text-[8px] font-semibold uppercase tracking-wider text-[#667] text-center pt-0.5">{g.name}</div>
                  {INDICATORS.filter((i) => i.group === g.name).map((ind) => {
                    const on = activeInd.has(ind.key);
                    return (
                      <button key={ind.key} onClick={() => toggleInd(ind.key)} title={ind.type === "boll" ? ind.label : `${ind.label}（${ind.period} ${t("根")}）`}
                        className={`w-full px-0.5 py-1 rounded text-[10px] font-medium border transition-all active:scale-95 leading-none ${on ? "" : "border-white/10 text-[#a0aec0] bg-white/5 hover:bg-white/10"}`}
                        style={on ? { color: ind.color, borderColor: `${ind.color}66`, background: `${ind.color}1A` } : undefined}>
                        {ind.type === "boll" ? "BOLL" : ind.label}
                      </button>
                    );
                  })}
                </div>
              ))}
              {(activeInd.size > 0 || customInds.length > 0) && (
                <button onClick={() => { setActiveInd(new Set()); setCustomInds([]); }} title={t("清除全部指标")} className="w-full px-0.5 py-1 rounded text-[9px] text-[#889] hover:text-white hover:bg-white/5 border-t border-white/8 mt-0.5 transition-colors">{t("清除")}</button>
              )}
            </div>
            {/* 图表（relative 容纳常驻图例；onWheel 滚轮缩放 Brush 窗口，平移用底部 Brush 拖拽） */}
            <div
              className="flex-1 min-h-0 relative"
              style={{ cursor: drawTool !== "none" ? "crosshair" : undefined }}
              onWheel={(e) => {
                const len = chartSeries.length;
                if (len < 6) return;
                let s = brushRange?.startIndex ?? 0, en = brushRange?.endIndex ?? len - 1;
                const step = Math.max(1, Math.round((en - s) * 0.2));
                const rect = e.currentTarget.getBoundingClientRect();
                const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                if (e.deltaY < 0) { // 放大：两端向光标收拢
                  const ns = Math.round(s + step * frac), ne = Math.round(en - step * (1 - frac));
                  if (ne - ns >= 4) { s = ns; en = ne; }
                } else {            // 缩小：两端外扩
                  s = Math.round(s - step * frac); en = Math.round(en + step * (1 - frac));
                }
                s = Math.max(0, Math.min(s, len - 5));
                en = Math.min(len - 1, Math.max(en, s + 4));
                setBrushRange(s === 0 && en === len - 1 ? null : { startIndex: s, endIndex: en });
              }}
            >
              {/* 常驻 OHLC + 指标图例（TradingView 式）：默认显示最新点，hover 时原地刷新成光标处读数 */}
              {(() => {
                const d = hoverPoint || lastPoint;
                if (!d) return null;
                const cur = currencySymbol(sel.currency);
                const up = d.o != null ? d.p >= d.o : (d.chg ?? d.pct ?? 0) >= 0;
                const upc = up ? "text-up" : "text-down";
                const fmtVol = (v) => v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${v}`;
                const hasO = d.o != null && d.h > d.l;
                return (
                  <div className="absolute top-1 left-2 z-20 pointer-events-none select-none font-mono leading-tight">
                    <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px]">
                      <span className="font-semibold text-white">{sel.ticker}</span>
                      <span className="text-[#778]">{d.m}</span>
                      {hasO ? [["开", d.o], ["高", d.h], ["低", d.l], ["收", d.p]].map(([k, val]) => (
                        <span key={k} className="text-[#778]">{k}<span className={`ml-0.5 font-semibold ${upc}`}>{cur}{Number(val).toFixed(2)}</span></span>
                      )) : <span className={`font-semibold ${upc}`}>{cur}{Number(d.p).toFixed(2)}</span>}
                      {d.chg != null && <span className={`font-semibold ${d.chg >= 0 ? "text-up" : "text-down"}`}>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(2)}%</span>}
                      {d.v > 0 && <span className="text-[#778]">{t('成交量')} <span className="text-white/80">{fmtVol(d.v)}</span></span>}
                    </div>
                    {activeIndList.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10px]">
                        {activeIndList.map((ind) => {
                          const val = ind.type === "boll" ? d.boll_mid : d[ind.key];
                          return (
                            <span key={ind.key} className="pointer-events-auto inline-flex items-center gap-1 px-1 rounded" style={{ color: ind.color, background: `${ind.color}14` }}>
                              <span className="font-semibold">{ind.type === "boll" ? "BOLL" : ind.label}</span>
                              <span>{val != null ? (Math.round(val * 100) / 100).toLocaleString() : "—"}</span>
                              <button onClick={() => removeInd(ind)} title={t('移除')} className="opacity-60 hover:opacity-100 font-bold">×</button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            <ResponsiveContainer key={`chart-full-${sel.ticker}-${chartRange}-${chartData.length}`} width="100%" height="100%">
              <ComposedChart data={chartSeries} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                onMouseMove={(st) => {
                  const p = st?.activePayload?.[0]?.payload;
                  setHoverPoint((prev) => (p ? (prev && prev.m === p.m ? prev : p) : prev));
                  if (drawTool !== "none" && draftPoint) {
                    const m = st?.activeLabel, yPx = st?.activeCoordinate?.y, inv = chartGeomRef.current?.yScale?.invert;
                    if (m != null && yPx != null && inv) { const price = inv(yPx); setCursorData((c) => (c && c.m === m && Math.abs(c.price - price) < 1e-9 ? c : { m, price })); }
                  }
                }}
                onMouseLeave={() => { setHoverPoint(null); if (!draftPoint) setCursorData(null); }}
                onClick={(st) => {
                  if (drawTool === "none" || !st) return;
                  const yPx = st.activeCoordinate?.y, inv = chartGeomRef.current?.yScale?.invert;
                  if (yPx == null || !inv) return;
                  placePoint({ m: st.activeLabel, price: inv(yPx) });
                }}>
                <defs>
                  <linearGradient id="pgFull" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="strokeGradFull" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8A2BE2" />
                    <stop offset="100%" stopColor="#4169E1" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} minTickGap={40} interval="preserveStartEnd" />
                <YAxis yAxisId="price" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false}
                  domain={priceDomainFinal} ticks={priceTicksFinal} scale={isLogScale ? "log" : "auto"} allowDataOverflow={isLogScale}
                  width={(sel.currency === "KRW" || sel.currency === "JPY") ? 80 : 60}
                  tickFormatter={priceAxisFmt}
                />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} domain={hasVolume ? pctDomainTop : ["auto", "auto"]} ticks={pctTicks} width={60} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                {/* 细网格：只在真实数据区(顶部)出现，因刻度仅落在真实区间，不会穿过底部成交量区 */}
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="0" vertical={false} />
                <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                {/* 最新价标线 + 价签：用 Customized 自绘（见下方 LastPriceLayer），避开 ReferenceLine 函数 label 的不确定性 */}
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length || drawTool !== "none") return null;
                    const d = payload[0].payload;
                    const cur = currencySymbol(sel.currency);
                    const sign = (n) => (n >= 0 ? '+' : '');
                    const fmtVol = (v) => v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${v}`;
                    const upDay = d.o != null ? d.p >= d.o : d.pct >= 0;
                    return (
                      <div className="glass-card border border-indigo-500/40 shadow-2xl px-2.5 py-2 tabular-nums" style={{ minWidth: 210 }}>
                        <div className="text-[9px] text-[#778] uppercase tracking-wider mb-1 font-mono">{label}</div>
                        {d.o != null && d.h > d.l && (
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-1.5 pb-1.5 border-b border-white/10 font-mono">
                            {[[t("开盘"), d.o], [t("最高"), d.h], [t("最低"), d.l], [t("收盘"), d.p]].map(([k, val]) => (
                              <div key={k} className="flex items-baseline justify-between gap-2">
                                <span className="text-[9px] text-[#778] shrink-0">{k}</span>
                                <span className={`text-[11px] font-semibold leading-tight ${upDay ? "text-up" : "text-down"}`}>{Number(val).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                          <div>
                            <div className="text-[9px] text-[#778] uppercase">{t('价格')}</div>
                            <div className="text-sm font-bold font-mono text-white leading-tight">{cur}{Number(d.p).toFixed(2)}</div>
                          </div>
                          {d.chg != null && (
                            <div>
                              <div className="text-[9px] text-[#778] uppercase">{t('当日')}</div>
                              <div className={`text-sm font-bold font-mono leading-tight ${d.chg >= 0 ? 'text-up' : 'text-down'}`}>{sign(d.chg)}{Number(d.chg).toFixed(2)}%</div>
                            </div>
                          )}
                          <div>
                            <div className="text-[9px] text-[#778] uppercase">{t('区间')}</div>
                            <div className={`text-sm font-bold font-mono leading-tight ${d.pct >= 0 ? 'text-up' : 'text-down'}`}>{sign(d.pct)}{Number(d.pct).toFixed(2)}%</div>
                          </div>
                          {d.v != null && d.v > 0 && (
                            <div>
                              <div className="text-[9px] text-[#778] uppercase">{t('成交量')}</div>
                              <div className="text-xs font-mono text-white/90 leading-tight">{fmtVol(d.v)}</div>
                            </div>
                          )}
                          {d.bpct != null && (
                            <div>
                              <div className="text-[9px] text-[#778] uppercase">{benchmarkLabel}</div>
                              <div className={`text-xs font-mono leading-tight ${d.bpct >= 0 ? 'text-up' : 'text-down'}`}>{sign(d.bpct)}{Number(d.bpct).toFixed(2)}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }} />
                {/* 成交量副图：Customized 自绘，落在 plot 底部 ~26%，跟随 Brush 缩放 */}
                {hasVolume && <Customized component={(p) => <VolumeLayer {...p} data={chartSeries} volMax={volMax} />} />}
                {/* 价格主序列：蜡烛 K线 或 面积线 */}
                {showCandle ? (
                  <Bar yAxisId="price" dataKey="hl" shape={<CandleShape />} isAnimationActive={false} />
                ) : (
                  <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGradFull)" : "#FF6B6B"} strokeWidth={2.5} fill="url(#pgFull)" dot={false} activeDot={{ r: 5, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2 }} />
                )}
                {/* 技术指标叠加：MA/EMA 各一条线；布林线 = 上/中/下三条（中轨虚线） */}
                {activeIndList.flatMap((ind) => ind.type === "boll" ? [
                  <Line key="boll_up" yAxisId="price" type="monotone" dataKey="boll_up" stroke={ind.color} strokeOpacity={0.55} strokeWidth={1.2} dot={false} connectNulls activeDot={false} isAnimationActive={false} name={t("BOLL 上轨")} />,
                  <Line key="boll_mid" yAxisId="price" type="monotone" dataKey="boll_mid" stroke={ind.color} strokeWidth={1.4} strokeDasharray="4 3" dot={false} connectNulls activeDot={false} isAnimationActive={false} name={t("BOLL 中轨")} />,
                  <Line key="boll_low" yAxisId="price" type="monotone" dataKey="boll_low" stroke={ind.color} strokeOpacity={0.55} strokeWidth={1.2} dot={false} connectNulls activeDot={false} isAnimationActive={false} name={t("BOLL 下轨")} />,
                ] : [
                  <Line key={ind.key} yAxisId="price" type="monotone" dataKey={ind.key} stroke={ind.color} strokeWidth={2} strokeDasharray={ind.dash} dot={false} connectNulls activeDot={false} isAnimationActive={false} name={ind.label} />,
                ])}
                <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} />
                {showBenchmark && <Line yAxisId="pct" type="monotone" dataKey="bpct" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 2 }} />}
                {/* 最新价标线 + 左侧价签（按涨跌着色） */}
                {lastClose != null && <Customized component={(p) => <LastPriceLayer {...p} price={lastClose} up={lastUp} priceFmt={priceAxisFmt} />} />}
                {/* PR2 画线底座：ScaleCapture 把 price scale 写进 ref（供 onClick 反推价格）；DrawingLayer 用实时 scale 重绘图元+草稿 */}
                <Customized component={(p) => <ScaleCapture {...p} geomRef={chartGeomRef} />} />
                <Customized component={(p) => <DrawingLayer {...p} drawings={drawings} draft={draftPoint ? { type: drawTool === "measure" ? "measure" : "trend", a: draftPoint, color: drawTool === "measure" ? "#f59e0b" : "#e5e7eb" } : null} cursor={cursorData} priceFmt={priceAxisFmt} indexOf={indexOfLabel} />} />
                {/* 十字光标轴标签（价格/日期药丸 + 横向参考线）；画在最上层 */}
                <Customized component={(p) => <CrosshairLayer {...p} point={hoverPoint} priceFmt={priceAxisFmt} />} />
                {/* 缩放/平移：滚轮缩放(上方 onWheel) + 底部 Brush 拖拽平移；受控 startIndex/endIndex */}
                <Brush dataKey="m" height={24} stroke="#6366f1" fill="rgba(99,102,241,0.04)" travellerWidth={8} tickFormatter={() => ""}
                  startIndex={brushRange?.startIndex} endIndex={brushRange?.endIndex}
                  onChange={(r) => { if (r && r.startIndex != null && r.endIndex != null) setBrushRange({ startIndex: r.startIndex, endIndex: r.endIndex }); }}>
                  <AreaChart>
                    <YAxis hide domain={["auto", "auto"]} />
                    <Area dataKey="p" stroke="#6366f1" fill="rgba(99,102,241,0.18)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </Brush>
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-[#778] shrink-0">
            <span>{t('ESC 或点击外部关闭')}</span>
            {periodReturn !== null && (
              <span>{t('区间收益')} <span className={`font-mono font-bold ${periodReturn >= 0 ? 'text-up' : 'text-down'}`}>{periodReturn >= 0 ? '+' : ''}{periodReturn.toFixed(2)}%</span></span>
            )}
          </div>
        </div>
      </div>
    )}
    {/* F2: 移动端详情页底部固定操作栏（仅 mobileShowDetail + sel 时） */}
    {mobileShowDetail && sel && (
      <div
        className="md:hidden fixed left-0 right-0 z-40 flex items-stretch border-t border-white/10 backdrop-blur-md"
        style={{
          bottom: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'rgba(11, 11, 21, 0.92)',
        }}
        role="toolbar"
        aria-label={t('详情快捷操作')}
      >
        <button
          onClick={() => toggleFav(sel.ticker)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors active:scale-[0.97] ${favorites.has(sel.ticker) ? 'text-amber-400' : 'text-[#a0aec0]'}`}
        >
          <Star size={14} className={favorites.has(sel.ticker) ? 'fill-amber-400' : ''} />
          {favorites.has(sel.ticker) ? t('已关注') : t('关注')}
        </button>
        <div className="w-px bg-white/10 my-1.5" />
        <button
          onClick={() => {
            setCompareSet(prev => {
              const next = new Set(prev);
              if (next.has(sel.ticker)) next.delete(sel.ticker);
              else if (next.size < 4) next.add(sel.ticker);
              return next;
            });
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors active:scale-[0.97] ${compareSet.has(sel.ticker) ? 'text-indigo-300' : 'text-[#a0aec0]'}`}
        >
          <Layers size={14} />
          {compareSet.has(sel.ticker) ? t('已加入对比') : t('加入对比')}
        </button>
        <div className="w-px bg-white/10 my-1.5" />
        <button
          onClick={() => setMobileShowDetail(false)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-[#a0aec0] transition-colors active:scale-[0.97]"
        >
          <ChevronRight size={14} className="rotate-180" />
          {t('返回')}
        </button>
      </div>
    )}
  </div>
  );
};


// ─── MobileAccordion (Monitor 手机端折叠) ─────────────────

export default ScoringDashboard;
