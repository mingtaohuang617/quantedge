// ─────────────────────────────────────────────────────────────
// WatchlistCard — 10x 观察项卡片（右栏单卡）
// ─────────────────────────────────────────────────────────────
// 从 Screener10x.jsx 抽出独立，便于：
//   1) 减小 Screener10x.jsx 体积（>1400 行 → <1200 行）
//   2) 组件渲染测试（@testing-library/react）
//
// Props:
//   item: 观察项对象（含 ticker/strategy/bottleneck_layer/moat_score/...）
//   trendName: (id) => string，把 supertrend_id 翻译成显示名
//   currentPrice: number | null，Yahoo 拉到的当前价（用于价格预警 badge）
//   onEdit / onDelete / onToggleArchive / onMarkReviewed: 行为回调
//
// 渲染语义（strategy-aware）：
//   - 顶部 strategy badge「成」/「值」（indigo / emerald 区分）
//   - L1/L2 颜色按"稀有度"映射（罕见层级=紫，普通层级=蓝）
//   - 底部 label「卡位」/「护城河」按 strategy 切换
//   - 价格预警 vs target/stop：above/near/far/below/safe 多色 +emoji
//   - N 天未复盘 badge（>=7d）：info / warn / urgent 三档
//   - falsification_condition：红色警示框（pre-mortem 纪律）
// ─────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { Edit2, Trash2, Star, ChevronRight, Archive, ArchiveRestore, Check } from "lucide-react";

export default function WatchlistCard({
  item,
  trendName,
  currentPrice,
  onEdit,
  onDelete,
  onToggleArchive,
  onMarkReviewed,
}) {
  const moat = item.moat_score || 0;
  const archived = !!item.archived;
  // strategy-aware：价值型和成长型 item 在同一 watchlist 里混合显示，
  // 需要一眼可辨；同时 L1/L2 / 卡位等字段在两种策略下语义不同。
  const isValue = (item.strategy || "growth") === "value";
  // L1/L2 颜色按"罕见 / 突出"映射：
  //   growth: L2 深度认知 = 罕见 → 紫；L1 共识 = 普通 → 蓝
  //   value:  L1 深度低估 = 罕见 → 紫；L2 合理估值 = 普通 → 蓝
  const rareTone = "bg-violet-500/15 text-violet-200 border-violet-500/40";
  const normalTone = "bg-blue-500/15 text-blue-200 border-blue-500/40";

  // 价格预警计算：基于当前价（Yahoo） vs target_price / stop_loss
  // 用户体验：现价 - target/stop 距离用百分比 + 颜色 + emoji 表达紧迫程度
  const priceAlerts = useMemo(() => {
    if (currentPrice == null || typeof currentPrice !== "number") return null;
    const out = { current: currentPrice, target: null, stop: null };
    if (item.target_price != null) {
      const gap = (currentPrice - item.target_price) / item.target_price;
      // gap > 0：当前价 > target（已超），用户已达预期 → 绿色
      // -10% < gap < 0：临近目标 → 蓝/青色
      // gap < -10%：距离目标还远 → 灰色
      out.target = {
        gap,
        tone: gap >= 0 ? "above"
            : gap >= -0.10 ? "near" : "far",
      };
    }
    if (item.stop_loss != null) {
      const gap = (currentPrice - item.stop_loss) / item.stop_loss;
      // gap < 0：已破止损 → 红色
      // 0 < gap < 10%：临近止损 → 黄色
      // gap > 10%：安全 → 不强调（灰）
      out.stop = {
        gap,
        tone: gap < 0 ? "below"
            : gap < 0.10 ? "near" : "safe",
      };
    }
    return out;
  }, [currentPrice, item.target_price, item.stop_loss]);

  // 复盘提醒：从最近一次接触（added_at / llm_thesis_cached_at）算出天数
  // > 30 天 amber 提醒；> 90 天 red 强警告（建议重看 thesis 是否仍成立）
  const reviewState = useMemo(() => {
    if (archived) return null;   // 归档项不提醒
    const dates = [];
    if (item.added_at) {
      const d = new Date(item.added_at);
      if (!isNaN(d)) dates.push(d.getTime());
    }
    if (item.llm_thesis_cached_at) {
      const d = new Date(item.llm_thesis_cached_at);
      if (!isNaN(d)) dates.push(d.getTime());
    }
    if (dates.length === 0) return null;
    const lastMs = Math.max(...dates);
    const daysAgo = Math.floor((Date.now() - lastMs) / 86400000);
    if (daysAgo < 7) return null;   // < 7 天太新，不显示
    return {
      daysAgo,
      tone: daysAgo >= 90 ? "urgent" : daysAgo >= 30 ? "warn" : "info",
    };
  }, [item.added_at, item.llm_thesis_cached_at, archived]);

  return (
    <div className={`glass-card p-2 border transition group ${
      archived
        ? "border-white/5 opacity-60 hover:opacity-90"
        : "border-white/10 hover:border-white/20"
    }`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[12px] font-semibold text-white">{item.ticker}</span>
            {/* strategy badge — 让混合 watchlist 一眼可辨 */}
            <span
              className={`text-[9px] px-1 py-px rounded font-medium border ${
                isValue
                  ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/40"
                  : "bg-indigo-500/15 text-indigo-200 border-indigo-500/40"
              }`}
              title={isValue ? "价值型 — Graham 安全边际" : "成长型 — 双层瓶颈 / 卡位公司"}
            >
              {isValue ? "值" : "成"}
            </span>
            {archived && (
              <span className="text-[9px] px-1 py-px rounded bg-white/5 text-[#a0aec0] border border-white/15">归档</span>
            )}
            {item.bottleneck_layer === 2 && (
              <span
                className={`text-[9px] px-1 py-px rounded border ${isValue ? normalTone : rareTone}`}
                title={isValue ? "L2 合理估值 — 安全边际偏薄" : "L2 深度认知 — 跨界看到第二层瓶颈"}
              >L2</span>
            )}
            {item.bottleneck_layer === 1 && (
              <span
                className={`text-[9px] px-1 py-px rounded border ${isValue ? rareTone : normalTone}`}
                title={isValue ? "L1 深度低估 — 显著低于内在价值" : "L1 共识层 — 主流认知层瓶颈"}
              >L1</span>
            )}
            {/* 复盘提醒（≥7 天才显示）— 强提醒用户重看 thesis */}
            {reviewState && (
              <span
                className={`text-[9px] px-1 py-px rounded border ${
                  reviewState.tone === "urgent"
                    ? "bg-red-500/15 text-red-300 border-red-500/40 animate-pulse"
                    : reviewState.tone === "warn"
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/15"
                }`}
                title={
                  reviewState.tone === "urgent"
                    ? `已 ${reviewState.daysAgo} 天未复盘 — 强烈建议重看 thesis 是否仍成立`
                    : reviewState.tone === "warn"
                    ? `已 ${reviewState.daysAgo} 天未复盘 — 建议复盘并 regenerate AI 草稿`
                    : `${reviewState.daysAgo} 天前观察`
                }
              >
                ⏰ {reviewState.daysAgo}d
              </span>
            )}
          </div>
          {item.supertrend_id && (
            <div className="text-[9px] text-cyan-300/80 mt-0.5">{trendName(item.supertrend_id)}</div>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          {/* 一键已复盘 — 不必 regenerate 草稿就重置「N 天未复盘」badge */}
          {!archived && onMarkReviewed && (
            <button
              onClick={onMarkReviewed}
              aria-label="标记已复盘"
              className="p-1 rounded hover:bg-emerald-500/20 text-[#a0aec0] hover:text-emerald-300"
              title="标记已复盘 — 重置「N 天未复盘」badge（不必重新生成 AI 草稿）"
            >
              <Check size={10} />
            </button>
          )}
          <button onClick={onEdit} aria-label="编辑观察项" className="p-1 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white" title="编辑">
            <Edit2 size={10} />
          </button>
          <button
            onClick={onToggleArchive}
            aria-label={archived ? "恢复观察项" : "归档观察项"}
            className={`p-1 rounded hover:bg-amber-500/20 text-[#a0aec0] ${archived ? "hover:text-emerald-300" : "hover:text-amber-300"}`}
            title={archived ? "恢复（取消归档）" : "归档（保留 thesis，不再显示）"}
          >
            {archived ? <ArchiveRestore size={10} /> : <Archive size={10} />}
          </button>
          <button onClick={onDelete} aria-label="删除观察项" className="p-1 rounded hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300" title="删除">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* moat score 星标 */}
      <div className="flex items-center gap-0.5 mb-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={9}
            className={n <= moat ? "text-amber-400 fill-amber-400" : "text-white/15"}
          />
        ))}
        <span className="text-[9px] text-[#7a8497] ml-1">{isValue ? "护城河" : "卡位"}</span>
      </div>

      {item.bottleneck_tag && (
        <div className="text-[10px] text-[#d0d7e2] mb-1 flex items-start gap-1">
          <ChevronRight size={9} className="text-amber-400 mt-0.5 shrink-0" />
          <span className="break-words">{item.bottleneck_tag}</span>
        </div>
      )}

      {item.thesis && (
        <div className="text-[10px] text-[#a0aec0] leading-relaxed whitespace-pre-line line-clamp-3 mb-1">
          {item.thesis}
        </div>
      )}

      {/* 假设证伪条件（pre-mortem）— 红色警示色，写了就立刻能看到 */}
      {item.falsification_condition && (
        <div
          className="text-[10px] text-amber-200/90 leading-relaxed mb-1 flex items-start gap-1 px-1.5 py-1 bg-amber-500/8 border border-amber-500/25 rounded"
          title={`证伪条件：${item.falsification_condition}`}
        >
          <span className="text-amber-400 shrink-0">⚠</span>
          <span className="break-words line-clamp-2">{item.falsification_condition}</span>
        </div>
      )}

      {/* v5: 位置轨迹条 — 止损 🛡 ── ●当前 ── 🎯目标，让"安全边距"和"距目标"一眼可读 */}
      {item.target_price != null && item.stop_loss != null && priceAlerts && item.target_price > item.stop_loss && (
        <div className="mb-1.5 mt-1">
          {(() => {
            const range = item.target_price - item.stop_loss;
            const rawPct = ((priceAlerts.current - item.stop_loss) / range) * 100;
            const progressPct = Math.max(0, Math.min(100, rawPct));
            const distToTargetPct = ((item.target_price - priceAlerts.current) / priceAlerts.current) * 100;
            const distToStopPct = ((priceAlerts.current - item.stop_loss) / priceAlerts.current) * 100;
            return (
              <>
                <div className="relative h-1.5 rounded-full bg-white/[0.05] overflow-visible">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${progressPct}%`,
                      background: "linear-gradient(90deg, rgba(248,113,113,0.35), rgba(0,229,160,0.60))",
                    }}
                  />
                  <div
                    className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white/40 shadow-[0_0_8px_rgba(0,229,160,0.7)]"
                    style={{
                      left: `${progressPct}%`,
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                    }}
                    title={`当前 ${priceAlerts.current.toFixed(2)} · 区间内 ${progressPct.toFixed(0)}%`}
                  />
                </div>
                <div className="flex justify-between mt-0.5 text-[8.5px] font-mono">
                  <span className="text-red-300/85" title={`距止损 ${distToStopPct.toFixed(1)}%`}>
                    🛡 ${item.stop_loss}
                  </span>
                  <span className="text-emerald-300/85" title={`距目标 ${distToTargetPct.toFixed(1)}%`}>
                    🎯 ${item.target_price}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}
      {(item.target_price || item.stop_loss) && (
        <div className="flex items-center gap-2 text-[9px] font-mono flex-wrap">
          {/* 目标价 + 距当前价 % */}
          {item.target_price && (
            <span
              className={`flex items-center gap-0.5 ${
                priceAlerts?.target?.tone === "above"
                  ? "text-emerald-300 font-semibold"
                  : priceAlerts?.target?.tone === "near"
                  ? "text-cyan-300"
                  : "text-emerald-300/60"
              }`}
              title={priceAlerts
                ? `当前价 ${priceAlerts.current.toFixed(2)} vs 目标 ${item.target_price}：${
                    priceAlerts.target.gap >= 0 ? "已达 +" : "距 "
                  }${Math.abs(priceAlerts.target.gap * 100).toFixed(1)}%`
                : "目标价"}
            >
              ▲ {item.target_price}
              {priceAlerts?.target && (
                <span className="text-[9px] opacity-80">
                  {priceAlerts.target.gap >= 0
                    ? ` +${(priceAlerts.target.gap * 100).toFixed(1)}%`
                    : ` ${(priceAlerts.target.gap * 100).toFixed(1)}%`}
                </span>
              )}
            </span>
          )}
          {/* 止损位 + 距当前价 % */}
          {item.stop_loss && (
            <span
              className={`flex items-center gap-0.5 ${
                priceAlerts?.stop?.tone === "below"
                  ? "text-red-400 font-semibold animate-pulse"
                  : priceAlerts?.stop?.tone === "near"
                  ? "text-amber-300"
                  : "text-red-300/60"
              }`}
              title={priceAlerts
                ? `当前价 ${priceAlerts.current.toFixed(2)} vs 止损 ${item.stop_loss}：${
                    priceAlerts.stop.gap < 0 ? "已破 " : "距 +"
                  }${Math.abs(priceAlerts.stop.gap * 100).toFixed(1)}%`
                : "止损位"}
            >
              ▼ {item.stop_loss}
              {priceAlerts?.stop && (
                <span className="text-[9px] opacity-80">
                  {priceAlerts.stop.gap < 0
                    ? ` ${(priceAlerts.stop.gap * 100).toFixed(1)}%`
                    : ` +${(priceAlerts.stop.gap * 100).toFixed(1)}%`}
                </span>
              )}
            </span>
          )}
          {/* 当前价小字（仅有 quote 时） */}
          {priceAlerts && (
            <span className="text-[9px] text-[#7a8497] ml-auto">
              ${priceAlerts.current.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {item.tags.map((t) => (
            <span key={t} className="text-[9px] px-1 py-px rounded bg-white/5 text-[#a0aec0] border border-white/10">#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
