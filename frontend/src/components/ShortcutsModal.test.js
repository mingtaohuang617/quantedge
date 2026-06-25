// buildShortcuts 单测 —— 锁住 tab→数字键 的派生映射。
// 回归保护：曾因 ShortcutsModal 硬编码标签，在 Smart Beta/Mining Alpha 插到
// 位置 3-4 后与实际按键行为不符（按 3 实际去 Smart Beta，帮助却写"实时监控"）。
// 现在标签从 TAB_CFG 派生，本测试确保派生规则（前 9 → 1-9，第 10 → 0）不回退。
import { describe, it, expect } from 'vitest';
import { buildShortcuts } from './ShortcutsModal.jsx';

const TABS_10 = [
  { id: 'scoring', label: '量化评分' },
  { id: 'backtest', label: '组合回测' },
  { id: 'smartBeta', label: 'Smart Beta' },
  { id: 'miningAlpha', label: 'Mining Alpha' },
  { id: 'monitor', label: '实时监控' },
  { id: 'journal', label: '投资日志' },
  { id: 'macro', label: '宏观看板' },
  { id: 'screener10x', label: '10x 猎手' },
  { id: 'stockgene', label: '股性检测' },
  { id: 'compound', label: '复利的力量' },
];

describe('buildShortcuts', () => {
  it('第一行始终是命令面板（Ctrl/⌘ + K）', () => {
    const rows = buildShortcuts(TABS_10);
    expect(rows[0].keys).toEqual(['Ctrl', 'K']);
    expect(rows[0].altKeys).toEqual(['⌘', 'K']);
  });

  it('前 9 个 tab 映射到数字键 1-9，标签来自 TAB_CFG（不再硬编码）', () => {
    const rows = buildShortcuts(TABS_10);
    // rows[1..9] 是 tab 切换行；desc 为 i18n 模板键 '切换到 {name}'，标签在 name 字段（渲染处 t() 插值）
    expect(rows[1]).toMatchObject({ keys: ['1'], desc: '切换到 {name}', name: '量化评分' });
    expect(rows[3]).toMatchObject({ keys: ['3'], desc: '切换到 {name}', name: 'Smart Beta' });   // 曾错写"实时监控"
    expect(rows[4]).toMatchObject({ keys: ['4'], desc: '切换到 {name}', name: 'Mining Alpha' }); // 曾错写"投资日志"
    expect(rows[9]).toMatchObject({ keys: ['9'], desc: '切换到 {name}', name: '股性检测' });
  });

  it('第 10 个 tab 映射到数字键 0（与 handler e.key==="0"→idx 9 一致）', () => {
    const rows = buildShortcuts(TABS_10);
    expect(rows[10]).toMatchObject({ keys: ['0'], desc: '切换到 {name}', name: '复利的力量' });
  });

  it('tab 数 < 10 时只生成对应行，不溢出', () => {
    const rows = buildShortcuts(TABS_10.slice(0, 3));
    const tabRows = rows.filter(r => r.desc?.startsWith('切换到'));
    expect(tabRows).toHaveLength(3);
    expect(tabRows.map(r => r.keys[0])).toEqual(['1', '2', '3']);
  });

  it('空 tabs → 只有非 tab 快捷键（命令面板 / J / K / R / 等）', () => {
    const rows = buildShortcuts([]);
    expect(rows.some(r => r.desc?.startsWith('切换到'))).toBe(false);
    expect(rows[0].keys).toEqual(['Ctrl', 'K']);
    // J/K/R/?//Esc 等全局键仍在
    expect(rows.some(r => r.keys[0] === 'Esc')).toBe(true);
  });

  it('tab 多于 10 个也最多取 10 行（1-9 + 0）', () => {
    const tabs15 = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, label: `T${i}` }));
    const rows = buildShortcuts(tabs15);
    const tabRows = rows.filter(r => r.desc?.startsWith('切换到'));
    expect(tabRows).toHaveLength(10);
    expect(tabRows[9].keys).toEqual(['0']);
  });
});
