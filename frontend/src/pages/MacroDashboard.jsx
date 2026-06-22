// ─────────────────────────────────────────────────────────────
// MacroDashboard — 市场层面宏观因子看板（Phase 1+2）
// 组件已拆到 ../components/macro/*；本文件只负责数据加载 + 组合 + 路由级 state
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Globe, RefreshCw, AlertCircle, Loader, ArrowUp, Maximize2, Minimize2, Share2, Check, FileText, ChevronRight, ChevronLeft, Thermometer } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import { useLang } from "../i18n.jsx";
import useIsMobile from "../hooks/useIsMobile";
import { BottomSheet, MobileAppBar, FullscreenChart } from "../components/mobile";

// 线上快照（production 只能读它，因为 Vercel 上没跑 backend；本地 dev 走实时 API）
// 主动刷新：本地 `cd backend && python export_macro_snapshot.py` → commit → push
import macroSnapshot from "../macroSnapshot.json";

import {
  CATEGORY_LABEL, snapshotStaleness, readStarred, writeStarred, factorStarKey,
  encodeMacroState, decodeMacroState, directionalScore,
} from "../components/macro/shared.js";
import NarrativePanel from "../components/macro/NarrativePanel.jsx";
import CompositePanel from "../components/macro/CompositePanel.jsx";
import HmmPanel from "../components/macro/HmmPanel.jsx";
import SurvivalPanel from "../components/macro/SurvivalPanel.jsx";
import AlertsPanel from "../components/macro/AlertsPanel.jsx";
import CompositeChart from "../components/macro/CompositeChart.jsx";
import FactorCard from "../components/macro/FactorCard.jsx";
import DataStatusBanner from "../components/macro/DataStatusBanner.jsx";
import FactorDetailModal from "../components/macro/FactorDetailModal.jsx";
import TopMovers from "../components/macro/TopMovers.jsx";
import FilterBar from "../components/macro/FilterBar.jsx";
import AlertBacktestPanel from "../components/macro/AlertBacktestPanel.jsx";
import { buildDigest } from "../components/macro/digestBuilder.js";

const USE_SNAPSHOT = import.meta.env.PROD;

export default function MacroDashboard() {
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [factors, setFactors] = useState(null);
  const [composite, setComposite] = useState(null);
  const [history, setHistory] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [range, setRange] = useState("5Y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // filter 持久化到 localStorage — 上次选了 "valuation" 下次进来仍然是它
  const [filter, setFilter] = useState(() => {
    try { return localStorage.getItem("quantedge_macro_filter") || "all"; }
    catch { return "all"; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_macro_filter", filter); } catch {}
  }, [filter]);
  // 方向过滤：all / higher / lower / contrarian
  const [dirFilter, setDirFilter] = useState(() => {
    try { return localStorage.getItem("quantedge_macro_dir_filter") || "all"; }
    catch { return "all"; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_macro_dir_filter", dirFilter); } catch {}
  }, [dirFilter]);
  // 市场过滤：all / US / CN（snapshot 同时含 17 美股 + 6 A股因子）
  const [marketFilter, setMarketFilter] = useState(() => {
    try { return localStorage.getItem("quantedge_macro_market_filter") || "all"; }
    catch { return "all"; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_macro_market_filter", marketFilter); } catch {}
  }, [marketFilter]);
  // 搜索框：按 factor_id / name / description 子串模糊匹配
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);
  // 收藏因子集（factor_id@market 复合键）+ 仅显示收藏切换
  const [starred, setStarred] = useState(() => readStarred());
  const [onlyStarred, setOnlyStarred] = useState(() => {
    try { return localStorage.getItem("quantedge_macro_only_starred") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_macro_only_starred", onlyStarred ? "1" : "0"); } catch {}
  }, [onlyStarred]);
  const toggleStar = (f) => {
    const k = factorStarKey(f);
    setStarred(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      writeStarred(next);
      return next;
    });
  };
  const [selectedFactor, setSelectedFactor] = useState(null);
  // 紧凑视图：隐藏次级面板（HMM/持续期/历史曲线/TopMovers），只保留温度/告警/因子网格
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem("quantedge_macro_compact") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_macro_compact", compact ? "1" : "0"); } catch {}
  }, [compact]);
  const [shared, setShared] = useState(false);  // "已复制 URL" 短暂提示

  // ─── 视图分享：URL hash ↔ filter state ───────────────────
  // 首次挂载时：如果 URL 已有 hash，用 hash 的值覆盖 localStorage 默认
  // 注：必须在 useState 初始化之后再 set；用一个一次性 useEffect
  const hashAppliedRef = useRef(false);
  useEffect(() => {
    if (hashAppliedRef.current) return;
    hashAppliedRef.current = true;
    const fromUrl = decodeMacroState(window.location.hash);
    if (fromUrl.filter !== undefined) setFilter(fromUrl.filter);
    if (fromUrl.marketFilter !== undefined) setMarketFilter(fromUrl.marketFilter);
    if (fromUrl.dirFilter !== undefined) setDirFilter(fromUrl.dirFilter);
    if (fromUrl.search !== undefined) setSearch(fromUrl.search);
    if (fromUrl.onlyStarred !== undefined) setOnlyStarred(fromUrl.onlyStarred);
    if (fromUrl.compact !== undefined) setCompact(fromUrl.compact);
  }, []);

  // 后续：filter 变化时同步到 URL hash（replaceState 避免污染浏览器历史）
  useEffect(() => {
    if (!hashAppliedRef.current) return;  // 首次 effect 还没跑完前不写
    const encoded = encodeMacroState({ filter, marketFilter, dirFilter, search, onlyStarred, compact });
    const desired = encoded ? `#${encoded}` : "";
    if (window.location.hash !== desired) {
      const newUrl = window.location.pathname + window.location.search + desired;
      window.history.replaceState(null, "", newUrl);
    }
  }, [filter, marketFilter, dirFilter, search, onlyStarred, compact]);

  // 复制宏观日报到剪贴板（一段纯文本，便于邮件/Slack 分享）
  const [digestCopied, setDigestCopied] = useState(false);
  const copyDigest = async () => {
    const text = buildDigest({
      composite, history, factors,
      generatedAt: USE_SNAPSHOT ? macroSnapshot.generated_at : null,
    });
    try {
      await navigator.clipboard.writeText(text);
      setDigestCopied(true);
      setTimeout(() => setDigestCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setDigestCopied(true); setTimeout(() => setDigestCopied(false), 1800); }
      catch {}
      document.body.removeChild(ta);
    }
  };

  // 复制当前 URL 到剪贴板（分享视图）
  const shareUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      // fallback for older Safari / non-https
      const ta = document.createElement("textarea");
      ta.value = window.location.href;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setShared(true); setTimeout(() => setShared(false), 1800); }
      catch {}
      document.body.removeChild(ta);
    }
  };
  // scroll-to-top：滚动 >400px 时显示浮动按钮
  const scrollRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 键盘快捷键（仅在 macro 页有焦点时；input 内的键不消费）
  // r: 刷新 / c: 切换紧凑 / s: 聚焦搜索 / Esc: 清空搜索
  useEffect(() => {
    const onKey = (e) => {
      // 跳过修饰键（避免与 tab nav / 浏览器冲突）
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 跳过 input 内输入；selectedFactor 时让 modal 自己处理
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        // input 内 Esc 清空搜索
        if (e.key === "Escape" && e.target === searchInputRef.current && search) {
          e.preventDefault();
          setSearch("");
        }
        return;
      }
      if (selectedFactor) return;  // modal 优先
      if (e.key === "r") { e.preventDefault(); load(); }
      else if (e.key === "c") { e.preventDefault(); setCompact(v => !v); }
      else if (e.key === "s" || e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFactor, search, compact]);

  const load = async () => {
    setLoading(true);
    setError(null);
    if (USE_SNAPSHOT) {
      // 线上：直接吃打包进来的静态 snapshot
      setFactors(macroSnapshot.factors || []);
      setComposite(macroSnapshot.composite || null);
      setHistory(macroSnapshot.composite_history || null);
      setNarrative(macroSnapshot.narrative || null);
      setLoading(false);
      return;
    }
    // 本地 dev：走实时 API
    const [data, comp] = await Promise.all([
      apiFetch("/macro/factors?sparkline=120"),
      apiFetch("/macro/composite"),
    ]);
    if (data && Array.isArray(data)) {
      setFactors(data);
      setComposite(comp || null);
    } else {
      setError(t("宏观数据暂时无法加载，请稍后点击刷新重试"));
    }
    setLoading(false);
    // 历史曲线 + AI 画像异步加载（不阻塞首屏）
    apiFetch("/macro/composite/history").then(setHistory);
    setNarrativeLoading(true);
    apiFetch("/macro/narrative").then(d => {
      if (d?.ok && d.narrative) setNarrative(d.narrative);
      setNarrativeLoading(false);
    });
  };

  // dev 模式：force=true 跳过 12h 缓存重新生成 narrative
  const forceRefreshNarrative = async () => {
    setNarrativeLoading(true);
    const d = await apiFetch("/macro/narrative?force=true");
    if (d?.ok && d.narrative) setNarrative(d.narrative);
    setNarrativeLoading(false);
  };

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    if (!factors) return [];
    const seen = new Set();
    const order = [];
    factors.forEach(f => {
      if (!seen.has(f.category)) { seen.add(f.category); order.push(f.category); }
    });
    return order;
  }, [factors]);

  // 导出当前筛选结果为 CSV — 写入临时 Blob URL 触发下载
  const exportCsv = () => {
    if (!filtered || filtered.length === 0) return;
    const cols = ["factor_id", "name", "category", "market", "freq", "direction",
                  "contrarian_at_extremes", "value_date", "raw_value", "percentile",
                  "rolling_window_days"];
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      // CSV 转义：含逗号/引号/换行的字段用 "" 包裹，内部 " 转义为 ""
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = [cols.join(",")];
    filtered.forEach(f => {
      rows.push([
        f.factor_id, f.name, f.category, f.market, f.freq, f.direction,
        f.contrarian_at_extremes, f.latest?.value_date, f.latest?.raw_value,
        f.latest?.percentile, f.rolling_window_days,
      ].map(escape).join(","));
    });
    const csv = "﻿" + rows.join("\n"); // BOM for Excel compatibility
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `macro-factors-${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 计算每个市场的因子数（用于按钮 badge 显示）
  const marketCounts = useMemo(() => {
    if (!factors) return { all: 0 };
    const counts = { all: factors.length };
    factors.forEach(f => { counts[f.market] = (counts[f.market] || 0) + 1; });
    return counts;
  }, [factors]);

  const filtered = useMemo(() => {
    if (!factors) return [];
    let out = factors;
    if (onlyStarred) out = out.filter(f => starred.has(factorStarKey(f)));
    if (marketFilter !== "all") out = out.filter(f => f.market === marketFilter);
    if (filter !== "all") out = out.filter(f => f.category === filter);
    if (dirFilter !== "all") {
      out = out.filter(f => {
        if (dirFilter === "higher") return f.direction === "higher_bullish";
        if (dirFilter === "contrarian") return f.contrarian_at_extremes === true;
        if (dirFilter === "lower") return f.direction === "lower_bullish" && !f.contrarian_at_extremes;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(f =>
        (f.factor_id || "").toLowerCase().includes(q) ||
        (f.name || "").toLowerCase().includes(q) ||
        (f.description || "").toLowerCase().includes(q)
      );
    }
    // 收藏的排在前面（保持原顺序）
    if (starred.size > 0) {
      out = [
        ...out.filter(f => starred.has(factorStarKey(f))),
        ...out.filter(f => !starred.has(factorStarKey(f))),
      ];
    }
    return out;
  }, [factors, filter, dirFilter, marketFilter, search, starred, onlyStarred]);

  // v5 编辑式：因子按警示状态分两组（需关注 / 常规）— 不再 23 因子等权堆叠
  // 警示规则：1) contrarian 因子在极端区（pct < 10 或 > 90）；2) 任意因子非常极端（< 5 或 > 95）
  const { alertedFactors, normalFactors } = useMemo(() => {
    const alerted = [];
    const normal = [];
    filtered.forEach(f => {
      const pct = f.latest?.percentile;
      if (pct == null) { normal.push(f); return; }
      const contrarianAlert = f.contrarian_at_extremes && (pct < 10 || pct > 90);
      const veryExtreme = pct < 5 || pct > 95;
      if (contrarianAlert || veryExtreme) alerted.push(f);
      else normal.push(f);
    });
    return { alertedFactors: alerted, normalFactors: normal };
  }, [factors, filter, dirFilter, marketFilter, search, starred, onlyStarred]);

  // v5.3：因子方向分布（偏多/中性/偏空/预警）— 一条 stacked bar 给"市场总体偏多但有 N 处隐患"鸟瞰
  const factorDist = useMemo(() => {
    const base = alertedFactors.length > 0 ? normalFactors : filtered;
    let bull = 0, neutral = 0, bear = 0;
    base.forEach(f => {
      const s = directionalScore(f);  // 50=中性，>50 偏多，<50 偏空
      if (s == null) { neutral++; return; }
      if (s >= 55) bull++; else if (s <= 45) bear++; else neutral++;
    });
    return { bull, neutral, bear, warn: alertedFactors.length, total: base.length + alertedFactors.length };
  }, [alertedFactors, normalFactors, filtered]);

  // v5.3：预警因子当前分位距触发阈值的越界幅度（与上面警示规则一致：contrarian 用 10/90，其余 5/95）
  const alertDistance = (f) => {
    const pct = f.latest?.percentile;
    if (pct == null) return null;
    const lo = f.contrarian_at_extremes ? 10 : 5, hi = f.contrarian_at_extremes ? 90 : 95;
    if (pct < lo) return { side: 'low', thresh: lo, over: +(lo - pct).toFixed(1) };
    if (pct > hi) return { side: 'high', thresh: hi, over: +(pct - hi).toFixed(1) };
    return null;
  };

  // ── 移动端专用 state（无条件 hook，必须在 if (isMobile) 外）────
  const [mobileSel, setMobileSel] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  // Top Movers：|percentile − 50| 最大的前 6 个因子
  const topMovers = useMemo(() => {
    if (!factors) return [];
    return [...factors]
      .filter(f => f.latest?.percentile != null)
      .sort((a, b) => Math.abs((b.latest.percentile ?? 50) - 50) - Math.abs((a.latest.percentile ?? 50) - 50))
      .slice(0, 6);
  }, [factors]);

  // ─────────────────────────────────────────────────────────────
  // v6 移动端：晨报式竖向叙事
  // 市场温度头条 → AI 导读 → Top Movers 横滑 → 因子按警示分层 → 因子详情 BottomSheet
  // → 全部因子热力图（FullscreenChart 横屏）
  // ─────────────────────────────────────────────────────────────
  if (isMobile) {
    const temp = composite?.market_temperature;
    const tempLabel = temp == null ? "—"
      : temp < 15 ? t("极熊") : temp < 35 ? t("偏熊")
      : temp < 50 ? t("中性偏熊") : temp < 65 ? t("中性偏牛")
      : temp < 85 ? t("偏牛") : t("极牛");
    const tempColor = temp == null ? "var(--fg-3)"
      : temp < 20 ? "var(--down)" : temp < 40 ? "var(--warn)"
      : temp < 60 ? "var(--fg-1)" : temp < 80 ? "#a3e635"
      : "var(--up)";

    // 因子行渲染：警示在前，常规随后
    const mobileFactors = [
      ...alertedFactors.map(f => ({ f, isAlert: true })),
      ...normalFactors.slice(0, 12).map(f => ({ f, isAlert: false })),
    ];

    const getTone = (f, isAlert) => {
      if (isAlert) return "down";
      const pct = f.latest?.percentile;
      if (pct == null) return "neutral";
      if (pct < 20 || pct > 80) return "warn";
      return "up";
    };

    const getToneColor = (tone) =>
      tone === "down" ? "var(--down)" : tone === "warn" ? "var(--warn)" : "var(--up)";

    const getToneBorder = (tone) =>
      tone === "down" ? "rgba(255,107,107,.25)" : "var(--line)";

    const fmtVal = (f) => {
      const v = f.latest?.raw_value;
      if (v == null) return "—";
      return typeof v === "number"
        ? v > 1000 ? v.toLocaleString() : v.toFixed(v % 1 === 0 ? 0 : 2)
        : String(v);
    };

    const getPctStatus = (f) => {
      const pct = f.latest?.percentile;
      if (pct == null) return t("数据不足");
      if (pct < 10) return t("极低分位 · 历史底部区");
      if (pct < 25) return t("低分位 · 历史偏低");
      if (pct < 75) return t("正常波动区间");
      if (pct < 90) return t("高分位 · 历史偏高");
      return t("极高分位 · 历史顶部区");
    };

    // Top Movers + heatmap state are hoisted above if (isMobile) — see below
    const heatmapFactors = factors || [];
    const heatColor = (f) => {
      const pct = f.latest?.percentile;
      const tone = (() => {
        const isAlert = alertedFactors.includes(f);
        if (isAlert) return "down";
        if (pct == null) return "neutral";
        if (pct < 20 || pct > 80) return "warn";
        return "up";
      })();
      return {
        bg: tone === "down" ? "rgba(255,107,107,.16)" : tone === "warn" ? "rgba(245,181,60,.14)" : "rgba(30,211,149,.10)",
        border: tone === "down" ? "rgba(255,107,107,.4)" : tone === "warn" ? "rgba(245,181,60,.35)" : "rgba(30,211,149,.28)",
        text: tone === "down" ? "var(--down)" : tone === "warn" ? "var(--warn)" : "var(--up)",
        topBar: tone === "down",
      };
    };

    return (
      <div className="h-full flex flex-col" style={{ background: "var(--bg-0)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* ── 页头 ── */}
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h1 className="text-[22px] font-bold" style={{ color: "var(--fg-0)" }}>{t("宏观看板")}</h1>
            <button
              onClick={load}
              disabled={loading}
              className="w-9 h-9 rounded-[10px] border flex items-center justify-center active:scale-95"
              style={{ borderColor: "var(--line)", background: "rgba(255,255,255,.03)" }}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} style={{ color: "var(--fg-2)" }} />
            </button>
          </div>

          {/* ── 市场温度英雄区 ── */}
          <div className="px-4 pb-4 pt-1">
            <div className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: "var(--fg-3)" }}>
              {t("今日市场温度")}
            </div>
            {loading && !composite ? (
              <div className="flex items-center gap-2 py-4" style={{ color: "var(--fg-3)" }}>
                <Loader size={18} className="animate-spin" /><span className="text-sm">{t("加载中…")}</span>
              </div>
            ) : (
              <div className="flex items-end gap-4">
                <span
                  className="num-gradient-keep font-serif leading-none"
                  style={{
                    fontSize: 80, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 0.85,
                    color: tempColor,
                    background: `linear-gradient(180deg, ${tempColor}, color-mix(in srgb, ${tempColor} 70%, #000))`,
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    fontFamily: "Fraunces, Georgia, serif",
                  }}
                >
                  {temp != null ? Math.round(temp) : "—"}
                </span>
                <div style={{ paddingBottom: 8 }}>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                    style={{ color: tempColor, borderColor: "color-mix(in srgb, " + tempColor + " 40%, transparent)", background: "color-mix(in srgb, " + tempColor + " 12%, transparent)" }}
                  >
                    {tempLabel}
                  </span>
                  {composite?.wow_delta != null && (
                    <div className="font-mono text-[10px] mt-1.5" style={{ color: "var(--fg-3)" }}>
                      {t("较上周")}{" "}
                      <span style={{ color: composite.wow_delta > 0 ? "var(--up)" : "var(--down)" }}>
                        {composite.wow_delta > 0 ? "+" : ""}{composite.wow_delta.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI 导读段落 */}
            {narrative && (
              <p
                className="mt-3 text-[14px] leading-relaxed"
                style={{ color: "var(--fg-1)", fontFamily: "Fraunces, Georgia, serif" }}
              >
                {typeof narrative === "string"
                  ? narrative.slice(0, 160) + (narrative.length > 160 ? "…" : "")
                  : narrative.summary?.slice(0, 160) || ""}
              </p>
            )}
            {narrativeLoading && !narrative && (
              <div className="flex items-center gap-1.5 mt-3 text-[12px]" style={{ color: "var(--fg-3)" }}>
                <Loader size={13} className="animate-spin" />{t("AI 解读生成中…")}
              </div>
            )}
          </div>

          {/* ── Top Movers 横向滑动卡 ── */}
          {topMovers.length > 0 && (
            <div className="mb-5">
              <div
                className="text-[9px] font-semibold tracking-widest uppercase mb-2 px-4"
                style={{ color: "var(--fg-3)" }}
              >
                {t("今日最大偏移 · Top Movers")}
              </div>
              <div className="flex gap-3 overflow-x-auto px-4" style={{ scrollbarWidth: "none" }}>
                {topMovers.map((f) => {
                  const pct = f.latest?.percentile ?? 50;
                  const isHigh = pct > 50;
                  const accent = pct < 20 || pct > 80
                    ? (pct < 20 ? "var(--down)" : "var(--down)")
                    : pct < 35 || pct > 65 ? "var(--warn)" : "var(--up)";
                  const isAlert = alertedFactors.some(af => af.factor_id === f.factor_id);
                  const cardAccent = isAlert ? "var(--down)" : pct < 35 || pct > 65 ? "var(--warn)" : "var(--up)";
                  return (
                    <button
                      key={f.factor_id}
                      onClick={() => setMobileSel(f)}
                      className="shrink-0 rounded-[13px] border active:scale-95 transition text-left"
                      style={{
                        width: 104, padding: "12px 13px",
                        background: "rgba(255,255,255,.022)",
                        borderColor: "var(--line)",
                      }}
                    >
                      <div className="text-[11px] mb-2 truncate" style={{ color: "var(--fg-2)" }}>
                        {t(f.name || f.factor_id)}
                      </div>
                      <div
                        className="font-mono text-[17px] font-bold leading-none"
                        style={{ color: cardAccent }}
                      >
                        {fmtVal(f)}
                      </div>
                      <div className="mt-2 text-[9px] font-mono" style={{ color: "var(--fg-4)" }}>
                        p{Math.round(pct)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 关键因子 · 按警示分层 ── */}
          <div className="px-4 mb-4">
            <div className="flex items-baseline justify-between mb-3">
              <span
                className="text-[9px] font-semibold tracking-widest uppercase"
                style={{ color: "var(--fg-3)" }}
              >
                {t("关键因子 · 按警示分层")}
              </span>
              {factors && (
                <button
                  onClick={() => setShowHeatmap(true)}
                  className="flex items-center gap-1 text-[11px] font-semibold active:scale-95"
                  style={{ color: "var(--indigo-2)" }}
                >
                  {t("全部")} {factors.length} {t("项")}
                  <ChevronRight size={13} />
                </button>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-sm mb-3" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#fca5a5" }}>
                <AlertCircle size={15} className="shrink-0" />{error}
              </div>
            )}

            {loading && !factors && (
              <div className="flex items-center justify-center py-10" style={{ color: "var(--fg-3)" }}>
                <Loader size={18} className="animate-spin mr-2" />{t("加载中…")}
              </div>
            )}

            {mobileFactors.map(({ f, isAlert }) => {
              const tone = getTone(f, isAlert);
              const c = getToneColor(tone);
              return (
                <button
                  key={f.factor_id + (f.market || "")}
                  onClick={() => setMobileSel(f)}
                  className="w-full flex items-center gap-3 rounded-xl mb-2 active:scale-[0.99] transition text-left"
                  style={{
                    padding: "13px 14px",
                    background: "rgba(255,255,255,.022)",
                    border: "1px solid " + getToneBorder(tone),
                  }}
                >
                  <span
                    className="shrink-0 rounded-full"
                    style={{ width: 8, height: 8, background: c, boxShadow: `0 0 8px ${c}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: "var(--fg-0)" }}>
                      {t(f.name || f.factor_id)}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--fg-3)" }}>
                      {getPctStatus(f)}
                    </div>
                  </div>
                  <span className="font-mono text-[15px] font-bold shrink-0" style={{ color: c }}>
                    {fmtVal(f)}
                  </span>
                  <ChevronRight size={15} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
                </button>
              );
            })}

            {factors && mobileFactors.length === 0 && (
              <div className="text-center py-10 text-sm" style={{ color: "var(--fg-3)" }}>
                {t("暂无因子数据")}
              </div>
            )}
          </div>

          {/* bottom safe-area spacer */}
          <div style={{ height: "calc(16px + env(safe-area-inset-bottom))" }} />
        </div>

        {/* ── 因子详情 BottomSheet ── */}
        <BottomSheet
          open={mobileSel != null}
          onClose={() => setMobileSel(null)}
          title={mobileSel ? t(mobileSel.name || mobileSel.factor_id) : ""}
          maxHeight="82vh"
        >
          {mobileSel && (() => {
            const f = mobileSel;
            const pct = f.latest?.percentile;
            const tone = (() => {
              const isAlert = alertedFactors.some(af => af.factor_id === f.factor_id);
              if (isAlert) return "down";
              if (pct == null) return "neutral";
              if (pct < 20 || pct > 80) return "warn";
              return "up";
            })();
            const c = getToneColor(tone);
            const dist = alertDistance(f);
            return (
              <div className="pb-4">
                {/* 状态行 */}
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="rounded-full shrink-0"
                    style={{ width: 10, height: 10, background: c, boxShadow: `0 0 10px ${c}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px]" style={{ color: "var(--fg-3)" }}>
                      {f.category ? t(CATEGORY_LABEL[f.category] || f.category) : ""}{f.market ? ` · ${f.market}` : ""}
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border"
                    style={{ color: c, borderColor: "color-mix(in srgb, " + c + " 40%, transparent)", background: "color-mix(in srgb, " + c + " 12%, transparent)" }}
                  >
                    {getPctStatus(f)}
                  </span>
                </div>

                {/* 当前值 + 分位 */}
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{ background: "rgba(255,255,255,.022)", border: "1px solid var(--line)" }}
                >
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="font-mono text-[32px] font-bold leading-none" style={{ color: "var(--fg-0)" }}>
                      {fmtVal(f)}
                    </span>
                    {pct != null && (
                      <span className="font-mono text-[13px]" style={{ color: c }}>
                        p{Math.round(pct)}
                      </span>
                    )}
                  </div>
                  {/* 分位条 */}
                  {pct != null && (
                    <div className="relative h-2 rounded-full overflow-hidden mb-1" style={{ background: "rgba(255,255,255,.06)" }}>
                      <div
                        className="absolute left-0 top-0 h-full rounded-full"
                        style={{ width: `${pct}%`, background: c, opacity: 0.75 }}
                      />
                    </div>
                  )}
                  {dist && (
                    <div className="text-[10px] font-mono mt-1.5" style={{ color: "var(--warn)" }}>
                      {t("距警戒阈值")} {dist.thresh}% · {t("越界")} {dist.over.toFixed(1)} pts
                    </div>
                  )}
                </div>

                {/* 描述 */}
                {f.description && (
                  <p className="text-[13px] leading-relaxed mb-4" style={{ color: "var(--fg-1)" }}>
                    {f.description}
                  </p>
                )}

                {/* 更新时间 */}
                {f.latest?.value_date && (
                  <div className="text-[10px] font-mono mb-4" style={{ color: "var(--fg-4)" }}>
                    {t("数据日期")} {f.latest.value_date}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const idx = filtered.findIndex(x => x.factor_id === f.factor_id && x.market === f.market);
                      if (idx > 0) setMobileSel(filtered[idx - 1]);
                    }}
                    disabled={(() => { const i = filtered.findIndex(x => x.factor_id === f.factor_id && x.market === f.market); return i <= 0; })()}
                    className="flex-1 h-11 rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-1 active:scale-95 disabled:opacity-30"
                    style={{ borderColor: "var(--line-2)", background: "rgba(255,255,255,.04)", color: "var(--fg-1)" }}
                  >
                    <ChevronLeft size={15} />{t("上一个")}
                  </button>
                  <button
                    onClick={() => {
                      const idx = filtered.findIndex(x => x.factor_id === f.factor_id && x.market === f.market);
                      if (idx >= 0 && idx < filtered.length - 1) setMobileSel(filtered[idx + 1]);
                    }}
                    disabled={(() => { const i = filtered.findIndex(x => x.factor_id === f.factor_id && x.market === f.market); return i < 0 || i >= filtered.length - 1; })()}
                    className="flex-1 h-11 rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-1 active:scale-95 disabled:opacity-30"
                    style={{ borderColor: "rgba(99,102,241,.3)", background: "rgba(99,102,241,.15)", color: "var(--indigo-2)" }}
                  >
                    {t("下一个")}<ChevronRight size={15} />
                  </button>
                </div>
              </div>
            );
          })()}
        </BottomSheet>

        {/* ── 全部因子热力图（横屏 FullscreenChart）── */}
        <FullscreenChart
          open={showHeatmap}
          onClose={() => setShowHeatmap(false)}
          title={t("宏观因子热力") + " · " + heatmapFactors.length + " " + t("项")}
          meta={
            composite?.market_temperature != null
              ? <span className="font-mono text-[13px] font-bold" style={{ color: tempColor }}>{Math.round(composite.market_temperature)}</span>
              : null
          }
        >
          <div
            className="w-full h-full overflow-auto"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, alignContent: "start" }}
          >
            {heatmapFactors.map((f) => {
              const { bg, border, text, topBar } = heatColor(f);
              return (
                <button
                  key={f.factor_id + (f.market || "")}
                  onClick={() => { setShowHeatmap(false); setTimeout(() => setMobileSel(f), 120); }}
                  className="rounded-[9px] flex flex-col justify-between active:scale-95 transition relative overflow-hidden text-left"
                  style={{ background: bg, border: `1px solid ${border}`, padding: "8px 9px", minHeight: 60 }}
                >
                  {topBar && <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "var(--down)" }} />}
                  <div className="text-[10px] font-semibold leading-tight" style={{ color: "var(--fg-2)" }}>
                    {t(f.name || f.factor_id)}
                  </div>
                  <div className="font-mono text-[13px] font-bold leading-none mt-1" style={{ color: text }}>
                    {fmtVal(f)}
                  </div>
                </button>
              );
            })}
          </div>
        </FullscreenChart>
      </div>
    );
  }
  // ─── END mobile branch ───────────────────────────────────────

  return (
    <div ref={scrollRef} className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 relative">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Globe className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">{t("宏观因子看板")}</h2>
          <span className="text-xs text-white/50">
            {factors ? `${filtered.length} / ${factors.length} ${t("因子")}` : ""}
          </span>
          {USE_SNAPSHOT && macroSnapshot.generated_at && (() => {
            const st = snapshotStaleness(macroSnapshot.generated_at);
            return (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${st.cls}`}
                title={`线上为静态 snapshot · 生成于 ${macroSnapshot.generated_at.slice(0,10)}${st.days != null ? `（${st.days} 天前）` : ""}。\n本地跑 backend/export_macro_snapshot.py 重新打包后 commit + push 才会更新。`}
              >
                <span className="mr-1">{st.icon}</span>
                snapshot · {macroSnapshot.generated_at.slice(0, 10)} · {t(st.label)}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={copyDigest}
            className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
              digestCopied
                ? "bg-emerald-500/15 border border-emerald-400/40 text-emerald-200"
                : "bg-white/[0.04] hover:bg-white/[0.08] text-white/80"
            }`}
            title={digestCopied ? t("已复制") : t("复制当前宏观状态为一段文本，便于发送邮件/聊天")}
          >
            {digestCopied ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
            {digestCopied ? t("已复制") : t("日报")}
          </button>
          <button
            onClick={shareUrl}
            className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
              shared
                ? "bg-emerald-500/15 border border-emerald-400/40 text-emerald-200"
                : "bg-white/[0.04] hover:bg-white/[0.08] text-white/80"
            }`}
            title={shared ? t("已复制 URL") : t("复制视图 URL（含当前筛选）")}
          >
            {shared ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            {shared ? t("已复制") : t("分享视图")}
          </button>
          <button
            onClick={() => setCompact(v => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 ${
              compact
                ? "bg-cyan-500/15 border border-cyan-400/40 text-cyan-200"
                : "bg-white/[0.04] hover:bg-white/[0.08] text-white/80"
            }`}
            title={compact ? t("展开全部面板") : t("仅显示核心信息")}
            aria-pressed={compact}
          >
            {compact ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            {compact ? t("完整") : t("紧凑")}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs flex items-center gap-1.5 disabled:opacity-50 text-white/80"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("刷新")}
          </button>
        </div>
      </div>

      <DataStatusBanner composite={composite} factors={factors} />

      {/* v7 regime 仪表组 — 真实 composite/因子分布做成圆环仪表（对齐设计稿 SECTION 04「仪表组替代大数字头条」；
          设计稿的板块×因子热力 / 资产相关矩阵用的是 Math.sin 假数据，本平台无对应真实数据源，按「不编造」未复刻）*/}
      {composite && factorDist.total > 0 && (
        <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(() => {
            const temp = composite.market_temperature;
            const tempC = temp == null ? '#64748b' : temp >= 60 ? '#1ED395' : temp >= 40 ? '#f59e0b' : '#FF6B6B';
            const pct = (n) => factorDist.total ? Math.round(n / factorDist.total * 100) : 0;
            const gauges = [
              { v: temp != null ? Math.round(temp) : '—', label: t('宏观温度'), sub: composite.wow_delta != null ? `${t('较昨')} ${composite.wow_delta > 0 ? '+' : ''}${composite.wow_delta.toFixed(1)}` : t('市场温度'), color: tempC, ring: temp ?? 0 },
              { v: pct(factorDist.bull), label: t('因子偏多'), sub: `${factorDist.bull}/${factorDist.total}`, color: '#1ED395', ring: pct(factorDist.bull) },
              { v: pct(factorDist.neutral), label: t('因子中性'), sub: `${factorDist.neutral}/${factorDist.total}`, color: '#94a3b8', ring: pct(factorDist.neutral) },
              { v: factorDist.warn, label: t('因子预警'), sub: factorDist.warn > 0 ? t('需关注') : t('暂无'), color: factorDist.warn > 0 ? '#FF6B6B' : '#94a3b8', ring: factorDist.total ? factorDist.warn / factorDist.total * 100 : 0 },
            ];
            return gauges.map((g, i) => {
              const off = 163 - (Math.max(0, Math.min(100, g.ring)) / 100 * 163);
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
                  <div className="relative w-14 h-14 shrink-0">
                    <svg viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                      <circle cx="32" cy="32" r="26" fill="none" stroke={g.color} strokeWidth="5" strokeDasharray="163" strokeDashoffset={off} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[15px] font-mono font-bold text-white">{g.v}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-white truncate">{g.label}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: g.color }}>{g.sub}</div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      <NarrativePanel
        narrative={narrative}
        loading={narrativeLoading}
        onForceRefresh={USE_SNAPSHOT ? null : forceRefreshNarrative}
      />

      <CompositePanel data={composite} history={history} />

      <AlertsPanel alerts={composite?.alerts} />

      {!compact && <AlertBacktestPanel history={history} />}

      {!compact && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-4">
            <HmmPanel hmm={composite?.hmm} temp={composite?.market_temperature} />
            <SurvivalPanel s={composite?.survival} />
          </div>

          <CompositeChart history={history} range={range} setRange={setRange} />

          <TopMovers factors={factors} />
        </>
      )}

      <FilterBar
        factors={factors}
        categories={categories}
        marketCounts={marketCounts}
        filtered={filtered}
        filter={filter} setFilter={setFilter}
        marketFilter={marketFilter} setMarketFilter={setMarketFilter}
        dirFilter={dirFilter} setDirFilter={setDirFilter}
        search={search} setSearch={setSearch} searchInputRef={searchInputRef}
        starred={starred} onlyStarred={onlyStarred} setOnlyStarred={setOnlyStarred}
        exportCsv={exportCsv}
      />

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-400/30 rounded-lg text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !factors && (
        <div className="flex items-center justify-center py-12 text-white/50">
          <Loader className="w-5 h-5 animate-spin mr-2" /> {t("加载中…")}
        </div>
      )}

      {factors && factors.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-white/50 text-sm">
          {t("暂无可显示的因子，请稍后刷新重试")}
        </div>
      )}

      {/* 过滤后空集 — 引导清除筛选 */}
      {factors && factors.length > 0 && filtered.length === 0 && (
        <div className="flex items-center justify-center gap-3 py-8 text-white/45 text-xs">
          <span>{t("当前筛选条件下没有因子")}</span>
          <button
            onClick={() => { setFilter("all"); setDirFilter("all"); setMarketFilter("all"); setSearch(""); }}
            className="px-2 py-0.5 rounded text-[10px] border bg-indigo-500/15 border-indigo-400/30 text-indigo-200 hover:bg-indigo-500/25"
          >
            {t("清除全部筛选")}
          </button>
        </div>
      )}

      {/* v5.3：因子方向分布鸟瞰 — stacked bar（偏多/中性/偏空/预警），先给整体感再看 23 张卡 */}
      {factors && factorDist.total > 0 && (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
            <span className="text-[11px] font-medium text-white/70">{t('因子方向分布')} · <span className="font-mono text-white/50">{factorDist.total}</span></span>
            <div className="flex items-center gap-2.5 text-[9px] font-mono">
              <span className="text-emerald-300">● {t('偏多')} {factorDist.bull}</span>
              <span className="text-slate-300">● {t('中性')} {factorDist.neutral}</span>
              {factorDist.bear > 0 && <span className="text-orange-300">● {t('偏空')} {factorDist.bear}</span>}
              <span className="text-red-300">● {t('预警')} {factorDist.warn}</span>
            </div>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.04]">
            {[['bull', '#1ED395'], ['neutral', '#64748b'], ['bear', '#fb923c'], ['warn', '#f87171']].map(([k, c]) => {
              const v = factorDist[k];
              if (!v) return null;
              return <div key={k} style={{ width: `${v / factorDist.total * 100}%`, background: c }} title={`${k}: ${v}`} />;
            })}
          </div>
        </div>
      )}

      {/* v5 编辑式：警示因子（contrarian × 极端区，或任意 < 5/> 95 分位）单独成卡组高亮 */}
      {alertedFactors.length > 0 && (
        <>
          <div className="flex items-baseline gap-2 mb-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,181,60,0.7)]" />
            <h3 className="text-[12px] font-semibold text-amber-300">
              {t('需关注')} · <span className="font-mono">{alertedFactors.length}</span> {t('个因子触发警示')}
            </h3>
            <span className="text-[10px] text-white/40">— {t('极端分位 / contrarian 扭曲')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-4 p-2 rounded-xl bg-amber-500/[0.025] border border-amber-400/15">
            {alertedFactors.map(f => {
              const k = factorStarKey(f);
              return (
                <FactorCard
                  key={k}
                  f={f}
                  onSelect={setSelectedFactor}
                  isStarred={starred.has(k)}
                  onToggleStar={toggleStar}
                  alert={alertDistance(f)}
                />
              );
            })}
          </div>
          <div className="flex items-baseline gap-2 mb-2 mt-3">
            <span className="w-2 h-2 rounded-full bg-white/25" />
            <h3 className="text-[12px] font-medium text-white/55">
              {t('常规因子')} · <span className="font-mono">{normalFactors.length}</span> {t('个正常波动')}
            </h3>
          </div>
        </>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {(alertedFactors.length > 0 ? normalFactors : filtered).map(f => {
          const k = factorStarKey(f);
          return (
            <FactorCard
              key={k}
              f={f}
              onSelect={setSelectedFactor}
              isStarred={starred.has(k)}
              onToggleStar={toggleStar}
            />
          );
        })}
      </div>

      <FactorDetailModal
        f={selectedFactor}
        onClose={() => setSelectedFactor(null)}
        isStarred={selectedFactor ? starred.has(factorStarKey(selectedFactor)) : false}
        onToggleStar={toggleStar}
        onPrev={selectedFactor ? () => {
          const idx = filtered.findIndex(x => factorStarKey(x) === factorStarKey(selectedFactor));
          if (idx > 0) setSelectedFactor(filtered[idx - 1]);
        } : null}
        onNext={selectedFactor ? () => {
          const idx = filtered.findIndex(x => factorStarKey(x) === factorStarKey(selectedFactor));
          if (idx >= 0 && idx < filtered.length - 1) setSelectedFactor(filtered[idx + 1]);
        } : null}
      />

      {/* 浮动 scroll-to-top — 滚动 400px+ 才显示 */}
      {showScrollTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="sticky bottom-3 ml-auto mr-3 flex items-center justify-center w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/30 backdrop-blur-sm shadow-lg transition-opacity z-30"
          title={t("回到顶部")}
          aria-label={t("回到顶部")}
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
