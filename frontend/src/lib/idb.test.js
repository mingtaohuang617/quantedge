// @vitest-environment jsdom
//
// idb — IndexedDB 极简包装的退化路径单测
//
// jsdom 不提供原生 IndexedDB（也不提供 navigator.storage.estimate），
// 本测试聚焦"防御性退化"路径：
// - indexedDB 全局对象缺失时所有方法应返回兜底值（null / false），不抛错
// - navigator.storage 缺失时 idbEstimate 返回 null
//
// 完整流程（实际打开 DB / put / get / delete）需要 fake-indexeddb 这类
// polyfill，本测试不引入新依赖；priceCache.test.js 已通过 vi.mock 间接覆盖。
//
// 用 vi.stubGlobal 而非直接赋值，因为 jsdom 把 navigator 设为只读 getter。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("idb defensive fallback (indexedDB undefined)", () => {
  let mod;

  beforeEach(async () => {
    // 关键：删掉 indexedDB 全局，触发退化路径
    vi.stubGlobal("indexedDB", undefined);
    // 每个 it 拿到干净 module（清掉 openDB 的 _dbPromise 缓存）
    vi.resetModules();
    mod = await import("./idb.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── openDB ─────────────────────────────────────────────
  it("openDB returns null when indexedDB is undefined", async () => {
    const db = await mod.openDB();
    expect(db).toBeNull();
  });

  it("openDB memoizes the promise (second call returns same resolution)", async () => {
    const a = await mod.openDB();
    const b = await mod.openDB();
    expect(a).toBe(b); // both null in degraded mode, but same reference semantics
  });

  // ─── idbGet/Set/Del + idbGetStore/SetStore/DelStore ─────
  it("idbGet returns null when no DB", async () => {
    expect(await mod.idbGet("any-key")).toBeNull();
  });

  it("idbSet returns false when no DB", async () => {
    expect(await mod.idbSet("any-key", "any-value")).toBe(false);
  });

  it("idbDel returns false when no DB", async () => {
    expect(await mod.idbDel("any-key")).toBe(false);
  });

  it("idbGetStore returns null when no DB (per store)", async () => {
    expect(await mod.idbGetStore(mod.STORE_KV, "k")).toBeNull();
    expect(await mod.idbGetStore(mod.STORE_PRICES, "k")).toBeNull();
    expect(await mod.idbGetStore(mod.STORE_META, "k")).toBeNull();
  });

  it("idbSetStore returns false when no DB (per store)", async () => {
    expect(await mod.idbSetStore(mod.STORE_KV, "k", "v")).toBe(false);
    expect(await mod.idbSetStore(mod.STORE_PRICES, "k", { a: 1 })).toBe(false);
    expect(await mod.idbSetStore(mod.STORE_META, "k", [1, 2])).toBe(false);
  });

  it("idbDelStore returns false when no DB", async () => {
    expect(await mod.idbDelStore(mod.STORE_KV, "k")).toBe(false);
  });

  // ─── store 常量 ─────────────────────────────────────────
  it("exports the 3 store name constants", () => {
    expect(mod.STORE_KV).toBe("kv");
    expect(mod.STORE_PRICES).toBe("prices");
    expect(mod.STORE_META).toBe("meta");
  });
});

// ─── idbEstimate ─────────────────────────────────────────
describe("idbEstimate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when navigator.storage is unavailable", async () => {
    vi.stubGlobal("navigator", { /* no storage */ });
    vi.resetModules();
    const mod = await import("./idb.js");
    expect(await mod.idbEstimate()).toBeNull();
  });

  it("returns null when navigator.storage.estimate is not a function", async () => {
    vi.stubGlobal("navigator", { storage: { /* no estimate */ } });
    vi.resetModules();
    const mod = await import("./idb.js");
    expect(await mod.idbEstimate()).toBeNull();
  });

  it("returns navigator.storage.estimate() result when available", async () => {
    const fakeQuota = { quota: 1024 * 1024 * 1024, usage: 128 * 1024 };
    const estimate = vi.fn(() => Promise.resolve(fakeQuota));
    vi.stubGlobal("navigator", { storage: { estimate } });
    vi.resetModules();
    const mod = await import("./idb.js");
    const result = await mod.idbEstimate();
    expect(result).toEqual(fakeQuota);
    expect(estimate).toHaveBeenCalledOnce();
  });

  it("returns null when navigator.storage.estimate() throws", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () => { throw new Error("quota api blocked"); },
      },
    });
    vi.resetModules();
    const mod = await import("./idb.js");
    expect(await mod.idbEstimate()).toBeNull();
  });

  it("returns null when navigator.storage.estimate() rejects", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () => Promise.reject(new Error("network")),
      },
    });
    vi.resetModules();
    const mod = await import("./idb.js");
    expect(await mod.idbEstimate()).toBeNull();
  });
});
