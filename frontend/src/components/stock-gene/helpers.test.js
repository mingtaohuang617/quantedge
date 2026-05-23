// stock-gene/helpers.js 单测 — 4 个引擎加权综合分 + 配色 + 时间格式化。
//
// 这些纯函数是 StockGene 主视图核心：用户看到的"综合 78"是 compositeScore
// 算的，列表色块是 compositeStyle 决定的。出错会直接影响首屏。原本 0 测试。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  compositeScore, compositeStyle, formatChecked, formatFreshness,
  DEFAULT_WEIGHTS,
} from './helpers.js';

// ─────────────────────────────────────────────────────────────
// compositeScore — 4 引擎加权平均
// ─────────────────────────────────────────────────────────────
describe('compositeScore', () => {
  it('item 完全无评分 → { composite: null, scored: 0 }', () => {
    expect(compositeScore({})).toEqual({ composite: null, scored: 0 });
  });

  it('单引擎评分（trend 80/100）→ 综合 = 80', () => {
    const item = { last_result: { score: 80, max_score: 100 } };
    expect(compositeScore(item)).toEqual({ composite: 80, scored: 1 });
  });

  it('双引擎相同权重 → 平均分', () => {
    // DEFAULT_WEIGHTS 里 trend=30, value=30 相等
    const item = {
      last_result: { score: 90, max_score: 100 },   // 0.9
      last_value_result: { score: 30, max_score: 100 },   // 0.3
    };
    // 加权平均 = (30*0.9 + 30*0.3) / (30+30) = 0.6 → 60
    expect(compositeScore(item)).toEqual({ composite: 60, scored: 2 });
  });

  it('某引擎 max_score=0（避免除零）→ 跳过该引擎', () => {
    const item = {
      last_result: { score: 80, max_score: 100 },   // 计入
      last_value_result: { score: 50, max_score: 0 },     // 跳过：max_score=0
    };
    expect(compositeScore(item)).toEqual({ composite: 80, scored: 1 });
  });

  it('某引擎 score=null（未评分）→ 跳过该引擎', () => {
    const item = {
      last_result: { score: 80, max_score: 100 },
      last_value_result: { score: null, max_score: 100 },
    };
    expect(compositeScore(item)).toEqual({ composite: 80, scored: 1 });
  });

  it('weights 里某引擎权重=0 → 即使有评分也跳过', () => {
    const item = {
      last_result: { score: 80, max_score: 100 },
      last_value_result: { score: 30, max_score: 100 },
    };
    expect(compositeScore(item, { trend: 30, value: 0, signal: 0, risk: 0 }))
      .toEqual({ composite: 80, scored: 1 });
  });

  it('用 DEFAULT_WEIGHTS 跑 4 引擎全分 → 综合分介于 0-100', () => {
    const item = {
      last_result: { score: 80, max_score: 100 },
      last_value_result: { score: 40, max_score: 100 },
      last_signal_result: { score: 70, max_score: 100 },
      last_risk_result: { score: 60, max_score: 100 },
    };
    const { composite, scored } = compositeScore(item, DEFAULT_WEIGHTS);
    expect(scored).toBe(4);
    expect(composite).toBeGreaterThanOrEqual(0);
    expect(composite).toBeLessThanOrEqual(100);
    // 期望值：(30*0.8 + 30*0.4 + 10*0.7 + 30*0.6) / 100 = 0.61 → 61
    expect(composite).toBe(61);
  });

  it('item=null 不抛错（防御性）', () => {
    // engResult 用了 optional chaining，应当安全返回 null
    expect(compositeScore(null)).toEqual({ composite: null, scored: 0 });
  });
});

// ─────────────────────────────────────────────────────────────
// compositeStyle — 综合分配色
// ─────────────────────────────────────────────────────────────
describe('compositeStyle', () => {
  // 这是把数字映射到 VERDICT_STYLE 里的 strong/moderate/neutral/weak/unknown。
  // 我们只测分支：边界值 + null。
  it('null/undefined → unknown', () => {
    expect(compositeStyle(null)).toBeDefined();
    expect(compositeStyle(undefined)).toBeDefined();
    // 内部用 VERDICT_STYLE.unknown，至少应当返回个对象（不是 null）
    expect(compositeStyle(null)).not.toBeNull();
  });

  it('阈值边界：80 / 60 / 40', () => {
    // 各分支返回的对象引用必须不同（说明用了不同的 style）
    const s79 = compositeStyle(79);
    const s80 = compositeStyle(80);
    const s60 = compositeStyle(60);
    const s59 = compositeStyle(59);
    const s40 = compositeStyle(40);
    const s39 = compositeStyle(39);
    expect(s80).not.toBe(s79);   // 80 翻到 strong
    expect(s60).not.toBe(s59);   // 60 翻到 moderate
    expect(s40).not.toBe(s39);   // 40 翻到 neutral
  });

  it('100 / 0 极值不抛错', () => {
    expect(compositeStyle(100)).toBeDefined();
    expect(compositeStyle(0)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// formatChecked — ISO 时间 → 中文短格式
// ─────────────────────────────────────────────────────────────
describe('formatChecked', () => {
  it('null / "" → "未评分"', () => {
    expect(formatChecked(null)).toBe('未评分');
    expect(formatChecked('')).toBe('未评分');
    expect(formatChecked(undefined)).toBe('未评分');
  });

  it('合法 ISO 时间 → 返回非空字符串（不是"未评分"）', () => {
    const out = formatChecked('2024-11-01T08:30:00Z');
    expect(out).not.toBe('未评分');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('无效字符串 → 不抛错，返回原字符串作为 fallback', () => {
    // Date.toLocaleString 在 jsdom 上处理"abc"也不会抛异常，但 Date 是 Invalid Date
    const out = formatChecked('not-a-date');
    // 应当至少返回个字符串（不抛）
    expect(typeof out).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────
// formatFreshness — 相对时间标签
// ─────────────────────────────────────────────────────────────
describe('formatFreshness', () => {
  beforeEach(() => {
    // 锁定"现在"为 2024-11-01T12:00:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-11-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('null/"" → null', () => {
    expect(formatFreshness(null)).toBeNull();
    expect(formatFreshness('')).toBeNull();
    expect(formatFreshness(undefined)).toBeNull();
  });

  it('< 1 小时 → "N分钟前"（向上至少 1）', () => {
    // 30 分钟前
    expect(formatFreshness('2024-11-01T11:30:00Z')).toBe('30分钟前');
    // 10 秒前（不到 1 分钟，但应当 round 到至少 1）
    expect(formatFreshness('2024-11-01T11:59:50Z')).toBe('1分钟前');
  });

  it('1 小时到 1 天之间 → "N小时前"', () => {
    expect(formatFreshness('2024-11-01T09:00:00Z')).toBe('3小时前');
  });

  it('1 天到 30 天之间 → "N天前"', () => {
    expect(formatFreshness('2024-10-29T12:00:00Z')).toBe('3天前');
  });

  it('> 30 天 → 月/日 格式（toLocaleDateString fallback）', () => {
    const out = formatFreshness('2024-09-01T12:00:00Z');
    expect(out).not.toMatch(/分钟前|小时前|天前/);
    // 应当是 toLocaleDateString 的输出，非空
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('未来时间（时钟漂移）→ 不崩，至少返回 1 分钟前', () => {
    // 时钟漂移：服务端给的时间比客户端晚
    const out = formatFreshness('2024-11-01T12:30:00Z');
    // diffMin < 0，但 Math.max(1, round(diffMin)) 保证至少 1
    expect(out).toBe('1分钟前');
  });

  it('无效 ISO → null', () => {
    expect(formatFreshness('garbage')).toBeNull();
  });
});
