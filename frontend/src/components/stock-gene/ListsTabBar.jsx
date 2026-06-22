// ListsTabBar — 顶部 list 切换 tabs（含创建/重命名/删除入口）
import React from "react";
import { Edit2, Layers, Plus, X } from "lucide-react";
import { listColor } from "./helpers.js";
import { useLang } from "../../i18n.jsx";

export function ListsTabBar({ lists, activeId, onSelect, onCreate, onRename, onDelete, itemCounts }) {
  const { t } = useLang();
  return (
    <div className="px-3 py-1.5 glass-card border border-white/10 flex items-center gap-1 overflow-x-auto">
      <Layers size={11} className="text-[#7a8497] shrink-0" />
      {lists.map(l => {
        const c = listColor(l.color);
        const active = l.id === activeId;
        const count = itemCounts[l.id] || 0;
        const isDefault = l.id === "default";
        return (
          <div key={l.id} className="flex items-center group/listtab">
            <button
              onClick={() => onSelect(l.id)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition whitespace-nowrap ${
                active
                  ? `${c.active} ${c.border}`
                  : "bg-white/[0.02] border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/5"
              }`}
              title={`切换到 ${l.name}（${count} 只）`}
            >
              <span>{l.name}</span>
              <span className="text-[9px] opacity-70 font-mono">{count}</span>
            </button>
            {!isDefault && (
              <div className="opacity-0 group-hover/listtab:opacity-100 transition flex items-center -ml-0.5">
                <button
                  onClick={() => onRename(l)}
                  className="p-0.5 text-[#7a8497] hover:text-white"
                  title={t("重命名 / 改颜色")}
                >
                  <Edit2 size={9} />
                </button>
                <button
                  onClick={() => onDelete(l)}
                  className="p-0.5 text-[#7a8497] hover:text-rose-300"
                  title={t("删除（items 移到默认）")}
                >
                  <X size={10} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={onCreate}
        aria-label={t("新建分组")}
        className="flex items-center justify-center w-6 h-6 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 transition"
        title={t("新建分组")}
      >
        <Plus size={10} />
      </button>
    </div>
  );
}
