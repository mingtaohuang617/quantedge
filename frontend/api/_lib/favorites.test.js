// favorites serverless lib 测试 —— mock KV，不发任何网络请求
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock KV：用内存 Map 模拟 kvGetJson / kvSetJson ──
const _kvStore = new Map();
vi.mock('./kv.js', () => ({
  KV_ENABLED: true,
  kvGetJson: async (key, fallback) => (_kvStore.has(key) ? _kvStore.get(key) : fallback),
  kvSetJson: async (key, obj) => { _kvStore.set(key, JSON.parse(JSON.stringify(obj))); },
  kvGet: async () => null,
  kvSet: async () => {},
  kvDel: async () => {},
}));

import { loadFavorites, saveFavorites } from './favorites.js';

beforeEach(() => {
  _kvStore.clear();
});

describe('loadFavorites', () => {
  it('空 KV 返回空集合', async () => {
    const data = await loadFavorites();
    expect(data).toEqual({ version: 1, tickers: [], updated_at: null });
  });
});

describe('saveFavorites', () => {
  it('save → load 往返一致（已排序）', async () => {
    const saved = await saveFavorites(['EWY', 'TQQQ', 'SOXL', 'KORU']);
    expect(saved.tickers).toEqual(['EWY', 'KORU', 'SOXL', 'TQQQ']);
    expect(saved.updated_at).toBeTruthy();
    const reloaded = await loadFavorites();
    expect(reloaded.tickers).toEqual(['EWY', 'KORU', 'SOXL', 'TQQQ']);
  });

  it('去重 + 去空白 + 排序', async () => {
    const saved = await saveFavorites([' NVDA ', 'AAPL', 'NVDA', '', '  ', 'AAPL']);
    expect(saved.tickers).toEqual(['AAPL', 'NVDA']);
  });

  it('保大小写 + 带后缀的 ticker 原样往返', async () => {
    const saved = await saveFavorites(['00700.HK', '600519.SH', 'BABX']);
    expect(saved.tickers).toEqual(['00700.HK', '600519.SH', 'BABX']);
  });

  it('全量替换而非合并', async () => {
    await saveFavorites(['AAPL', 'MSFT']);
    const after = await saveFavorites(['NVDA']);
    expect(after.tickers).toEqual(['NVDA']);
    expect((await loadFavorites()).tickers).toEqual(['NVDA']);
  });

  it('空数组清空集合', async () => {
    await saveFavorites(['AAPL']);
    const after = await saveFavorites([]);
    expect(after.tickers).toEqual([]);
  });
});

describe('KV 未配置', () => {
  it('loadFavorites 返回空、saveFavorites 抛 KV_DISABLED', async () => {
    vi.resetModules();
    vi.doMock('./kv.js', () => ({
      KV_ENABLED: false,
      kvGetJson: async (_k, fb) => fb,
      kvSetJson: async () => {},
      kvGet: async () => null, kvSet: async () => {}, kvDel: async () => {},
    }));
    const mod = await import('./favorites.js');
    expect((await mod.loadFavorites()).tickers).toEqual([]);
    await expect(mod.saveFavorites(['AAPL'])).rejects.toMatchObject({ code: 'KV_DISABLED' });
    vi.doUnmock('./kv.js');
    vi.resetModules();
  });
});
