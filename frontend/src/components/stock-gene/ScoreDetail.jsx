// ScoreDetail — 中栏评分详情面板
import React from "react";
import {
  AlertCircle, Loader, Sparkles, Trash2,
} from "lucide-react";
import {
  compositeScore, compositeStyle, eng, engResult, formatChecked,
} from "./helpers.js";
import { EngineRadar, ScoreSparkline } from "./viz.jsx";
import {
  VerdictBadge, FeatureRow, PositionCard, NotesBlock, TagsRow,
} from "./cards.jsx";

export function ScoreDetail({
  item, engine, onRescore, onDelete, scoring, onExplain, explainLoading, narrative,
  editingNotes, notesDraft, setNotesDraft, onEditNotes, onSaveNotes, onCancelNotes, notesSaving,
  onSaveTags, weights, position, lists, onMove,
}) {
  const cfg = eng(engine);
  const r = engResult(item, engine);
  const engineLabel = cfg.framework;
  const { composite } = compositeScore(item, weights);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部：ticker + verdict 大徽章 */}
      <div className="px-4 py-3 border-b border-white/8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[18px] font-bold text-white">{item.ticker}</span>
              <span className="text-[10px] text-[#a0aec0]">{item.market}</span>
            </div>
            {item.name && (
              <div className="text-[12px] text-[#d0d7e2]">{item.name}</div>
            )}
            {item.sector && (
              <div className="text-[10px] text-[#7a8497] mt-0.5">行业：{item.sector}</div>
            )}
          </div>
          {r && (
            <div className="flex items-end gap-2">
              <EngineRadar item={item} />
              <ScoreSparkline
                history={item.score_history}
                engine={engine}
                maxScore={r.max_score}
              />
              <div className="text-right">
                <VerdictBadge verdict={r.verdict} score={r.score} maxScore={r.max_score} available={r.available} />
                <div className="text-[9px] text-[#7a8497] mt-1">
                  {formatChecked(r.checked_at)}
                </div>
                {composite != null && (
                  <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-white/5 border-white/15">
                    <span className="text-[9px] text-[#7a8497]">综合</span>
                    <span className={`text-[11px] font-mono font-bold ${compositeStyle(composite).text}`}>
                      {composite}
                    </span>
                    <span className="text-[9px] text-[#7a8497]">/100</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onRescore}
            disabled={scoring}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition disabled:opacity-40 disabled:cursor-not-allowed ${cfg.btnBg}`}
            title={`重新跑${engineLabel}评分（${cfg.featureCount} 个特征）`}
          >
            {scoring ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {r ? `重新评分（${engineLabel}）` : `立即评分（${engineLabel}）`}
          </button>
          {r && onExplain && (
            <button
              onClick={onExplain}
              disabled={explainLoading}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="让 DeepSeek 用一段话解读这只票的强项 / 弱项 / 建议"
            >
              {explainLoading ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
              AI 解读
            </button>
          )}
          {lists && lists.length > 1 && onMove && (
            <select
              value={item.list_id || "default"}
              onChange={(e) => onMove(e.target.value)}
              className="px-1.5 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 transition cursor-pointer"
              title="移动到其它分组"
            >
              {lists.map(l => (
                <option key={l.id} value={l.id}>→ {l.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300 border border-white/10 hover:border-red-500/30 transition"
          >
            <Trash2 size={10} /> 删除
          </button>
        </div>
        {narrative && (
          <div className="mt-2 px-2 py-2 bg-violet-500/8 border border-violet-500/30 rounded text-[10px] text-[#d0d7e2] leading-relaxed">
            <div className="flex items-center gap-1 mb-1 text-[9px] text-violet-300">
              <Sparkles size={9} />
              <span>AI 解读（DeepSeek · {engineLabel}）</span>
              {narrative.cached && <span className="ml-auto text-[9px] text-violet-300/60">cached</span>}
            </div>
            {narrative.error ? (
              <span className="text-amber-300/90">{narrative.error}</span>
            ) : (
              <span>{narrative.text}</span>
            )}
          </div>
        )}
        <NotesBlock
          item={item}
          editing={editingNotes === item.ticker}
          draft={notesDraft}
          onDraftChange={setNotesDraft}
          onEdit={() => onEditNotes(item)}
          onSave={() => onSaveNotes(item.ticker)}
          onCancel={onCancelNotes}
          saving={notesSaving}
        />
        <TagsRow tags={item.tags || []} onChange={onSaveTags} />
        {position && <PositionCard position={position} />}
      </div>

      {/* 特征列表 */}
      <div className="flex-1 overflow-auto p-3">
        {!r && (
          <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] text-center">
            尚未评分（{engineLabel}） — 点击上方"立即评分"按钮
          </div>
        )}
        {r && r.warnings && r.warnings.length > 0 && (
          <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-300/90">
            {r.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1">
                <AlertCircle size={10} className="text-amber-400 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        {r && r.features && r.features.length === 0 && (
          <div className="p-3 text-[11px] text-[#7a8497] text-center">
            无法获取历史数据，请检查 ticker 是否正确
          </div>
        )}
        {r && r.features && r.features.map((f, idx) => (
          <FeatureRow key={f.id} feature={f} index={idx + 1} prefix={cfg.featurePrefix} />
        ))}
      </div>
    </div>
  );
}
