// ─────────────────────────────────────────────────────────────
// C10: 极简 IndexedDB 包装 — 用于持久化 localStorage 装不下的大对象
// 浏览器原生 API，无依赖。所有操作返回 Promise。
//
// 设计：
// - 单 store 'kv' (key/value)，键值对模型，对外像 localStorage 一样
// - 失败时静默返回 null（避免崩溃应用）
// - localStorage 仍是首选（同步、快），IDB 只作为大数据 / 容量超限时的回退
// ─────────────────────────────────────────────────────────────

const DB_NAME = "quantedge";
const DB_VERSION = 1;
const STORE = "kv";

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _dbPromise;
}

export async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export async function idbDel(key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
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
