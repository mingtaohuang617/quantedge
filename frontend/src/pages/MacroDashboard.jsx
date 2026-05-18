// ─────────────────────────────────────────────────────────────
// MacroDashboard — 市场层面宏观因子看板（Phase 1+2）
// 组件已拆到 ../components/macro/*；本文件只负责数据加载 + 组合 + 路由级 state
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Globe, RefreshCw, AlertCircle, Loader, ArrowUp, Maximize2, Minimize2, Share2, Check, FileText } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import { useLang } from "../i18n.jsx";

// 线上快照（production 只能读它，因为 Vercel 上没跑 backend；本地 dev 走实时 API）
// 主动刷新：本地 `cd backend && python export_macro_snapshot.py` → commit → push
import macroSnapshot from "../macroSnapshot.json";

import {
  CATEGORY_LABEL, snapshotStaleness, readStarred, writeStarred, factorStarKey,
  encodeMacroState, decodeMacroState,
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
import ShortcutsHelp from "../components/macro/ShortcutsHelp.jsx";
import FilterBar from "../components/macro/FilterBar.jsx";
import AlertBacktestPanel from "../components/macro/AlertBacktestPanel.jsx";
import { buildDigest } from "../components/macro/digestBuilder.js";

const USE_SNAPSHOT = import.meta.env.PROD;

export default function MacroDashboard() {
  const { t } = useLang();
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
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
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
      if (showShortcutsHelp) return;  // 帮助 modal 优先
      if (e.key === "r") { e.preventDefault(); load(); }
      else if (e.key === "c") { e.preventDefault(); setCompact(v => !v); }
      else if (e.key === "s" || e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      else if (e.key === "?") { e.preventDefault(); setShowShortcutsHelp(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFactor, search, compact, showShortcutsHelp]);

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
      setError(t("加载失败：检查 backend 是否启动 + FRED_API_KEY 已设置 + 已运行 refresh_macro.py"));
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
          {t("没有因子。先在 backend 跑")} <code className="font-mono text-indigo-300">python refresh_macro.py</code>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map(f => {
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

      <ShortcutsHelp open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

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
