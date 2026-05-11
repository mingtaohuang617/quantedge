import React from "react";
import { Search, X, Download } from "lucide-react";
import { useLang } from "../../i18n.jsx";
import { CATEGORY_LABEL } from "./shared.js";

// 因子网格上方的多行筛选器 — 从 MacroDashboard.jsx 抽出
//
// 包含 3 行：
//   1. 分类（valuation / liquidity / sentiment / breadth 等）— indigo
//   2. 市场（all / US / CN，仅当多市场存在）— cyan
//   3. 方向 + 搜索 + 仅收藏 + CSV 导出 — violet
//
// 所有状态都从 props 传入（受控）；FilterBar 自身不持有 state，便于父级
// 持久化 / URL sync。
export default function FilterBar({
  factors,
  categories,
  marketCounts,
  filtered,
  filter, setFilter,
  marketFilter, setMarketFilter,
  dirFilter, setDirFilter,
  search, setSearch, searchInputRef,
  starred, onlyStarred, setOnlyStarred,
  exportCsv,
}) {
  const { t } = useLang();
  if (!factors || factors.length === 0) return null;

  const dirOptions = [
    { id: "all", label: t("全部") },
    { id: "higher", label: t("高=牛") },
    { id: "lower", label: t("低=牛") },
    { id: "contrarian", label: t("低=牛·极端反向") },
  ];

  return (
    <div className="space-y-1.5">
      {/* 分类副行 */}
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

      {/* 市场副行 — 仅当 factors 跨多市场时显示 */}
      {Object.keys(marketCounts).length > 2 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-white/40 mr-1">{t("市场")}:</span>
          {[
            { id: "all", label: t("全部"), count: marketCounts.all },
            ...Object.keys(marketCounts).filter(k => k !== "all").sort()
              .map(m => ({ id: m, label: m, count: marketCounts[m] })),
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setMarketFilter(opt.id)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                marketFilter === opt.id
                  ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-200"
                  : "bg-white/[0.02] border-white/[0.05] text-white/45 hover:text-white/80"
              }`}
            >
              {opt.label} ({opt.count})
            </button>
          ))}
        </div>
      )}

      {/* 方向 + 搜索 + 仅收藏 + CSV 副行 */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {starred.size > 0 && (
          <button
            onClick={() => setOnlyStarred(v => !v)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors flex items-center gap-1 ${
              onlyStarred
                ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
                : "bg-white/[0.02] border-white/[0.05] text-white/55 hover:text-white/85"
            }`}
            title={onlyStarred ? t("显示全部") : t("仅显示收藏")}
          >
            ★ {onlyStarred ? t("仅收藏") : `${starred.size}`}
          </button>
        )}
        <span className="text-[10px] text-white/40 mr-1">{t("方向")}:</span>
        {dirOptions.map(opt => (
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
        <div className="sm:ml-auto relative flex items-center w-full sm:w-auto">
          <Search className="absolute left-2 w-3 h-3 text-white/30" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("搜索因子 (id / 名称 / 描述)") + " (s)"}
            className="pl-7 pr-7 py-0.5 text-[10px] bg-white/[0.03] border border-white/[0.08] rounded text-white/85 placeholder:text-white/30 focus:outline-none focus:border-indigo-400/50 w-full sm:w-56"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1 p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70"
              title={t("清除")}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="px-2 py-0.5 rounded text-[10px] border bg-white/[0.02] border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.05] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("导出当前筛选结果为 CSV")}
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
      </div>
    </div>
  );
}
