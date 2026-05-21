// ─────────────────────────────────────────────────────────────
// candidateSort — 候选股表列排序（pure，可测）
// ─────────────────────────────────────────────────────────────
// 用户点击列头排序时调用：
//   sortCandidates(items, "pe", "asc")    // 低 PE 在前
//   sortCandidates(items, "marketCap", "desc")  // 大市值在前
//
// 设计：
//   - 缺字段（null / undefined / 非有限数字）一律排到末尾，与方向无关
//     —— 否则用户切 desc 想看"最高 PE"时，缺字段会显示在最上面
//   - 不 mutate 输入数组（返回新数组）
//   - sortKey=null 或非已知列 → 返回原数组（unchanged）
// ─────────────────────────────────────────────────────────────

/** 排序候选股数组（不 mutate；返回新数组）。 */
export function sortCandidates(items, sortKey, sortDir = "asc") {
  if (!Array.isArray(items)) return [];
  if (!sortKey) return items;
  const dir = sortDir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    const aMissing = av == null || !Number.isFinite(av);
    const bMissing = bv == null || !Number.isFinite(bv);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;   // 缺字段排末尾，与 sortDir 无关
    if (bMissing) return -1;
    return (av - bv) * dir;
  });
}

/**
 * 计算点击列头后的新 (sortKey, sortDir)。
 *   - 同 key 点击：asc → desc → asc 循环（保持 sortKey 不变）
 *   - 新 key：marketCap 默认 asc（小市值优先 / 与 backend 默认一致），其他默认 desc
 */
export function nextSortState(prevKey, prevDir, clickedKey) {
  if (prevKey === clickedKey) {
    return { sortKey: clickedKey, sortDir: prevDir === "asc" ? "desc" : "asc" };
  }
  return {
    sortKey: clickedKey,
    sortDir: clickedKey === "marketCap" ? "asc" : "desc",
  };
}
