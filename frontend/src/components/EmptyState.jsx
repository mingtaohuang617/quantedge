import React from "react";

/**
 * EmptyState — inline empty-list placeholder.
 *
 * Usage:
 *   <EmptyState message="还没有观察项 — 点击添加" />
 *   <EmptyState message="暂无记录" className="py-2 text-[10px] text-[#778]" />
 *
 * Default style matches the common pattern across watchlists and panels:
 *   flex · items-center · justify-center · text-[11px] · text-[#7a8497] · p-4 · text-center
 * Override via `className` for size / color variants.
 */
export default function EmptyState({ message, className, children }) {
  return (
    <div
      className={
        className ??
        "flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center"
      }
    >
      {message ?? children}
    </div>
  );
}
