import { useState, useEffect, useCallback, useMemo } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, PieChart, Pie, Cell, Legend, ComposedChart, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Search, Bell, BookOpen, BarChart3, Activity, Settings, ChevronRight, ChevronDown, Star, AlertTriangle, Clock, Target, Zap, Filter, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Plus, X, Check, Eye, Layers, Globe, Briefcase, Info } from "lucide-react";

// ─── REAL DATA (sourced April 10, 2026) ──────────────────
const STOCKS = [
  {
    ticker: "RKLB", name: "Rocket Lab Corp", market: "US", sector: "航天/国防",
    price: 70.01, change: 3.45, currency: "USD",
    score: 82.5, rank: 1,
    pe: -176.48, roe: -18.5, momentum: 85, rsi: 62,
    revenueGrowth: 38.0, profitMargin: -32.9, ebitda: "-185.5M", marketCap: "39.9B",
    revenue: "602M", eps: "-0.37", beta: 2.41,
    week52High: 99.58, week52Low: 16.73, avgVolume: "25.5M",
    nextEarnings: "2026-05-13",
    priceHistory: [
      { m: "Jan", p: 92 }, { m: "Feb", p: 78 }, { m: "Mar 1", p: 72 },
      { m: "Mar 15", p: 68 }, { m: "Mar 22", p: 73 }, { m: "Mar 29", p: 67 },
      { m: "Apr 1", p: 56 }, { m: "Apr 3", p: 62 }, { m: "Apr 5", p: 66 },
      { m: "Apr 7", p: 68 }, { m: "Apr 9", p: 70 }
    ],
    description: "全球领先的小型运载火箭及航天系统公司，2025年营收6.02亿美元创新高，同比增长38%。积压订单18.5亿美元，同比增长73%。Neutron中型火箭预计2026年Q4首飞。"
  },
  {
    ticker: "NVDA", name: "NVIDIA Corp", market: "US", sector: "半导体/AI",
    price: 181.47, change: 2.23, currency: "USD",
    score: 91.3, rank: 2,
    pe: 37.18, roe: 115.8, momentum: 78, rsi: 58,
    revenueGrowth: 114.2, profitMargin: 61.7, ebitda: "133.2B", marketCap: "4.42T",
    revenue: "130.5B", eps: "4.88", beta: 1.94,
    week52High: 212.19, week52Low: 95.04, avgVolume: "165.6M",
    nextEarnings: "2026-05-27",
    priceHistory: [
      { m: "Jan", p: 188 }, { m: "Feb", p: 178 }, { m: "Mar 1", p: 185 },
      { m: "Mar 15", p: 195 }, { m: "Mar 22", p: 175 }, { m: "Mar 29", p: 165 },
      { m: "Apr 1", p: 168 }, { m: "Apr 3", p: 175 }, { m: "Apr 5", p: 178 },
      { m: "Apr 7", p: 178 }, { m: "Apr 9", p: 182 }
    ],
    description: "全球AI基础设施龙头，数据中心GPU市占率超80%。FY2025营收超1300亿美元，EBITDA利润率61.7%。Blackwell及Rubin架构持续驱动增长，预计2025-2027年AI产品累计营收达1万亿美元。"
  },
  {
    ticker: "SNDK", name: "Sandisk Corp", market: "US", sector: "存储/NAND",
    price: 836.64, change: 7.14, currency: "USD",
    score: 78.8, rank: 3,
    pe: null, roe: -12.4, momentum: 92, rsi: 71,
    revenueGrowth: 10.4, profitMargin: -22.3, ebitda: "-0.8B", marketCap: "123.5B",
    revenue: "7.36B", eps: "-7.50", beta: null,
    week52High: 855.0, week52Low: 28.27, avgVolume: "19.6M",
    nextEarnings: "2026-04-30",
    priceHistory: [
      { m: "Jan", p: 420 }, { m: "Feb", p: 480 }, { m: "Mar 1", p: 550 },
      { m: "Mar 15", p: 620 }, { m: "Mar 22", p: 690 }, { m: "Mar 29", p: 650 },
      { m: "Apr 1", p: 600 }, { m: "Apr 3", p: 700 }, { m: "Apr 5", p: 720 },
      { m: "Apr 7", p: 781 }, { m: "Apr 9", p: 837 }
    ],
    description: "全球NAND闪存存储领导者，2024年从西部数据分拆独立上市。受AI驱动的企业级SSD需求激增，叠加NAND涨价10%，股价一年内飙升超2000%。Bernstein目标价上调至$1,250。"
  },
  {
    ticker: "DRAM", name: "Roundhill Memory ETF", market: "US", sector: "存储/ETF",
    price: 32.01, change: 10.29, currency: "USD",
    score: 74.2, rank: 4,
    isETF: true, etfType: "主题ETF", leverage: null,
    // ETF 专属指标
    expenseRatio: 0.65, premiumDiscount: 0.0, // 新上市，暂无明显折溢价
    trackingDiff: null, trackingError: null, // 主动管理，无跟踪基准
    aum: "183M USD", adv: "5.8M 股", bidAskSpread: "较宽 (新ETF)",
    benchmark: "主动管理 - 无跟踪指数", issuer: "Roundhill Investments",
    dividendPolicy: "暂不分红", inceptionDate: "2026-04-02",
    topHoldings: [
      { name: "Samsung", weight: 25.02 }, { name: "Micron (MU)", weight: 24.13 },
      { name: "SK Hynix", weight: 23.61 }, { name: "Kioxia", weight: 4.98 },
      { name: "SanDisk (SNDK)", weight: 4.65 }
    ],
    concentrationTop3: 72.76, totalHoldings: 9,
    // 保留通用字段（ETF不适用的置null）
    pe: null, roe: null, momentum: 80, rsi: 65,
    revenueGrowth: null, profitMargin: null, ebitda: null, marketCap: "183M",
    revenue: null, eps: null, beta: null,
    week52High: 33.39, week52Low: 26.14, avgVolume: "5.8M",
    nextEarnings: null,
    priceHistory: [
      { m: "Apr 2", p: 28.41 }, { m: "Apr 3", p: 27.5 }, { m: "Apr 4", p: 26.5 },
      { m: "Apr 5", p: 27.8 }, { m: "Apr 6", p: 29 }, { m: "Apr 7", p: 29.44 },
      { m: "Apr 8", p: 30.5 }, { m: "Apr 9", p: 32.01 }
    ],
    description: "2026年4月2日上市的首只存储芯片主题ETF，由Roundhill发行。覆盖全球HBM、DRAM、NAND存储龙头，包括三星(25%)、美光、SK海力士、闪迪等。费率0.65%，AUM 1.83亿美元。"
  },
  {
    ticker: "07709.HK", name: "南方两倍做多海力士", market: "HK", sector: "存储/杠杆ETF",
    price: 27.84, change: -3.47, currency: "HKD",
    score: 68.5, rank: 5,
    isETF: true, etfType: "2倍杠杆ETF", leverage: "2x",
    // ETF 专属指标
    expenseRatio: 2.00, premiumDiscount: 9.74, // NAV 25.37 vs 交易价 27.84
    trackingDiff: null, trackingError: "较高 (杠杆损耗)",
    aum: "10.96B HKD", adv: "高 (杠杆品种)", bidAskSpread: "正常",
    benchmark: "SK Hynix (KRX:000660) 每日2倍", issuer: "CSOP Asset Management",
    dividendPolicy: "不分红", inceptionDate: "2025-10-16",
    nav: 25.37, navDate: "2026-04-09",
    topHoldings: [
      { name: "SK Hynix 掉期合约", weight: 100 }
    ],
    concentrationTop3: 100, totalHoldings: 1,
    // 保留通用字段
    pe: null, roe: null, momentum: 72, rsi: 52,
    revenueGrowth: null, profitMargin: null, ebitda: null, marketCap: "16.8B HKD",
    revenue: null, eps: null, beta: null,
    week52High: 43.06, week52Low: 8.42, avgVolume: "N/A",
    nextEarnings: null,
    priceHistory: [
      { m: "Jan", p: 30 }, { m: "Feb", p: 25 }, { m: "Mar 1", p: 22 },
      { m: "Mar 11", p: 29 }, { m: "Mar 16", p: 30.3 }, { m: "Mar 22", p: 28 },
      { m: "Mar 29", p: 25 }, { m: "Apr 1", p: 22 }, { m: "Apr 5", p: 26 },
      { m: "Apr 7", p: 28 }, { m: "Apr 9", p: 27.84 }
    ],
    description: "CSOP发行的2倍杠杆ETF，追踪SK海力士(KRX:000660)每日表现。2025年10月上市。SK海力士是全球第二大存储芯片制造商，HBM市场份额领先。AUM 109.6亿港元，杠杆产品波动极大。"
  },
  {
    ticker: "00005.HK", name: "汇丰控股", market: "HK", sector: "银行/金融",
    price: 134.40, change: 0.15, currency: "HKD",
    score: 65.8, rank: 6,
    pe: 9.2, roe: 14.8, momentum: 45, rsi: 51,
    revenueGrowth: 3.2, profitMargin: 28.5, ebitda: null, marketCap: "2.23T HKD",
    revenue: "65.9B USD", eps: "7.21 USD", beta: 0.65,
    week52High: 148.00, week52Low: 70.05, avgVolume: "17M",
    nextEarnings: "2026-05-05",
    priceHistory: [
      { m: "Jan", p: 140 }, { m: "Feb", p: 138 }, { m: "Mar 1", p: 135 },
      { m: "Mar 15", p: 125 }, { m: "Mar 22", p: 120 }, { m: "Mar 29", p: 128 },
      { m: "Apr 1", p: 130 }, { m: "Apr 3", p: 128 }, { m: "Apr 5", p: 130 },
      { m: "Apr 7", p: 130 }, { m: "Apr 9", p: 134.4 }
    ],
    description: "全球最大银行之一，总资产3万亿美元。以香港为核心市场，正推进全球业务重组及AI驱动的裁员计划（预计削减10%员工）。Morningstar公允价值HK$149.31，股息率约6.5%。"
  }
];

const ALERTS = [
  { id: 1, type: "price", ticker: "SNDK", message: "创历史新高 $851.57，突破前高 $840.50", time: "14:03", severity: "high" },
  { id: 2, type: "score", ticker: "RKLB", message: "获Citizens分析师升级至Outperform评级", time: "11:30", severity: "high" },
  { id: 3, type: "technical", ticker: "SNDK", message: "RSI 突破 70 进入超买区间，动量评分 92", time: "10:15", severity: "warning" },
  { id: 4, type: "news", ticker: "NVDA", message: "向Anthropic提供$100亿算力合作，含芯片联合开发", time: "09:45", severity: "info" },
  { id: 5, type: "price", ticker: "DRAM", message: "上市仅8天即涨超12%，创52周新高 $33.39", time: "09:30", severity: "high" },
  { id: 6, type: "news", ticker: "RKLB", message: "获美国国防部$190M合同，20次HASTE发射任务", time: "08:00", severity: "info" },
  { id: 7, type: "technical", ticker: "07709.HK", message: "NAV 25.37 vs 交易价 27.84，溢价9.7%", time: "16:00", severity: "warning" },
  { id: 8, type: "news", ticker: "00005.HK", message: "计划未来3-5年裁减约20,000名非客户面对岗位", time: "15:30", severity: "info" },
];

const JOURNAL = [
  {
    id: 1, ticker: "RKLB", name: "Rocket Lab", anchorPrice: 56.00, anchorDate: "2026-04-01",
    currentPrice: 70.01,
    thesis: "Neutron火箭Q4首飞是关键催化剂。积压订单$1.85B同比+73%，SDA Tranche III $816M合同为公司史上最大。SpaceX IPO预计6月，太空板块整体受益。年营收$602M增长38%，但仍亏损，等待规模效应。",
    tags: ["航天", "国防", "SpaceX"], etf: "N/A", sector: "航天"
  },
  {
    id: 2, ticker: "SNDK", name: "Sandisk", anchorPrice: 600.00, anchorDate: "2026-04-01",
    currentPrice: 836.64,
    thesis: "NAND闪存超级周期，AI驱动企业级SSD需求爆发。Bernstein目标价$1,250，甚至看到$3,000的可能性。4/30财报是验证点。从WD分拆后独立运营，NAND价格上涨10%直接利好。",
    tags: ["存储", "NAND", "AI"], etf: "DRAM", sector: "存储"
  },
  {
    id: 3, ticker: "NVDA", name: "NVIDIA", anchorPrice: 165.00, anchorDate: "2026-03-29",
    currentPrice: 181.47,
    thesis: "AI算力需求持续扩大，但短期面临$175-185区间震荡。伊朗局势若缓和将是催化剂。头肩顶形态需关注，若跌破颈线有15%下行风险。5月底财报前定位期开始。PE 37已不算便宜。",
    tags: ["AI", "半导体", "数据中心"], etf: "SMH", sector: "半导体"
  },
  {
    id: 4, ticker: "00005.HK", name: "汇丰控股", anchorPrice: 120.00, anchorDate: "2026-03-22",
    currentPrice: 134.40,
    thesis: "高股息防御标的，股息率约6.5%。业务重组接近尾声，AI裁员降本。Morningstar公允值HK$149。风险在于全球利率下行压缩息差，以及中东局势对贸易融资的影响。",
    tags: ["银行", "高股息", "防御"], etf: "N/A", sector: "银行"
  }
];

const SECTOR_ETF_MAP = {
  "半导体": { etf: "SMH", name: "VanEck Semiconductor ETF", change: 5.2 },
  "存储": { etf: "DRAM", name: "Roundhill Memory ETF", change: 10.29 },
  "航天": { etf: "N/A", name: "无对应ETF（可关注ARKX）", change: null },
  "银行": { etf: "XLF", name: "Financial Select SPDR", change: 0.8 },
  "AI": { etf: "BOTZ", name: "Global X Robotics & AI ETF", change: 3.1 },
};

// ─── Components ───────────────────────────────────────────
const Badge = ({ children, variant = "default" }) => {
  const s = {
    default: "bg-white/5 text-[#8892a4] border border-white/8",
    success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    danger: "bg-red-500/10 text-red-400 border border-red-500/20",
    warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    info: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
    accent: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s[variant]}`}>{children}</span>;
};

const ScoreBar = ({ score, max = 100 }) => {
  const pct = (score / max) * 100;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color }}>{score}</span>
    </div>
  );
};

const TAB_CFG = [
  { id: "scoring", label: "量化评分", icon: BarChart3 },
  { id: "backtest", label: "组合回测", icon: Activity },
  { id: "monitor", label: "实时监控", icon: Bell },
  { id: "journal", label: "投资日志", icon: BookOpen },
];

// ─── Scoring ──────────────────────────────────────────────
const ScoringDashboard = () => {
  const [sel, setSel] = useState(STOCKS[0]);
  const [mkt, setMkt] = useState("ALL");
  const [weights, setWeights] = useState({ fundamental: 40, technical: 30, growth: 30 });
  const [showW, setShowW] = useState(false);

  const filtered = useMemo(() => {
    let list = mkt === "ALL" ? STOCKS : STOCKS.filter(s => s.market === mkt);
    return [...list].sort((a, b) => b.score - a.score);
  }, [mkt]);

  const radar = sel ? (sel.isETF ? [
    { factor: "费率优势", value: sel.expenseRatio <= 0.5 ? 90 : sel.expenseRatio <= 1 ? 70 : sel.expenseRatio <= 2 ? 40 : 20, fullMark: 100 },
    { factor: "折溢价", value: Math.abs(sel.premiumDiscount || 0) < 1 ? 95 : Math.abs(sel.premiumDiscount || 0) < 5 ? 70 : Math.abs(sel.premiumDiscount || 0) < 10 ? 40 : 20, fullMark: 100 },
    { factor: "规模(AUM)", value: parseFloat(sel.aum) > 1000 ? 90 : parseFloat(sel.aum) > 100 ? 60 : 30, fullMark: 100 },
    { factor: "动量", value: sel.momentum, fullMark: 100 },
    { factor: "流动性", value: sel.adv && sel.adv !== "N/A" ? 70 : 40, fullMark: 100 },
    { factor: "集中度风险", value: sel.concentrationTop3 > 70 ? 25 : sel.concentrationTop3 > 50 ? 50 : 80, fullMark: 100 },
  ] : [
    { factor: "PE估值", value: sel.pe && sel.pe > 0 ? Math.max(0, 100 - sel.pe * 0.8) : 20, fullMark: 100 },
    { factor: "ROE", value: sel.roe ? Math.min(100, Math.max(0, sel.roe * 0.8)) : 10, fullMark: 100 },
    { factor: "动量", value: sel.momentum, fullMark: 100 },
    { factor: "RSI", value: sel.rsi, fullMark: 100 },
    { factor: "营收增长", value: sel.revenueGrowth ? Math.min(100, sel.revenueGrowth * 0.6) : 0, fullMark: 100 },
    { factor: "利润率", value: sel.profitMargin ? Math.min(100, Math.max(0, sel.profitMargin * 1.5)) : 0, fullMark: 100 },
  ]) : [];

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      <div className="col-span-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/8">
            {["ALL", "US", "HK"].map(m => (
              <button key={m} onClick={() => setMkt(m)} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${mkt === m ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#8892a4] hover:text-white"}`}>
                {m === "ALL" ? "全部" : m === "US" ? "美股" : "港股"}
              </button>
            ))}
          </div>
          <button onClick={() => setShowW(!showW)} className="ml-auto p-1.5 rounded-lg bg-white/5 border border-white/8 text-[#8892a4] hover:text-white hover:bg-white/10 transition-all">
            <Settings size={14} />
          </button>
        </div>
        {showW && (
          <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3 space-y-2">
            <div className="text-xs font-medium text-[#8892a4] mb-1">因子权重配置</div>
            {Object.entries(weights).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs w-14 text-[#8892a4]">{k === "fundamental" ? "基本面" : k === "technical" ? "技术面" : "成长性"}</span>
                <input type="range" min="0" max="100" value={v} onChange={e => setWeights(p => ({ ...p, [k]: +e.target.value }))} className="flex-1 h-1 accent-indigo-500" />
                <span className="text-xs font-mono w-8 text-right text-white">{v}%</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto space-y-1 pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
          {filtered.map((stk, i) => (
            <button key={stk.ticker} onClick={() => setSel(stk)} className={`w-full text-left p-3 rounded-xl transition-all border ${sel?.ticker === stk.ticker ? "bg-indigo-500/8 border-indigo-500/30 shadow-lg shadow-indigo-500/5" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#8892a4] w-5">{i + 1}</span>
                  <span className="font-semibold text-sm text-white">{stk.ticker}</span>
                  <Badge variant={stk.market === "US" ? "info" : "warning"}>{stk.market}</Badge>
                  {stk.isETF && <Badge variant="warning">ETF</Badge>}
                  {stk.isETF && <Badge variant={stk.leverage ? "danger" : "accent"}>{stk.leverage ? `${stk.leverage}杠杆` : "ETF"}</Badge>}
                </div>
                <span className={`text-xs font-medium ${stk.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {stk.change >= 0 ? "+" : ""}{stk.change}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8892a4] truncate max-w-[140px]">{stk.name}</span>
                <div className="w-28"><ScoreBar score={stk.score} /></div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-7 flex flex-col gap-3">
        {sel && (
          <>
            <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-lg font-bold text-white">{sel.ticker}</h3>
                    <Badge variant="accent">{sel.sector}</Badge>
                    {sel.isETF && <Badge variant={sel.leverage ? "danger" : "warning"}>{sel.etfType}</Badge>}
                  </div>
                  <div className="text-xs text-[#8892a4]">{sel.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold font-mono text-white">{sel.currency === "HKD" ? "HK$" : "$"}{sel.price}</div>
                  <div className={`text-sm font-medium ${sel.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sel.change >= 0 ? "▲" : "▼"} {Math.abs(sel.change)}%
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#8892a4] leading-relaxed mb-3 border-l-2 border-indigo-500/30 pl-2">{sel.description}</p>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sel.priceHistory}>
                    <defs>
                      <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="m" tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={50} />
                    <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} formatter={(v) => [`${sel.currency === "HKD" ? "HK$" : "$"}${v}`, "价格"]} />
                    <Area type="monotone" dataKey="p" stroke="#6366f1" strokeWidth={2} fill="url(#pg)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 flex-1">
              <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3">
                <div className="text-xs font-medium text-[#8892a4] mb-2">{sel.isETF ? "ETF 评估雷达图" : "多因子雷达图"}</div>
                <ResponsiveContainer width="100%" height={180}>
                  <RadarChart data={radar}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="factor" tick={{ fontSize: 9, fill: "#888" }} />
                    <Radar dataKey="value" stroke={sel.isETF ? "#f59e0b" : "#6366f1"} fill={sel.isETF ? "#f59e0b" : "#6366f1"} fillOpacity={0.15} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3 overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
                {sel.isETF ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-medium text-[#8892a4]">ETF 核心指标</span>
                      <Badge variant={sel.leverage ? "danger" : "accent"}>{sel.etfType}</Badge>
                    </div>
                    <div className="space-y-2">
                      {/* 成本与费用 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-1 mb-0.5">成本与费用</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">总费率 (ER)</span>
                        <Badge variant={sel.expenseRatio <= 0.5 ? "success" : sel.expenseRatio <= 1 ? "warning" : "danger"}>{sel.expenseRatio}%</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">折溢价率</span>
                        <Badge variant={Math.abs(sel.premiumDiscount) < 1 ? "success" : Math.abs(sel.premiumDiscount) < 5 ? "warning" : "danger"}>
                          {sel.premiumDiscount > 0 ? "+" : ""}{sel.premiumDiscount}% {sel.premiumDiscount > 0 ? "溢价" : sel.premiumDiscount < 0 ? "折价" : "平价"}
                        </Badge>
                      </div>
                      {sel.nav && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#8892a4]">NAV ({sel.navDate})</span>
                          <Badge variant="info">HK${sel.nav}</Badge>
                        </div>
                      )}
                      {/* 跟踪效果 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">跟踪效果</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">标的指数</span>
                        <span className="text-[10px] text-white max-w-[140px] text-right truncate">{sel.benchmark}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">跟踪误差</span>
                        <Badge variant={sel.trackingError === null ? "success" : "warning"}>{sel.trackingError || "N/A (主动管理)"}</Badge>
                      </div>
                      {/* 流动性与规模 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">流动性与规模</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">AUM</span>
                        <Badge variant="info">{sel.aum}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">日均成交</span>
                        <Badge variant="default">{sel.adv}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">买卖价差</span>
                        <Badge variant="default">{sel.bidAskSpread}</Badge>
                      </div>
                      {/* 定性信息 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">定性信息</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">基金管理人</span>
                        <span className="text-[10px] text-white">{sel.issuer}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">分红政策</span>
                        <Badge variant="default">{sel.dividendPolicy}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">成立日期</span>
                        <Badge variant="default">{sel.inceptionDate}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8892a4]">52周区间</span>
                        <Badge variant="info">{sel.currency === "HKD" ? "HK$" : "$"}{sel.week52Low} - {sel.week52High}</Badge>
                      </div>
                      {/* 持仓明细 */}
                      {sel.topHoldings && (
                        <>
                          <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">
                            持仓分布 ({sel.totalHoldings}只 · Top3集中度 {sel.concentrationTop3}%)
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
                                <span className="text-[10px] font-mono text-[#8892a4] w-10 text-right">{h.weight}%</span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-medium text-[#8892a4] mb-3">核心指标 <span className="text-[10px] opacity-60">(真实数据)</span></div>
                    <div className="space-y-2">
                      {[
                        ["PE (TTM)", sel.pe ? sel.pe.toFixed(1) : "N/A (亏损)", sel.pe && sel.pe > 0 && sel.pe < 25 ? "success" : sel.pe && sel.pe > 0 && sel.pe < 50 ? "warning" : "danger"],
                        ["52周区间", `${sel.currency === "HKD" ? "HK$" : "$"}${sel.week52Low} - ${sel.week52High}`, "info"],
                        ["营收增长 %", sel.revenueGrowth ? `${sel.revenueGrowth}%` : "N/A", sel.revenueGrowth && sel.revenueGrowth > 20 ? "success" : sel.revenueGrowth && sel.revenueGrowth > 5 ? "warning" : "default"],
                        ["利润率 %", sel.profitMargin ? `${sel.profitMargin}%` : "N/A", sel.profitMargin && sel.profitMargin > 20 ? "success" : sel.profitMargin && sel.profitMargin > 0 ? "warning" : "danger"],
                        ["年营收", sel.revenue || "N/A", "info"],
                        ["市值", sel.marketCap, "info"],
                        ["EBITDA", sel.ebitda || "N/A", "info"],
                        ["EPS", sel.eps || "N/A", sel.eps && !sel.eps.startsWith("-") ? "success" : "danger"],
                        ["Beta", sel.beta || "N/A", "default"],
                        ["下次财报", sel.nextEarnings || "N/A", "accent"],
                      ].map(([l, v, vt]) => (
                        <div key={l} className="flex items-center justify-between">
                          <span className="text-xs text-[#8892a4]">{l}</span>
                          <Badge variant={vt}>{v}</Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Backtesting ──────────────────────────────────────────
const BacktestEngine = () => {
  const [running, setRunning] = useState(false);
  const [hasResult, setHasResult] = useState(true);

  const btData = useMemo(() => {
    const data = [];
    let sv = 100, bv = 100;
    const months = ["2024-05","2024-06","2024-07","2024-08","2024-09","2024-10","2024-11","2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04"];
    const stratReturns = [0.03,0.05,-0.02,0.04,0.08,0.12,0.06,-0.03,0.15,0.04,-0.06,0.08,0.10,0.03,-0.04,0.07,0.09,0.05,-0.08,0.12,0.18,-0.05,-0.10,0.15];
    const benchReturns = [0.02,0.03,0.01,0.02,0.01,0.04,0.03,0.02,0.03,0.01,-0.02,0.02,0.01,0.02,0.01,0.03,0.02,0.01,-0.04,0.03,0.02,-0.01,-0.03,0.05];
    months.forEach((m, i) => {
      sv *= (1 + stratReturns[i]);
      bv *= (1 + benchReturns[i]);
      data.push({ date: m, strategy: Math.round(sv * 100) / 100, benchmark: Math.round(bv * 100) / 100 });
    });
    return data;
  }, []);

  const metrics = { totalReturn: 128.5, annualReturn: 52.8, sharpe: 1.92, maxDrawdown: -15.2, calmar: 3.47, winRate: 70.8, volatility: 28.4, sortino: 2.65 };

  const holdings = [
    { ticker: "SNDK", weight: 25, ret: "+39.4%" },
    { ticker: "RKLB", weight: 20, ret: "+25.0%" },
    { ticker: "NVDA", weight: 20, ret: "+10.0%" },
    { ticker: "DRAM", weight: 15, ret: "+12.7%" },
    { ticker: "07709.HK", weight: 10, ret: "-3.5%" },
    { ticker: "00005.HK", weight: 10, ret: "+12.0%" },
  ];

  const run = () => { setRunning(true); setHasResult(false); setTimeout(() => { setRunning(false); setHasResult(true); }, 1800); };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-[#8892a4] mb-1 block">组合策略</label>
            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none">
              <option>存储板块集中</option><option>均衡配置</option><option>高成长优先</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8892a4] mb-1 block">调仓频率</label>
            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none">
              <option>每月</option><option>每两周</option><option>每周</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8892a4] mb-1 block">基准指数</label>
            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none">
              <option>S&P 500 (SPY)</option><option>纳斯达克 (QQQ)</option><option>恒生指数</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8892a4] mb-1 block">成本假设</label>
            <div className="text-xs text-white bg-white/5 border border-white/10 rounded-lg px-2 py-1.5">手续费0.1% + 滑点0.05%</div>
          </div>
          <div className="flex items-end">
            <button onClick={run} disabled={running} className="w-full py-1.5 rounded-lg text-xs font-semibold bg-indigo-500 text-white hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/20">
              {running ? <><RefreshCw size={12} className="animate-spin" /> 回测中...</> : <><Zap size={12} /> 运行回测</>}
            </button>
          </div>
        </div>
      </div>

      {hasResult && (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              ["总收益", `+${metrics.totalReturn}%`, "text-emerald-400", TrendingUp],
              ["年化收益", `+${metrics.annualReturn}%`, "text-emerald-400", Target],
              ["夏普比率", metrics.sharpe, metrics.sharpe > 1.5 ? "text-emerald-400" : "text-amber-400", Star],
              ["最大回撤", `${metrics.maxDrawdown}%`, "text-red-400", TrendingDown],
            ].map(([l, v, c, I]) => (
              <div key={l} className="bg-white/[0.03] rounded-xl border border-white/8 p-3">
                <div className="flex items-center gap-1.5 mb-1"><I size={12} className="text-[#8892a4]" /><span className="text-xs text-[#8892a4]">{l}</span></div>
                <div className={`text-xl font-bold font-mono ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
            <div className="col-span-8 bg-white/[0.03] rounded-xl border border-white/8 p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#8892a4]">组合 vs SPY 净值曲线 (基于6标的真实走势模拟)</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-indigo-400"><span className="w-3 h-0.5 bg-indigo-400 rounded-full inline-block" /> 策略</span>
                  <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-0.5 bg-gray-500 rounded-full inline-block" /> SPY</span>
                </div>
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={btData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#666" }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} />
                    <Line type="monotone" dataKey="strategy" stroke="#6366f1" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="benchmark" stroke="#666" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="col-span-4 flex flex-col gap-3">
              <div className="flex-1 bg-white/[0.03] rounded-xl border border-white/8 p-3">
                <div className="text-xs font-medium text-[#8892a4] mb-2">持仓权重 & 收益</div>
                <div className="space-y-1.5">
                  {holdings.map(h => (
                    <div key={h.ticker} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-white w-20">{h.ticker}</span>
                        <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500/60" style={{ width: `${h.weight}%` }} />
                        </div>
                        <span className="text-[10px] text-[#8892a4]">{h.weight}%</span>
                      </div>
                      <span className={`text-xs font-mono ${h.ret.startsWith("+") ? "text-emerald-400" : "text-red-400"}`}>{h.ret}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3">
                <div className="text-xs font-medium text-[#8892a4] mb-2">扩展指标</div>
                <div className="space-y-1.5">
                  {[["卡玛比率", metrics.calmar], ["索提诺比率", metrics.sortino], ["胜率", `${metrics.winRate}%`], ["波动率", `${metrics.volatility}%`]].map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-xs text-[#8892a4]">{l}</span><span className="text-xs font-mono text-white">{v}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Monitor ──────────────────────────────────────────────
const Monitor = () => {
  const [selSector, setSelSector] = useState("存储");
  const sectors = [
    { name: "存储/NAND", value: 8.5 },
    { name: "半导体/AI", value: 5.2 },
    { name: "航天/国防", value: 3.5 },
    { name: "银行/金融", value: 0.8 },
  ];

  const fearGreed = 58;

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      <div className="col-span-4 flex flex-col gap-3">
        <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
          <div className="text-xs font-medium text-[#8892a4] mb-3">市场情绪指数</div>
          <div className="flex items-center justify-center gap-4">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={fearGreed > 60 ? "#10b981" : fearGreed > 40 ? "#f59e0b" : "#ef4444"} strokeWidth="8" strokeDasharray={`${fearGreed * 2.64} 264`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono text-white">{fearGreed}</span>
                <span className="text-[10px] text-amber-400">中性偏贪</span>
              </div>
            </div>
            <div className="space-y-1.5 text-xs text-[#8892a4]">
              <div>0-25 极度恐惧</div>
              <div>25-50 恐惧</div>
              <div className="text-amber-400 font-medium">50-75 贪婪 ←</div>
              <div>75-100 极度贪婪</div>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
          <div className="text-xs font-medium text-[#8892a4] mb-3">关注板块表现 (今日)</div>
          <div className="space-y-2">
            {sectors.map(s => (
              <button key={s.name} onClick={() => setSelSector(s.name.split("/")[0])} className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selSector === s.name.split("/")[0] ? "bg-indigo-500/10 border border-indigo-500/20" : "hover:bg-white/5 border border-transparent"}`}>
                <span className="text-xs text-white">{s.name}</span>
                <span className={`text-xs font-mono ${s.value >= 0 ? "text-emerald-400" : "text-red-400"}`}>+{s.value}%</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 bg-white/[0.03] rounded-xl border border-white/8 p-4">
          <div className="text-xs font-medium text-[#8892a4] mb-2">板块-ETF 映射</div>
          <div className="text-[10px] text-[#8892a4] mb-3">已选: {selSector}</div>
          {SECTOR_ETF_MAP[selSector] && (
            <div className="space-y-2">
              <div className="text-sm font-bold text-white">{SECTOR_ETF_MAP[selSector].etf}</div>
              <div className="text-[10px] text-[#8892a4]">{SECTOR_ETF_MAP[selSector].name}</div>
              {SECTOR_ETF_MAP[selSector].change && (
                <Badge variant={SECTOR_ETF_MAP[selSector].change >= 0 ? "success" : "danger"}>
                  今日 {SECTOR_ETF_MAP[selSector].change >= 0 ? "+" : ""}{SECTOR_ETF_MAP[selSector].change}%
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="col-span-5 flex flex-col gap-3">
        <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-indigo-400" />
              <span className="text-xs font-medium text-white">智能预警</span>
              <Badge variant="accent">{ALERTS.length}</Badge>
            </div>
            <span className="text-[10px] text-[#8892a4]">基于真实数据</span>
          </div>
          <div className="flex-1 overflow-auto space-y-2" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            {ALERTS.map(a => (
              <div key={a.id} className={`p-3 rounded-lg border transition-all hover:bg-white/[0.02] ${a.severity === "high" ? "border-red-500/20 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{a.ticker}</span>
                    <Badge variant={a.type === "score" ? "accent" : a.type === "technical" ? "warning" : a.type === "price" ? "danger" : "info"}>
                      {a.type === "score" ? "评级" : a.type === "technical" ? "技术" : a.type === "price" ? "价格" : "新闻"}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-[#8892a4] font-mono">{a.time}</span>
                </div>
                <p className="text-xs text-[#8892a4] leading-relaxed">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col-span-3 flex flex-col gap-3">
        <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
          <div className="text-xs font-medium text-[#8892a4] mb-3">标的实时概览</div>
          <div className="space-y-2">
            {STOCKS.map(s => (
              <div key={s.ticker} className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                <span className="text-xs font-mono text-white">{s.ticker}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8892a4]">{s.currency === "HKD" ? "HK$" : "$"}{s.price}</span>
                  <span className={`text-[10px] font-mono ${s.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {s.change >= 0 ? "+" : ""}{s.change}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 bg-white/[0.03] rounded-xl border border-white/8 p-4">
          <div className="text-xs font-medium text-[#8892a4] mb-3">预警规则</div>
          <div className="space-y-3">
            {[
              { label: "SNDK RSI超买", value: "> 70 (当前 71)", active: true },
              { label: "RKLB 评分突变", value: "排名变化 > 3", active: true },
              { label: "07709.HK NAV溢价", value: "> 8%", active: true },
              { label: "00005.HK 财报预警", value: "5月5日", active: false },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-white">{r.label}</div>
                  <div className="text-[10px] text-[#8892a4]">{r.value}</div>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${r.active ? "bg-indigo-500" : "bg-white/10"}`}>
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform ${r.active ? "translate-x-4" : ""}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Journal ──────────────────────────────────────────────
const Journal = () => {
  const [entries] = useState(JOURNAL);
  const [sel, setSel] = useState(JOURNAL[0]);
  const [showAdd, setShowAdd] = useState(false);

  const calcRet = (a, c) => ((c - a) / a * 100).toFixed(2);

  const peerData = sel?.ticker === "RKLB" ? [
    { name: "RKLB", pe: -176, yours: true },
    { name: "FLY", pe: -45 },
    { name: "LUNR", pe: -30 },
    { name: "ASTS", pe: -85 },
  ] : sel?.ticker === "SNDK" ? [
    { name: "SNDK", pe: -105, yours: true },
    { name: "MU", pe: 12 },
    { name: "Samsung", pe: 15 },
    { name: "SK Hynix", pe: 8 },
  ] : sel?.ticker === "NVDA" ? [
    { name: "NVDA", pe: 37, yours: true },
    { name: "AMD", pe: 42 },
    { name: "AVGO", pe: 38 },
    { name: "INTC", pe: 25 },
  ] : [
    { name: "00005", pe: 9.2, yours: true },
    { name: "渣打", pe: 8.5 },
    { name: "恒生", pe: 12.1 },
    { name: "中银", pe: 5.2 },
  ];

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      <div className="col-span-4 flex flex-col gap-3">
        <button onClick={() => setShowAdd(!showAdd)} className="w-full py-2 rounded-xl text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 flex items-center justify-center gap-1.5">
          <Plus size={14} /> 新增看好标的
        </button>
        {showAdd && (
          <div className="bg-white/[0.03] rounded-xl border border-indigo-500/20 p-3 space-y-2">
            <input placeholder="股票代码 (如 AAPL, 0700.HK)" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/20" />
            <textarea placeholder="投资论点..." rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/20 resize-none" />
            <div className="flex gap-2">
              <button className="flex-1 py-1.5 rounded-lg text-xs bg-indigo-500 text-white">记录 (自动锚定当前价)</button>
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-[#8892a4]">取消</button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto space-y-2" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
          {entries.map(e => {
            const ret = calcRet(e.anchorPrice, e.currentPrice);
            const stk = STOCKS.find(s => s.ticker === e.ticker);
            return (
              <button key={e.id} onClick={() => setSel(e)} className={`w-full text-left p-3 rounded-xl transition-all border ${sel?.id === e.id ? "bg-indigo-500/8 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">{e.ticker}</span>
                    <span className={`text-xs font-mono font-medium ${ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {ret >= 0 ? "+" : ""}{ret}%
                    </span>
                  </div>
                  <span className="text-[10px] text-[#8892a4]">{e.anchorDate}</span>
                </div>
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-[10px] text-[#8892a4]">锚定: {stk?.currency === "HKD" ? "HK$" : "$"}{e.anchorPrice}</span>
                  <ChevronRight size={10} className="text-[#8892a4]" />
                  <span className="text-[10px] text-white">现价: {stk?.currency === "HKD" ? "HK$" : "$"}{e.currentPrice}</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {e.tags.map(t => <span key={t} className="px-1.5 py-0.5 bg-white/5 rounded text-[10px] text-[#8892a4]">{t}</span>)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="col-span-8 flex flex-col gap-3">
        {sel && (() => {
          const stk = STOCKS.find(s => s.ticker === sel.ticker);
          const ret = calcRet(sel.anchorPrice, sel.currentPrice);
          return (
            <>
              <div className="bg-white/[0.03] rounded-xl border border-white/8 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Eye size={14} className="text-indigo-400" />
                    <span className="text-xs font-medium text-white">投资论点 — {sel.ticker} {sel.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#8892a4]">记录于 {sel.anchorDate}</span>
                    <span className="text-[10px] text-[#8892a4]">锚定 {stk?.currency === "HKD" ? "HK$" : "$"}{sel.anchorPrice}</span>
                    <Badge variant={ret >= 0 ? "success" : "danger"}>
                      {ret >= 0 ? "+" : ""}{ret}% 自记录
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-[#8892a4] leading-relaxed border-l-2 border-indigo-500/30 pl-3">{sel.thesis}</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3 text-center">
                  <div className="text-[10px] text-[#8892a4] mb-1">锚定价格</div>
                  <div className="text-lg font-bold font-mono text-white">{stk?.currency === "HKD" ? "HK$" : "$"}{sel.anchorPrice}</div>
                </div>
                <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3 text-center">
                  <div className="text-[10px] text-[#8892a4] mb-1">当前价格</div>
                  <div className="text-lg font-bold font-mono text-white">{stk?.currency === "HKD" ? "HK$" : "$"}{sel.currentPrice}</div>
                </div>
                <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3 text-center">
                  <div className="text-[10px] text-[#8892a4] mb-1">收益率</div>
                  <div className={`text-lg font-bold font-mono ${ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>{ret >= 0 ? "+" : ""}{ret}%</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={12} className="text-[#8892a4]" />
                    <span className="text-xs font-medium text-[#8892a4]">行业PE对标</span>
                  </div>
                  <ResponsiveContainer width="100%" height="80%">
                    <BarChart data={peerData} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={60} />
                      <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} />
                      <Bar dataKey="pe" radius={[0, 4, 4, 0]}>
                        {peerData.map((e, i) => <Cell key={i} fill={e.yours ? "#6366f1" : "rgba(255,255,255,0.15)"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white/[0.03] rounded-xl border border-white/8 p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={12} className="text-[#8892a4]" />
                    <span className="text-xs font-medium text-[#8892a4]">关联 ETF & 关键日期</span>
                  </div>
                  <div className="space-y-3">
                    {sel.etf && sel.etf !== "N/A" ? (
                      <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">{sel.etf}</span>
                          {SECTOR_ETF_MAP[sel.sector]?.change && (
                            <Badge variant="success">+{SECTOR_ETF_MAP[sel.sector].change}%</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8892a4]">{SECTOR_ETF_MAP[sel.sector]?.name || sel.etf}</div>
                      </div>
                    ) : (
                      <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                        <div className="text-xs text-[#8892a4]">该板块暂无精确对应ETF</div>
                        <div className="text-[10px] text-[#8892a4] mt-1">可关注 ARKX (太空探索ETF)</div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-[#8892a4] font-medium">关键日期追踪</div>
                      {stk?.nextEarnings && (
                        <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                          <span className="text-xs text-white">下次财报</span>
                          <Badge variant="accent">{stk.nextEarnings}</Badge>
                        </div>
                      )}
                      <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                        <span className="text-xs text-white">记录天数</span>
                        <span className="text-xs font-mono text-[#8892a4]">{Math.floor((new Date() - new Date(sel.anchorDate)) / 86400000)}天</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────
export default function QuantPlatform() {
  const [tab, setTab] = useState("scoring");
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden" style={{
      background: "linear-gradient(145deg, #0a0a14 0%, #0d0d1a 50%, #0a0a14 100%)",
      fontFamily: "'DM Sans', 'Noto Sans SC', sans-serif", color: "#e2e8f0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        select option { background: #1a1a2e; color: #e2e8f0; }
        input[type="range"] { height: 4px; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #6366f1; cursor: pointer; }
      `}</style>

      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/[0.02] backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Briefcase size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">QuantEdge</h1>
            <p className="text-[10px] text-[#8892a4]">综合量化投资平台 · 真实数据</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/5">
          {TAB_CFG.map(t => {
            const I = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${tab === t.id ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#8892a4] hover:text-white hover:bg-white/5"}`}>
                <I size={14} />{t.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[10px] text-[#8892a4]">
            <span>RKLB $70.01</span>
            <span>NVDA $181.47</span>
            <span className="text-emerald-400">SNDK $836.64 ▲</span>
          </div>
          <span className="text-xs font-mono text-[#8892a4]">{time.toLocaleTimeString("en-US", { hour12: false })}</span>
        </div>
      </header>

      <main className="flex-1 p-4 min-h-0 overflow-hidden">
        {tab === "scoring" && <ScoringDashboard />}
        {tab === "backtest" && <BacktestEngine />}
        {tab === "monitor" && <Monitor />}
        {tab === "journal" && <Journal />}
      </main>

      <footer className="flex items-center justify-between px-6 py-2 border-t border-white/5 bg-white/[0.02] flex-shrink-0">
        <div className="flex items-center gap-4 text-[10px] text-[#8892a4]">
          <span>数据来源: Yahoo Finance / Investing.com / TradingView</span>
          <span>数据截至: 2026年4月10日</span>
          <span>覆盖: 美股 (RKLB, NVDA, SNDK, DRAM) + 港股 (07709, 00005)</span>
        </div>
        <span className="text-[10px] text-[#8892a4]">v0.2.0 — 真实数据版</span>
      </footer>
    </div>
  );
}
