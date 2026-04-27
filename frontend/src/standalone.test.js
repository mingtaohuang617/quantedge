import { describe, it, expect } from "vitest";
import { resolveSector, validateStockData } from "./standalone.js";

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
