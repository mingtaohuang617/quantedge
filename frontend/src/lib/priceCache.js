// ─────────────────────────────────────────────────────────────
// 价格数据 IndexedDB 二级缓存
// ─────────────────────────────────────────────────────────────
//
// 解决两个生产问题：
//   1) 远程 API 限流 / 全挂时图表打不开
//   2) 单点失败导致组合回测无法运行
//
// 设计：
//   - 三段式: fresh-IDB → network → stale-IDB 兜底
//   - 命中即返回（不发网络）；未命中走网络成功后回写
//   - 网络失败时若有任何 stale 数据，仍然返回，附带 source='stale-idb' 标记
//   - 调用方可选择关心 source（用 *Ex 版本）或不关心（直接拿数组）
//
// IndexedDB schema（在 idb.js 里 v2 升级）：
//   store 'prices': key=`${ticker}:${range}`
//                   value={ points: [{m,p}], fetchedAt: number, ttlMs: number }
//   store 'meta'  : key=ticker, value={ lastFullFetch, errors }
// ─────────────────────────────────────────────────────────────

import { idbGetStore, idbSetStore, idbDelStore, STORE_PRICES, STORE_META } from "./idb.js";

// ── TTL 策略 ─────────────────────────────────────────────
// 短周期数据更新频繁，长周期数据可缓很久（日 K 一天才更新一次）
export const TTL_MS = {
  "1D":  5 * 60 * 1000,            // 5 min（盘中分钟数据）
  "5D":  15 * 60 * 1000,           // 15 min
  "1M":  30 * 60 * 1000,           // 30 min
  "6M":  4 * 60 * 60 * 1000,       // 4 h
  "YTD": 4 * 60 * 60 * 1000,       // 4 h
  "1Y":  12 * 60 * 60 * 1000,      // 12 h
  "5Y":  7 * 24 * 60 * 60 * 1000,  // 7 天
  "ALL": 30 * 24 * 60 * 60 * 1000, // 30 天
  stockData: 60 * 60 * 1000,       // 1 h —— 整个 fetchStockData 对象
};

const FRESH_FALLBACK_MS = 12 * 60 * 60 * 1000; // 未在表中的 range 用 12h

function ttlFor(range) {
  return TTL_MS[range] ?? FRESH_FALLBACK_MS;
}

function rangeKey(ticker, range) {
  return `${ticker}:${range}`;
}

// ── 基础读写 ─────────────────────────────────────────────
export async function getCached(ticker, range) {
  return idbGetStore(STORE_PRICES, rangeKey(ticker, range));
}

export async function setCached(ticker, range, points) {
  if (!points || !Array.isArray(points)) return false;
  const entry = {
    points,
    fetchedAt: Date.now(),
    ttlMs: ttlFor(range),
  };
  return idbSetStore(STORE_PRICES, rangeKey(ticker, range), entry);
}

export async function delCached(ticker, range) {
  return idbDelStore(STORE_PRICES, rangeKey(ticker, range));
}

export function isFresh(entry) {
  if (!entry || typeof entry.fetchedAt !== "number") return false;
  return (Date.now() - entry.fetchedAt) < (entry.ttlMs || 0);
}

// ── 三段式核心：withCache ────────────────────────────────
//
// fetcher: () => Promise<Array<{m, p}>>  — 实际拉数据的函数
// 返回: { points: Array, source: 'fresh-idb'|'network'|'stale-idb'|'empty', error?: string }
//
// 逻辑：
//   1. IDB 有 fresh 数据 → 直接返回
//   2. 走网络
//      a. 成功且 ≥2 点 → 写回 IDB，返回 network
//      b. 成功但 <2 点 → 若 IDB 有 stale ≥1 点，回退 stale；否则返回 empty
//      c. 网络异常   → 若 IDB 有 stale ≥1 点，回退 stale；否则向上抛
export async function withCache(ticker, range, fetcher) {
  const cached = await getCached(ticker, range);

  // 1) fresh-idb
  if (cached && isFresh(cached) && Array.isArray(cached.points) && cached.points.length >= 2) {
    return { points: cached.points, source: "fresh-idb" };
  }

  // 2) network
  try {
    const points = await fetcher();
    if (Array.isArray(points) && points.length >= 2) {
      // 异步回写，不阻塞返回
      setCached(ticker, range, points).catch(() => {});
      return { points, source: "network" };
    }
    // 网络返回了但数据不达标（<2 点）
    if (cached && Array.isArray(cached.points) && cached.points.length >= 1) {
      return {
        points: cached.points,
        source: "stale-idb",
        error: `network returned ${points?.length ?? 0} points`,
      };
    }
    return { points: points || [], source: "empty" };
  } catch (err) {
    // 3) stale-idb 兜底
    if (cached && Array.isArray(cached.points) && cached.points.length >= 1) {
      return {
        points: cached.points,
        source: "stale-idb",
        error: String(err?.message || err),
      };
    }
    throw err;
  }
}

// ── stockData 整对象缓存（fetchStockData 用）─────────────
const STOCK_DATA_KEY = (ticker) => `${ticker}:stockData`;

export async function getCachedStockData(ticker) {
  return idbGetStore(STORE_PRICES, STOCK_DATA_KEY(ticker));
}

export async function setCachedStockData(ticker, stockData) {
  if (!stockData) return false;
  return idbSetStore(STORE_PRICES, STOCK_DATA_KEY(ticker), {
    data: stockData,
    fetchedAt: Date.now(),
    ttlMs: TTL_MS.stockData,
  });
}

export async function withStockDataCache(ticker, fetcher) {
  const cached = await getCachedStockData(ticker);
  if (cached && isFresh(cached) && cached.data) {
    return { data: cached.data, source: "fresh-idb" };
  }
  try {
    const data = await fetcher();
    if (data) {
      setCachedStockData(ticker, data).catch(() => {});
      return { data, source: "network" };
    }
    if (cached?.data) {
      return { data: cached.data, source: "stale-idb", error: "network returned null" };
    }
    return { data: null, source: "empty" };
  } catch (err) {
    if (cached?.data) {
      return {
        data: cached.data,
        source: "stale-idb",
        error: String(err?.message || err),
      };
    }
    throw err;
  }
}

// ── 诊断辅助 ─────────────────────────────────────────────
// 注意：不实现 list-all（IDB 没有方便的扫描 API），需要时让调用方自己存已知 key 列表到 meta
export async function getMeta(ticker) {
  return idbGetStore(STORE_META, ticker);
}

export async function setMeta(ticker, meta) {
  return idbSetStore(STORE_META, ticker, meta);
}
