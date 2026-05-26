// @vitest-environment jsdom
// loadStandaloneStocks / saveStandaloneStocks 依赖 localStorage，需要 jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSector,
  validateStockData,
  validateAllStocks,
  loadStandaloneStocks,
  saveStandaloneStocks,
} from "./standalone.js";

describe("resolveSector", () => {
  it("个股有人工映射时返回中文行业", () => {
    expect(resolveSector("NVDA", "Technology", false)).toBe("半导体");
  });

  it("无人工映射但 yahoo 返回标准英文 → 翻译", () => {
    const result = resolveSector("UNKNOWN_TICKER", "Technology", false);
    expect(result).toBe("科技");
  });

  it("ETF 兜底返回 ETF", () => {
    expect(resolveSector("FAKE_ETF", null, true)).toBe("ETF");
  });

  it("个股兜底返回 未知", () => {
    expect(resolveSector("FAKE_STOCK", null, false)).toBe("未知");
  });
});

describe("validateStockData", () => {
  it("空对象返回 F 级", () => {
    const r = validateStockData(null);
    expect(r.grade).toBe("F");
    expect(r.score).toBe(0);
  });

  it("缺 ticker 返回 F 级", () => {
    const r = validateStockData({});
    expect(r.grade).toBe("F");
  });

  it("基本完整数据评分 > 0", () => {
    const stk = {
      ticker: "NVDA",
      name: "NVIDIA",
      price: 100,
      change: 1.2,
      priceHistory: [{ m: "1/1", p: 100 }],
      priceRanges: {
        "1M": Array.from({ length: 20 }, (_, i) => ({ m: `${i}`, p: 100 + i })),
      },
    };
    const r = validateStockData(stk);
    expect(r.score).toBeGreaterThan(0);
    expect(r.grade).not.toBe("F");
  });

  it("价格异常 (负数) 触发 critical issue", () => {
    const stk = { ticker: "X", name: "X", price: -10, priceHistory: [], priceRanges: {} };
    const r = validateStockData(stk);
    expect(r.issues.some(i => i.dim === "accuracy" && i.severity === "critical")).toBe(true);
  });
});

// ─── validateAllStocks（聚合器）────────────────────────────
describe("validateAllStocks", () => {
  it("非数组输入返回空汇总", () => {
    const r = validateAllStocks(null);
    expect(r.summary.total).toBe(0);
    expect(r.details).toEqual([]);
  });

  it("空数组返回 total=0 + 空 details", () => {
    const r = validateAllStocks([]);
    expect(r.summary.total).toBe(0);
    expect(r.details).toEqual([]);
  });

  it("正常数组聚合 total / grades / avgScore", () => {
    const stocks = [
      { ticker: "A", name: "A", price: 100, priceHistory: [], priceRanges: {} },
      { ticker: "B", name: "B", price: -5, priceHistory: [], priceRanges: {} }, // critical
      { ticker: "C", name: "C", price: 50, priceHistory: [], priceRanges: {} },
    ];
    const r = validateAllStocks(stocks);
    expect(r.summary.total).toBe(3);
    expect(r.details).toHaveLength(3);
    // grades 应该是 5 档对象（A/B/C/D/F），count 之和 = total
    const gradeSum = ["A", "B", "C", "D", "F"].reduce((s, g) => s + (r.summary.grades[g] || 0), 0);
    expect(gradeSum).toBe(3);
    // 平均分应为 Math.round(各 score 平均)
    expect(typeof r.summary.avgScore).toBe("number");
  });

  it("details 按 score 升序（最差的排前面）", () => {
    const stocks = [
      { ticker: "GOOD", name: "G", price: 100, priceHistory: Array(20).fill({m:"x",p:100}),
        priceRanges: { "1M": Array(20).fill({m:"x",p:100}) } },
      { ticker: "BAD", name: "B", price: -5, priceHistory: [], priceRanges: {} },
    ];
    const r = validateAllStocks(stocks);
    // 最差的（BAD）应该在前
    expect(r.details[0].score).toBeLessThanOrEqual(r.details[1].score);
  });

  it("dimSummary 按维度聚合 issue 数 + critical/high 分级", () => {
    const stocks = [
      { ticker: "BAD1", name: "B1", price: -5, priceHistory: [], priceRanges: {} },
      { ticker: "BAD2", name: "B2", price: -10, priceHistory: [], priceRanges: {} },
    ];
    const r = validateAllStocks(stocks);
    expect(r.summary.dimSummary).toBeDefined();
    // accuracy 维度应有 2 个 critical（两只票都价格负）
    if (r.summary.dimSummary.accuracy) {
      expect(r.summary.dimSummary.accuracy.critical).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── loadStandaloneStocks + saveStandaloneStocks (localStorage) ────
describe("standalone stocks persistence", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch {}
  });

  it("loadStandaloneStocks 空 localStorage 返回空数组", () => {
    expect(loadStandaloneStocks()).toEqual([]);
  });

  it("loadStandaloneStocks 容错非法 JSON 返回空数组", () => {
    try { localStorage.setItem("quantedge_standalone_stocks", "{not-json"); } catch {}
    expect(loadStandaloneStocks()).toEqual([]);
  });

  it("save → load round-trip 正常数据", () => {
    const stocks = [
      { ticker: "NVDA", price: 188.99, change: 0.19 },
      { ticker: "AAPL", price: 195.0, change: -0.5 },
    ];
    saveStandaloneStocks(stocks);
    const back = loadStandaloneStocks();
    expect(back).toHaveLength(2);
    expect(back[0].ticker).toBe("NVDA");
    expect(back[0].change).toBe(0.19);
  });

  it("saveStandaloneStocks 把 |change| > 50% 归 0（防累计涨幅误塞入 change）", () => {
    const stocks = [
      { ticker: "WEIRD", price: 100, change: 87.5 },  // 应被归 0
      { ticker: "NORMAL", price: 200, change: 2.3 },   // 保留
      { ticker: "DEEP_NEG", price: 50, change: -65.0 }, // 应被归 0
    ];
    saveStandaloneStocks(stocks);
    const back = loadStandaloneStocks();
    expect(back[0].change).toBe(0);   // 87.5 → 0
    expect(back[1].change).toBe(2.3); // 不变
    expect(back[2].change).toBe(0);   // -65 → 0
  });

  it("saveStandaloneStocks 保留 change=0 / 边界 50（恰好不归零）", () => {
    const stocks = [
      { ticker: "FLAT", price: 100, change: 0 },
      { ticker: "EDGE_POS", price: 100, change: 50 },
      { ticker: "EDGE_NEG", price: 100, change: -50 },
    ];
    saveStandaloneStocks(stocks);
    const back = loadStandaloneStocks();
    expect(back[0].change).toBe(0);
    expect(back[1].change).toBe(50);  // 不严格 > 50 → 不归零
    expect(back[2].change).toBe(-50);
  });
});
