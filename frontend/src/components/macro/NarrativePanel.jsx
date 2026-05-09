import React from "react";
import { Loader } from "lucide-react";

// AI 市场画像（DeepSeek 生成 150-200 字解读）
export default function NarrativePanel({ narrative, loading }) {
  if (!narrative && !loading) return null;
  return (
    <div className="bg-gradient-to-br from-indigo-500/[0.07] to-violet-500/[0.04] border border-indigo-400/[0.18] rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border bg-indigo-500/20 text-indigo-100 border-indigo-400/40">
          AI 解读
        </span>
        <span className="text-xs text-white/55">DeepSeek 当日宏观画像</span>
      </div>
      {loading ? (
        <div className="text-xs text-white/50 flex items-center gap-2">
          <Loader className="w-3 h-3 animate-spin" />
          生成中…
        </div>
      ) : (
        <div className="text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap">
          {narrative}
        </div>
      )}
    </div>
  );
}
