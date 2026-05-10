// ─────────────────────────────────────────────────────────────
// MacroDashboard — 市场层面宏观因子看板（Phase 1+2）
// 组件已拆到 ../components/macro/*；本文件只负责数据加载 + 组合 + 路由级 state
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { Globe, RefreshCw, AlertCircle, Loader } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import { useLang } from "../i18n.jsx";

// 线上快照（production 只能读它，因为 Vercel 上没跑 backend；本地 dev 走实时 API）
// 主动刷新：本地 `cd backend && python export_macro_snapshot.py` → commit → push
import macroSnapshot from "../macroSnapshot.json";

import { CATEGORY_LABEL, snapshotStaleness } from "../components/macro/shared.js";
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
  const [selectedFactor, setSelectedFactor] = useState(null);

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

  const filtered = useMemo(() => {
    if (!factors) return [];
    let out = factors;
    if (filter !== "all") out = out.filter(f => f.category === filter);
    if (dirFilter !== "all") {
      out = out.filter(f => {
        if (dirFilter === "higher") return f.direction === "higher_bullish";
        if (dirFilter === "contrarian") return f.contrarian_at_extremes === true;
        if (dirFilter === "lower") return f.direction === "lower_bullish" && !f.contrarian_at_extremes;
        return true;
      });
    }
    return out;
  }, [factors, filter, dirFilter]);

  return (
    <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
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
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs flex items-center gap-1.5 disabled:opacity-50 text-white/80"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("刷新")}
        </button>
      </div>

      <DataStatusBanner composite={composite} factors={factors} />

      <NarrativePanel narrative={narrative} loading={narrativeLoading} />

      <CompositePanel data={composite} history={history} />

      <AlertsPanel alerts={composite?.alerts} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-4">
        <HmmPanel hmm={composite?.hmm} temp={composite?.market_temperature} />
        <SurvivalPanel s={composite?.survival} />
      </div>

      <CompositeChart history={history} range={range} setRange={setRange} />

      <TopMovers factors={factors} />

      {factors && factors.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                filter === "all"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                  : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white"
              }`}
            >
              {t("全部")} ({factors.length})
            </button>
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                  filter === c
                    ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                    : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white"
                }`}
              >
                {t(CATEGORY_LABEL[c] || c)} ({factors.filter(f => f.category === c).length})
              </button>
            ))}
          </div>
          {/* 方向过滤副行 */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-white/40 mr-1">{t("方向")}:</span>
            {[
              { id: "all", label: t("全部") },
              { id: "higher", label: t("高=牛") },
              { id: "lower", label: t("低=牛") },
              { id: "contrarian", label: t("低=牛·极端反向") },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => setDirFilter(opt.id)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  dirFilter === opt.id
                    ? "bg-violet-500/20 border-violet-400/40 text-violet-200"
                    : "bg-white/[0.02] border-white/[0.05] text-white/45 hover:text-white/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map(f => (
          <FactorCard key={`${f.factor_id}@${f.market}`} f={f} onSelect={setSelectedFactor} />
        ))}
      </div>

      <FactorDetailModal f={selectedFactor} onClose={() => setSelectedFactor(null)} />
    </div>
  );
}
