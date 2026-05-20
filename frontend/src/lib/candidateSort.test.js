// candidateSort — sortCandidates + nextSortState 单测
import { describe, it, expect } from 'vitest';
import { sortCandidates, nextSortState } from './candidateSort.js';

const A = { ticker: 'AAPL', marketCap: 3e12, pe: 30 };
const B = { ticker: 'NVDA', marketCap: 4e12, pe: 65 };
const C = { ticker: 'MSFT', marketCap: 3.5e12, pe: 35 };

describe('sortCandidates', () => {
  it('null sortKey → 返回原数组（不 mutate）', () => {
    const items = [A, B, C];
    const out = sortCandidates(items, null);
    expect(out).toBe(items);   // 同引用（unchanged 时不复制）
  });

  it('非数组输入 → 返回空数组', () => {
    expect(sortCandidates(null, 'pe')).toEqual([]);
    expect(sortCandidates(undefined, 'pe')).toEqual([]);
    expect(sortCandidates({}, 'pe')).toEqual([]);
  });

  it('marketCap asc → 小市值在前', () => {
    const out = sortCandidates([A, B, C], 'marketCap', 'asc');
    expect(out.map((x) => x.ticker)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('marketCap desc → 大市值在前', () => {
    const out = sortCandidates([A, B, C], 'marketCap', 'desc');
    expect(out.map((x) => x.ticker)).toEqual(['NVDA', 'MSFT', 'AAPL']);
  });

  it('pe asc → 低 PE 在前', () => {
    const out = sortCandidates([A, B, C], 'pe', 'asc');
    expect(out.map((x) => x.ticker)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('不 mutate 输入数组', () => {
    const items = [B, A, C];
    const original = [...items];
    sortCandidates(items, 'marketCap', 'asc');
    expect(items).toEqual(original);   // 原数组顺序不变
  });

  it('缺字段一律排到末尾（asc）', () => {
    const items = [
      { ticker: 'A', pe: 20 },
      { ticker: 'X', pe: null },
      { ticker: 'B', pe: 10 },
      { ticker: 'Y', pe: undefined },
    ];
    const out = sortCandidates(items, 'pe', 'asc');
    expect(out.map((x) => x.ticker)).toEqual(['B', 'A', 'X', 'Y']);
  });

  it('缺字段一律排到末尾（desc 同样行为）', () => {
    const items = [
      { ticker: 'A', pe: 20 },
      { ticker: 'X', pe: null },
      { ticker: 'B', pe: 10 },
    ];
    const out = sortCandidates(items, 'pe', 'desc');
    expect(out.map((x) => x.ticker)).toEqual(['A', 'B', 'X']);  // 缺字段还是末尾
  });

  it('NaN / Infinity 视为缺字段', () => {
    const items = [
      { ticker: 'A', pe: 20 },
      { ticker: 'X', pe: NaN },
      { ticker: 'Y', pe: Infinity },
    ];
    const out = sortCandidates(items, 'pe', 'asc');
    expect(out[0].ticker).toBe('A');
    // X 和 Y 在末尾（顺序不指定，但都在 A 之后）
    expect(out.slice(1).map((x) => x.ticker).sort()).toEqual(['X', 'Y']);
  });

  it('空数组 → 空数组', () => {
    expect(sortCandidates([], 'pe', 'asc')).toEqual([]);
  });

  it('单元素数组', () => {
    expect(sortCandidates([A], 'pe', 'asc')).toEqual([A]);
  });

  it('未识别 sortKey → 字段全 undefined → 顺序保留', () => {
    const items = [A, B, C];
    const out = sortCandidates(items, 'nonexistent', 'asc');
    expect(out.length).toBe(3);   // 不丢失元素；具体顺序由 sort stability 决定
  });
});

describe('nextSortState', () => {
  it('同 key 点击 → 切方向', () => {
    expect(nextSortState('pe', 'asc', 'pe')).toEqual({ sortKey: 'pe', sortDir: 'desc' });
    expect(nextSortState('pe', 'desc', 'pe')).toEqual({ sortKey: 'pe', sortDir: 'asc' });
  });

  it('新 key（marketCap）→ 默认 asc', () => {
    expect(nextSortState(null, 'asc', 'marketCap')).toEqual({ sortKey: 'marketCap', sortDir: 'asc' });
    expect(nextSortState('pe', 'desc', 'marketCap')).toEqual({ sortKey: 'marketCap', sortDir: 'asc' });
  });

  it('新 key（pe / pb / roe / dividend_yield）→ 默认 desc', () => {
    expect(nextSortState(null, 'asc', 'pe')).toEqual({ sortKey: 'pe', sortDir: 'desc' });
    expect(nextSortState(null, 'asc', 'pb')).toEqual({ sortKey: 'pb', sortDir: 'desc' });
    expect(nextSortState(null, 'asc', 'roe')).toEqual({ sortKey: 'roe', sortDir: 'desc' });
    expect(nextSortState('marketCap', 'asc', 'dividend_yield')).toEqual({
      sortKey: 'dividend_yield',
      sortDir: 'desc',
    });
  });

  it('循环点击 marketCap：asc → desc → asc', () => {
    let s = nextSortState(null, 'asc', 'marketCap');
    expect(s).toEqual({ sortKey: 'marketCap', sortDir: 'asc' });
    s = nextSortState(s.sortKey, s.sortDir, 'marketCap');
    expect(s).toEqual({ sortKey: 'marketCap', sortDir: 'desc' });
    s = nextSortState(s.sortKey, s.sortDir, 'marketCap');
    expect(s).toEqual({ sortKey: 'marketCap', sortDir: 'asc' });
  });
});
