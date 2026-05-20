// priceCache — 单测覆盖 TTL / 新鲜度 / withCache 三段式逻辑
// 用 vi.mock 拦截 idb.js 层（in-memory store）
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock IDB 层：用 in-memory map 模拟
const memStore = new Map();
vi.mock('./idb.js', () => ({
  STORE_PRICES: 'prices',
  STORE_META: 'meta',
  idbGetStore: vi.fn((store, key) => Promise.resolve(memStore.get(`${store}:${key}`) ?? null)),
  idbSetStore: vi.fn((store, key, val) => {
    memStore.set(`${store}:${key}`, val);
    return Promise.resolve(true);
  }),
  idbDelStore: vi.fn((store, key) => {
    memStore.delete(`${store}:${key}`);
    return Promise.resolve(true);
  }),
}));

// 必须在 mock 后 import
const {
  TTL_MS,
  isFresh,
  getCached,
  setCached,
  delCached,
  withCache,
  withStockDataCache,
} = await import('./priceCache.js');

beforeEach(() => {
  memStore.clear();
  vi.clearAllMocks();
});

describe('TTL_MS', () => {
  it('已知 range 有 TTL', () => {
    expect(TTL_MS['1D']).toBeGreaterThan(0);
    expect(TTL_MS['1Y']).toBeGreaterThan(TTL_MS['1D']);
    expect(TTL_MS['stockData']).toBeGreaterThan(0);
  });

  it('短周期 TTL 比长周期短', () => {
    expect(TTL_MS['1D']).toBeLessThan(TTL_MS['1M']);
    expect(TTL_MS['1M']).toBeLessThan(TTL_MS['1Y']);
  });
});

describe('isFresh', () => {
  it('null / undefined entry → false', () => {
    expect(isFresh(null)).toBe(false);
    expect(isFresh(undefined)).toBe(false);
  });

  it('缺 fetchedAt → false', () => {
    expect(isFresh({ ttlMs: 1000 })).toBe(false);
  });

  it('刚拉的（fetchedAt=now，TTL=1h）→ true', () => {
    const now = Date.now();
    expect(isFresh({ fetchedAt: now, ttlMs: 60 * 60 * 1000 })).toBe(true);
  });

  it('过期了（fetchedAt 2h 前，TTL=1h）→ false', () => {
    const now = Date.now();
    expect(isFresh({ fetchedAt: now - 2 * 60 * 60 * 1000, ttlMs: 60 * 60 * 1000 })).toBe(false);
  });

  it('恰好在 TTL 边界 → false（严格小于）', () => {
    const now = Date.now();
    expect(isFresh({ fetchedAt: now - 1000, ttlMs: 1000 })).toBe(false);
  });

  it('缺 ttlMs → 视为 0 → false', () => {
    const now = Date.now();
    expect(isFresh({ fetchedAt: now })).toBe(false);
  });
});

describe('getCached / setCached / delCached', () => {
  it('未存过 → getCached 返回 null', async () => {
    const r = await getCached('AAPL', '1Y');
    expect(r).toBeNull();
  });

  it('setCached 后能 getCached 回来', async () => {
    const points = [{ m: 1, p: 100 }, { m: 2, p: 110 }];
    await setCached('AAPL', '1Y', points);
    const r = await getCached('AAPL', '1Y');
    expect(r.points).toEqual(points);
    expect(r.fetchedAt).toBeGreaterThan(0);
    expect(r.ttlMs).toBe(TTL_MS['1Y']);
  });

  it('setCached 非数组 → 返回 false', async () => {
    const r = await setCached('AAPL', '1Y', null);
    expect(r).toBe(false);
    expect(await getCached('AAPL', '1Y')).toBeNull();
  });

  it('delCached 删除已存在的', async () => {
    await setCached('AAPL', '1Y', [{ m: 1, p: 100 }, { m: 2, p: 110 }]);
    await delCached('AAPL', '1Y');
    expect(await getCached('AAPL', '1Y')).toBeNull();
  });

  it('不同 ticker / range 独立存储', async () => {
    await setCached('AAPL', '1Y', [{ m: 1, p: 100 }, { m: 2, p: 110 }]);
    await setCached('NVDA', '1Y', [{ m: 1, p: 800 }, { m: 2, p: 850 }]);
    await setCached('AAPL', '6M', [{ m: 1, p: 95 }, { m: 2, p: 102 }]);
    expect((await getCached('AAPL', '1Y')).points[0].p).toBe(100);
    expect((await getCached('NVDA', '1Y')).points[0].p).toBe(800);
    expect((await getCached('AAPL', '6M')).points[0].p).toBe(95);
  });
});

describe('withCache — 三段式', () => {
  it('fresh-idb：fresh 缓存命中直接返回', async () => {
    const cached = [{ m: 1, p: 100 }, { m: 2, p: 110 }];
    await setCached('AAPL', '1Y', cached);
    const fetcher = vi.fn();
    const r = await withCache('AAPL', '1Y', fetcher);
    expect(r.source).toBe('fresh-idb');
    expect(r.points).toEqual(cached);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('network：缓存不存在 → 调 fetcher → 写回', async () => {
    const network = [{ m: 1, p: 90 }, { m: 2, p: 92 }];
    const fetcher = vi.fn().mockResolvedValue(network);
    const r = await withCache('AAPL', '1Y', fetcher);
    expect(r.source).toBe('network');
    expect(r.points).toEqual(network);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // 等异步回写完成
    await new Promise((res) => setTimeout(res, 5));
    const cached = await getCached('AAPL', '1Y');
    expect(cached.points).toEqual(network);
  });

  it('network 返回 <2 点但 IDB 有 stale → 用 stale', async () => {
    const stale = [{ m: 1, p: 100 }, { m: 2, p: 110 }];
    // 注入 stale entry（fetchedAt 是 1 年前）
    memStore.set(`prices:AAPL:1Y`, {
      points: stale, fetchedAt: Date.now() - 365 * 24 * 60 * 60 * 1000, ttlMs: 1000,
    });
    const fetcher = vi.fn().mockResolvedValue([{ m: 1, p: 100 }]);   // 只 1 点
    const r = await withCache('AAPL', '1Y', fetcher);
    expect(r.source).toBe('stale-idb');
    expect(r.points).toEqual(stale);
    expect(r.error).toMatch(/1 points/);
  });

  it('network 失败但 IDB 有 stale → 用 stale 兜底', async () => {
    const stale = [{ m: 1, p: 100 }, { m: 2, p: 110 }];
    memStore.set(`prices:AAPL:1Y`, {
      points: stale, fetchedAt: Date.now() - 100 * 24 * 3600 * 1000, ttlMs: 1000,
    });
    const fetcher = vi.fn().mockRejectedValue(new Error('Network 500'));
    const r = await withCache('AAPL', '1Y', fetcher);
    expect(r.source).toBe('stale-idb');
    expect(r.points).toEqual(stale);
    expect(r.error).toMatch(/Network 500/);
  });

  it('network 失败 + 无 stale → 抛错', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network 500'));
    await expect(withCache('AAPL', '1Y', fetcher)).rejects.toThrow('Network 500');
  });

  it('network 返回空数组 + 无 stale → source=empty', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const r = await withCache('AAPL', '1Y', fetcher);
    expect(r.source).toBe('empty');
    expect(r.points).toEqual([]);
  });
});

describe('withStockDataCache', () => {
  it('fresh 缓存命中 → 直接返回', async () => {
    const stockData = { ticker: 'AAPL', name: 'Apple', price: 150 };
    memStore.set(`prices:AAPL:stockData`, {
      data: stockData, fetchedAt: Date.now(), ttlMs: 60 * 60 * 1000,
    });
    const fetcher = vi.fn();
    const r = await withStockDataCache('AAPL', fetcher);
    expect(r.source).toBe('fresh-idb');
    expect(r.data).toEqual(stockData);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('未缓存 → 调 fetcher → 写回', async () => {
    const data = { ticker: 'AAPL', name: 'Apple' };
    const fetcher = vi.fn().mockResolvedValue(data);
    const r = await withStockDataCache('AAPL', fetcher);
    expect(r.source).toBe('network');
    expect(r.data).toEqual(data);
  });

  it('network 失败 + 有 stale → 用 stale', async () => {
    const stale = { ticker: 'AAPL', name: 'Apple (stale)' };
    memStore.set(`prices:AAPL:stockData`, {
      data: stale, fetchedAt: Date.now() - 100 * 24 * 3600 * 1000, ttlMs: 1000,
    });
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
    const r = await withStockDataCache('AAPL', fetcher);
    expect(r.source).toBe('stale-idb');
    expect(r.data).toEqual(stale);
  });
});
