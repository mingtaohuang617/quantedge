// ─────────────────────────────────────────────────────────────
// CharacterProfile — 股性「性格档案」(v5 设计 09)
// ─────────────────────────────────────────────────────────────
// 把孤立指标综合成「一句性格标签 + 六维雷达 + 人话解读 + 相似性格标的」。
// 全部由真实行情数据派生（priceRanges 价格序列 + beta/momentum/avgVolume），
// 无后端依赖；数据不足时优雅降级（trait=null → 显示「数据有限」），不造假。
// ─────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { Flame } from "lucide-react";
import { useLang } from "../../i18n.jsx";

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 从 stock.priceRanges 取最长的价格序列（升序 p 值数组） */
function bestSeries(stock) {
  const pr = stock?.priceRanges;
  if (!pr) return [];
  let best = [];
  for (const k of ["ALL", "5Y", "1Y", "YTD", "6M", "1M"]) {
    const arr = pr[k];
    if (Array.isArray(arr) && arr.length > best.length) best = arr;
  }
  return best.map((d) => Number(d.p)).filter((v) => Number.isFinite(v) && v > 0);
}

/** 真实派生六维性格 + 标签 + 行为统计。返回 null 表示数据完全不足。 */
export function deriveCharacter(stock) {
  if (!stock) return null;
  const prices = bestSeries(stock);
  const beta = Number.isFinite(stock.beta) ? stock.beta : null;
  const momentum = Number.isFinite(stock.momentum) ? stock.momentum : null;

  // —— 用稳健标量字段派生 ——
  // priceRanges 为非日频粗采样，其 return 统计（波动/峰度/自相关）不可靠，故弃用；
  // 改用 β / 52周高低 / 动量 / 成交额 这些稳定字段，宁可保守也不造假。
  const hi = Number(stock.week52High), lo = Number(stock.week52Low), px = Number(stock.price);
  const rangeW = (hi > 0 && lo > 0 && hi > lo) ? (hi - lo) / ((hi + lo) / 2) : null; // 52周振幅宽度：~0.3 稳 / ~1.2 狂
  const pos52 = (hi > lo && px > 0) ? clamp01((px - lo) / (hi - lo)) : null;           // 0=贴52周低 1=贴52周高
  const dollarVol = (Number(stock.avgVolume) || 0) * (px || 0);
  const betaV = beta != null ? clamp01(beta / 2.2) : null;
  const rangeV = rangeW != null ? clamp01(rangeW / 1.4) : null;
  const basisN = Array.isArray(prices) ? prices.length : 0;

  // ── 六维 0-1 ──（数据不足的维度返回 null）
  const traits = [
    {
      k: "vol", n: "波动性",
      v: (betaV != null && rangeV != null) ? clamp01(0.5 * betaV + 0.5 * rangeV) : (betaV != null ? betaV : rangeV),
      hint: rangeW != null ? `52周振幅 ${(rangeW * 100).toFixed(0)}%${beta != null ? ` · β ${beta.toFixed(2)}` : ""}` : (beta != null ? `β ${beta.toFixed(2)} 推估` : "数据有限"),
    },
    {
      k: "trend", n: "趋势性",
      v: pos52 != null ? clamp01(0.22 + pos52 * 0.6 + (momentum != null ? Math.sign(momentum) * 0.1 : 0)) : (momentum != null ? clamp01(0.5 + Math.sign(momentum) * 0.2) : null),
      hint: pos52 != null ? `52周位置 ${Math.round(pos52 * 100)}% · ${pos52 >= 0.7 ? "贴近高位/上行" : pos52 <= 0.3 ? "贴近低位/下行" : "区间中部"}` : (momentum != null ? `动量 ${momentum >= 0 ? "+" : ""}${momentum.toFixed(0)}` : "数据有限"),
    },
    {
      k: "liq", n: "流动性",
      v: dollarVol > 0 ? clamp01((Math.log10(dollarVol) - 6) / 4) : null,
      hint: dollarVol > 0 ? `日均成交 ~$${dollarVol >= 1e9 ? (dollarVol / 1e9).toFixed(1) + "B" : (dollarVol / 1e6).toFixed(0) + "M"}` : "成交额未知",
    },
    {
      k: "rev", n: "均值回归",
      v: pos52 != null ? clamp01(0.72 - Math.abs(pos52 - 0.5) * 1.25) : null,
      hint: pos52 != null ? (Math.abs(pos52 - 0.5) <= 0.18 ? "区间震荡为主" : "趋势单边、少回补") : "数据有限",
    },
    {
      k: "event", n: "事件敏感",
      v: (rangeW != null && beta != null) ? clamp01(0.3 + (rangeW - beta * 0.35) * 0.8) : rangeV,
      hint: (rangeW != null && beta != null) ? `振幅超 β 预期 ${((rangeW - beta * 0.35) * 100).toFixed(0)}pp · ${rangeW - beta * 0.35 > 0.3 ? "个股事件多" : "随大盘为主"}` : "数据有限",
    },
    {
      k: "beta", n: "β 弹性",
      v: betaV,
      hint: beta != null ? `β ${beta.toFixed(2)} · ${beta >= 1.3 ? "放大市场波动" : beta <= 0.8 ? "防御抗跌" : "贴近大盘"}` : "β 未知",
    },
  ];

  const get = (k) => traits.find((t) => t.k === k)?.v;
  const vol = get("vol"), trend = get("trend"), rev = get("rev"), event = get("event"), bta = get("beta");

  // ── 性格标签（结论先行）──
  const highVol = (vol ?? 0.5) >= 0.62;
  const lowVol = (vol ?? 0.5) <= 0.34;
  let label, tone, fit;
  if (highVol && (trend ?? 0) >= 0.6) { label = "高波动 · 趋势型"; tone = "#F5B53C"; fit = "激进型 · 适合顺势 + 严格止损"; }
  else if (highVol && (event ?? 0) >= 0.62) { label = "高波动 · 事件驱动"; tone = "#FF6B6B"; fit = "题材型 · 围绕催化剂交易"; }
  else if (highVol) { label = "高波动 · 投机型"; tone = "#FF6B6B"; fit = "高风险 · 小仓位 + 硬止损"; }
  else if (lowVol && (rev ?? 0) >= 0.55) { label = "低波 · 均值回归"; tone = "#1ED395"; fit = "稳健型 · 适合区间 / 网格"; }
  else if (lowVol && (bta ?? 1) <= 0.85) { label = "防御 · 稳健型"; tone = "#5EE6E6"; fit = "压舱型 · 适合长持 + 定投"; }
  else if ((trend ?? 0) >= 0.58) { label = "温和 · 趋势型"; tone = "#818CF8"; fit = "顺势为主 · 回调加仓"; }
  else if ((rev ?? 0) >= 0.55) { label = "区间 · 震荡型"; tone = "#5EE6E6"; fit = "适合高抛低吸 / 网格"; }
  else { label = "均衡 · 中性型"; tone = "#A0AEC0"; fit = "无明显偏向 · 顺大盘"; }

  // ── 画像段落（由真实字段拼装）──
  const parts = [];
  if (rangeW != null) parts.push(`52 周振幅约 ${(rangeW * 100).toFixed(0)}%`);
  if (beta != null) parts.push(`β ${beta.toFixed(2)}`);
  if (pos52 != null) parts.push(pos52 >= 0.7 ? "现价贴近 52 周高位、趋势偏强" : pos52 <= 0.3 ? "现价贴近 52 周低位" : "处于 52 周区间中部");
  const paragraph = `${parts.join("，") || "可用数据有限"}。${fit.includes("止损") ? "适合顺势 + 严格止损，不适合网格抄底。" : (fit.includes("网格") || fit.includes("区间") || fit.includes("高抛低吸")) ? "适合区间 / 网格，趋势单边段需谨慎。" : "依市场风格灵活应对。"}`;

  // ── 行为统计卡 ──
  const behavioral = [
    { l: "52周振幅", v: rangeW != null ? `${(rangeW * 100).toFixed(0)}%` : "—", sub: highVol ? "波动居前" : "波动温和", c: highVol ? "#F5B53C" : "#C9CDDA" },
    { l: "β 弹性", v: beta != null ? beta.toFixed(2) : "—", sub: (beta ?? 1) >= 1.3 ? "放大大盘" : (beta ?? 1) <= 0.8 ? "抗跌" : "贴近大盘", c: (beta ?? 1) >= 1.3 ? "#FF6B6B" : "#C9CDDA" },
    { l: "动量", v: momentum != null ? `${momentum >= 0 ? "+" : ""}${momentum.toFixed(0)}` : "—", sub: (momentum ?? 0) >= 0 ? "近月偏强" : "近月偏弱", c: (momentum ?? 0) >= 0 ? "#1ED395" : "#FF6B6B" },
    { l: "52周位置", v: pos52 != null ? `${Math.round(pos52 * 100)}%` : "—", sub: pos52 == null ? "—" : pos52 >= 0.7 ? "近高位" : pos52 <= 0.3 ? "近低位" : "区间中部", c: "#C9CDDA" },
  ];

  // 用于相似度的特征向量
  const vector = { vol, trend, rev, event, beta: bta };
  return { label, tone, fit, paragraph, traits, behavioral, vector, basisN };
}

/** 轻量特征向量（用于全池相似度，避免对 543 只逐一算序列）*/
function cheapVector(s) {
  const beta = Number.isFinite(s.beta) ? s.beta : 1;
  const mom = Number.isFinite(s.momentum) ? s.momentum : 0;
  // 52 周位置宽度作为波动代理
  const hi = Number(s.week52High), lo = Number(s.week52Low), px = Number(s.price);
  const rangeW = hi > 0 && lo > 0 ? (hi - lo) / ((hi + lo) / 2) : null;
  return {
    beta: clamp01(beta / 2.2),
    trend: clamp01(0.5 + mom / 60),
    vol: rangeW != null ? clamp01(rangeW / 1.5) : clamp01(beta / 2.2),
  };
}

/** 六维性格雷达 SVG */
function TraitRadar({ traits, tone }) {
  const cx = 130, cy = 120, R = 88;
  const vals = traits.map((t) => (t.v == null ? 0 : t.v));
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r];
  };
  const poly = (arr) => arr.map((r, i) => pt(i, r).map((x) => x.toFixed(1)).join(",")).join(" ");
  return (
    <svg viewBox="0 0 260 248" width="100%" height="100%">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={poly([r, r, r, r, r, r])} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
      ))}
      {traits.map((t, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,.06)" />; })}
      <polygon points={poly(vals)} fill={`${tone}28`} stroke={tone} strokeWidth="1.8" />
      {traits.map((t, i) => { const [x, y] = pt(i, t.v == null ? 0 : t.v); return <circle key={i} cx={x} cy={y} r="3" fill={tone} stroke="#08090E" strokeWidth="1" />; })}
      {traits.map((t, i) => { const [x, y] = pt(i, 1.22); return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fontWeight="600" fill="#C9CDDA">{t.n}</text>; })}
    </svg>
  );
}

export default function CharacterProfile({ stock, allStocks, onPick }) {
  const { t } = useLang();
  const char = useMemo(() => deriveCharacter(stock), [stock]);

  // 相似性格标的：用轻量向量在全池找最近
  const peers = useMemo(() => {
    if (!char || !stock || !Array.isArray(allStocks)) return [];
    const base = cheapVector(stock);
    return allStocks
      .filter((s) => s.ticker !== stock.ticker && !s.isETF)
      .map((s) => {
        const v = cheapVector(s);
        const d = Math.sqrt((v.beta - base.beta) ** 2 + (v.trend - base.trend) ** 2 + (v.vol - base.vol) ** 2);
        return { s, sim: Math.max(0, 1 - d / 1.2) };
      })
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);
  }, [char, stock, allStocks]);

  if (!stock) {
    return (
      <div className="p-3 text-[10px] text-[#7a8497] border-b border-white/8">
        性格档案需行情数据 — 该标的不在已加载的行情池中
      </div>
    );
  }
  if (!char) return null;

  return (
    <div className="p-3 border-b border-white/8" style={{ background: `radial-gradient(ellipse 480px 240px at 90% 0%, ${char.tone}10, transparent)` }}>
      {/* hero: 性格标签 */}
      <div className="text-[9px] uppercase tracking-wider text-[#7a8497] mb-2">{t('性格档案')} · {stock.ticker} · {t('基于 52 周行情与因子（β/动量/区间）')}</div>
      <div className="flex items-center gap-2.5 flex-wrap mb-2">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border" style={{ background: `linear-gradient(135deg, ${char.tone}30, ${char.tone}0c)`, borderColor: `${char.tone}55`, boxShadow: `0 6px 20px -8px ${char.tone}55` }}>
          <Flame size={15} style={{ color: char.tone }} />
          <span className="font-serif font-semibold text-[18px]" style={{ color: char.tone, letterSpacing: "-0.01em" }}>{t(char.label)}</span>
        </span>
        <span className="text-[10px] px-2 py-1 rounded-md border" style={{ color: char.tone, background: `${char.tone}14`, borderColor: `${char.tone}33` }}>{t(char.fit)}</span>
      </div>
      <p className="font-serif text-[12.5px] leading-relaxed text-[#c9cdda] mb-3" style={{ maxWidth: 600 }}>{t(char.paragraph)}</p>

      {/* 雷达 + 人话解读 */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 mb-3">
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 flex flex-col">
          <div className="text-[9px] uppercase tracking-wider text-[#7a8497] mb-1">{t('六维性格雷达')}</div>
          <div className="flex-1 min-h-[180px]"><TraitRadar traits={char.traits} tone={char.tone} /></div>
        </div>
        <div className="flex flex-col gap-1.5">
          {char.traits.map((tr) => (
            <div key={tr.k} className="grid grid-cols-[58px_1fr_34px] items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.018] border border-white/8">
              <span className="text-[11px] text-[#c9cdda] font-medium">{t(tr.n)}</span>
              <div>
                <div className="h-[5px] bg-white/[0.05] rounded-full overflow-hidden mb-1">
                  {tr.v != null && <div className="h-full rounded-full" style={{ width: `${tr.v * 100}%`, background: tr.v >= 0.7 ? "linear-gradient(90deg,#F5B53C,#FFD580)" : tr.v >= 0.4 ? "linear-gradient(90deg,#6366F1,#818CF8)" : "linear-gradient(90deg,#1ED395,#5EE6E6)" }} />}
                </div>
                <span className="text-[9px] text-[#7a8497]">{t(tr.hint)}</span>
              </div>
              <span className="text-[13px] font-mono font-bold text-right" style={{ color: tr.v == null ? "#5a6477" : tr.v >= 0.7 ? "#F5B53C" : "#c9cdda" }}>{tr.v == null ? "—" : Math.round(tr.v * 100)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 行为统计卡 */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {char.behavioral.map((b) => (
          <div key={b.l} className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
            <div className="text-[8.5px] uppercase tracking-wider text-[#7a8497] mb-1">{t(b.l)}</div>
            <div className="font-serif font-semibold text-[18px] leading-none" style={{ color: b.c, letterSpacing: "-0.02em" }}>{b.v}</div>
            <div className="text-[9px] text-[#7a8497] mt-1">{t(b.sub)}</div>
          </div>
        ))}
      </div>

      {/* 相似性格标的 */}
      {peers.length > 0 && (
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/90">{t('相似性格的标的')}</span>
            <span className="text-[9px] text-[#7a8497]">{t('性格距离最近 · 可复用同套策略')}</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {peers.map(({ s, sim }) => (
              <button key={s.ticker} onClick={() => onPick?.(s.ticker)} className="text-left rounded-lg border border-white/8 bg-white/[0.018] p-2 hover:border-white/20 transition">
                <div className="font-mono text-[11px] font-bold text-white truncate">{s.ticker}</div>
                <div className="text-[9px] text-[#7a8497] truncate mb-1.5">{s.nameCN || s.name || ""}</div>
                <div className="flex items-center gap-1">
                  <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${sim * 100}%`, background: `linear-gradient(90deg, ${char.tone}, ${char.tone}aa)` }} />
                  </div>
                  <span className="text-[9px] font-mono" style={{ color: char.tone }}>{Math.round(sim * 100)}%</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
