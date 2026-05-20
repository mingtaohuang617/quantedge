// screener10xPrefs — load/save/sanitize 单测（pure node env，stub localStorage）
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PREFS, sanitizePrefs, loadPrefs, savePrefs, clearPrefs } from './screener10xPrefs.js';

// 简单的 in-memory localStorage stub（vitest 默认 node env，window 未定义）
function setupLocalStorage() {
  const store = new Map();
  global.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  return store;
}

function teardownLocalStorage() {
  delete global.window;
}

describe('sanitizePrefs — 类型保护', () => {
  it('null / undefined → 返回 DEFAULT_PREFS（克隆）', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it('非对象 → 返回 DEFAULT_PREFS', () => {
    expect(sanitizePrefs(42)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('foo')).toEqual(DEFAULT_PREFS);
  });

  it('部分字段提供 → 其余用默认', () => {
    const r = sanitizePrefs({ includeETF: true });
    expect(r.includeETF).toBe(true);
    expect(r.precise).toBe(DEFAULT_PREFS.precise);
    expect(r.markets).toEqual(DEFAULT_PREFS.markets);
  });

  it('markets 过滤非法值，全空时回退默认', () => {
    expect(sanitizePrefs({ markets: ['US', 'XX', 'HK'] }).markets).toEqual(['US', 'HK']);
    expect(sanitizePrefs({ markets: ['XX'] }).markets).toEqual(DEFAULT_PREFS.markets);
    expect(sanitizePrefs({ markets: [] }).markets).toEqual(DEFAULT_PREFS.markets);
  });

  it('activeStrategy 只接受 growth / value', () => {
    expect(sanitizePrefs({ activeStrategy: 'value' }).activeStrategy).toBe('value');
    expect(sanitizePrefs({ activeStrategy: 'crazy' }).activeStrategy).toBe(DEFAULT_PREFS.activeStrategy);
    expect(sanitizePrefs({ activeStrategy: null }).activeStrategy).toBe(DEFAULT_PREFS.activeStrategy);
  });

  it('maxMcapInput 必须是有限数且 >= 0', () => {
    expect(sanitizePrefs({ maxMcapInput: 100 }).maxMcapInput).toBe(100);
    expect(sanitizePrefs({ maxMcapInput: 0 }).maxMcapInput).toBe(0);
    expect(sanitizePrefs({ maxMcapInput: -5 }).maxMcapInput).toBe(DEFAULT_PREFS.maxMcapInput);
    expect(sanitizePrefs({ maxMcapInput: NaN }).maxMcapInput).toBe(DEFAULT_PREFS.maxMcapInput);
    expect(sanitizePrefs({ maxMcapInput: '50' }).maxMcapInput).toBe(DEFAULT_PREFS.maxMcapInput);
  });

  it('valueFilters 数字保留、null 保留、其他类型 → null', () => {
    const r = sanitizePrefs({
      valueFilters: {
        max_pe: 15,
        max_pb: null,
        min_roe: 'bad',          // 字符串 → null
        min_dividend_yield: NaN, // NaN → null
        max_debt_to_equity: 0.5,
      },
    });
    expect(r.valueFilters.max_pe).toBe(15);
    expect(r.valueFilters.max_pb).toBeNull();
    expect(r.valueFilters.min_roe).toBeNull();
    expect(r.valueFilters.min_dividend_yield).toBeNull();
    expect(r.valueFilters.max_debt_to_equity).toBe(0.5);
  });

  it('boolean 字段：非 boolean 被忽略', () => {
    expect(sanitizePrefs({ includeETF: 'true' }).includeETF).toBe(false);
    expect(sanitizePrefs({ precise: 1 }).precise).toBe(false);
    expect(sanitizePrefs({ showArchived: null }).showArchived).toBe(false);
  });
});

describe('loadPrefs / savePrefs — localStorage IO', () => {
  beforeEach(() => {
    teardownLocalStorage();
  });

  it('无 window → 返回 DEFAULT_PREFS', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('localStorage 空 → 返回 DEFAULT_PREFS', () => {
    setupLocalStorage();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    teardownLocalStorage();
  });

  it('save → load 回环', () => {
    setupLocalStorage();
    const prefs = { ...DEFAULT_PREFS, includeETF: true, precise: true, maxMcapInput: 1000 };
    savePrefs(prefs);
    const loaded = loadPrefs();
    expect(loaded.includeETF).toBe(true);
    expect(loaded.precise).toBe(true);
    expect(loaded.maxMcapInput).toBe(1000);
    teardownLocalStorage();
  });

  it('save 含非法字段 → load 自动 sanitize', () => {
    setupLocalStorage();
    // 模拟用户手改 localStorage 写入非法值
    global.window.localStorage.setItem('quantedge_screener10x_prefs', JSON.stringify({
      markets: ['US', 'INVALID'],
      activeStrategy: 'hacker',
      maxMcapInput: -999,
    }));
    const loaded = loadPrefs();
    expect(loaded.markets).toEqual(['US']);             // INVALID 被过滤
    expect(loaded.activeStrategy).toBe('growth');       // hacker 回退默认
    expect(loaded.maxMcapInput).toBe(50);               // 负数回退默认
    teardownLocalStorage();
  });

  it('损坏 JSON → 返回 DEFAULT_PREFS', () => {
    setupLocalStorage();
    global.window.localStorage.setItem('quantedge_screener10x_prefs', '{not valid json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    teardownLocalStorage();
  });

  it('clearPrefs 后 load 回到默认', () => {
    setupLocalStorage();
    savePrefs({ ...DEFAULT_PREFS, includeETF: true });
    expect(loadPrefs().includeETF).toBe(true);
    clearPrefs();
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    teardownLocalStorage();
  });
});
