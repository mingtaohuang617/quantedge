// ─────────────────────────────────────────────────────────────
// C10: 极简 IndexedDB 包装 — 用于持久化 localStorage 装不下的大对象
// 浏览器原生 API，无依赖。所有操作返回 Promise。
//
// 设计：
// - store 'kv' (v1)：键值对模型，对外像 localStorage 一样（保留兼容）
// - store 'prices' (v2)：股价缓存（priceCache.js 使用）
// - store 'meta'   (v2)：缓存元数据 / 标的诊断信息
// - 失败时静默返回 null（避免崩溃应用）
// - localStorage 仍是首选（同步、快），IDB 只作为大数据 / 容量超限时的回退
// ─────────────────────────────────────────────────────────────

const DB_NAME = "quantedge";
const DB_VERSION = 2;            // v2: 新增 prices + meta stores（v1 是 kv）
export const STORE_KV = "kv";
export const STORE_PRICES = "prices";
export const STORE_META = "meta";

let _dbPromise = null;
export function openDB() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // 幂等创建所有 store —— 兼容 v0→v2 直升、v1→v2 升级、v2 已存在
        if (!db.objectStoreNames.contains(STORE_KV))     db.createObjectStore(STORE_KV);
        if (!db.objectStoreNames.contains(STORE_PRICES)) db.createObjectStore(STORE_PRICES);
        if (!db.objectStoreNames.contains(STORE_META))   db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

// ── KV store 便捷封装（向后兼容）──────────────────────────
export async function idbGet(key) { return idbGetStore(STORE_KV, key); }
export async function idbSet(key, value) { return idbSetStore(STORE_KV, key, value); }
export async function idbDel(key) { return idbDelStore(STORE_KV, key); }

// ── 通用按 store 名读写 ───────────────────────────────────
export async function idbGetStore(storeName, key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function idbSetStore(storeName, key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export async function idbDelStore(storeName, key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// 估算 IDB 已用空间（字节），用于 UI 诊断
export async function idbEstimate() {
  if (typeof navigator?.storage?.estimate !== "function") return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
