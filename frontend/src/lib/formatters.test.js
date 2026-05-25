// formatters.test — 数值格式化 helper 单测
import { describe, it, expect } from "vitest";
import { fmtMcap, fmtNum, fmtPct } from "./formatters.js";

describe("fmtMcap — 市值档位", () => {
  it("万亿档：1T+ → '1.23T'", () => {
    expect(fmtMcap(1.234e12)).toBe("1.23T");
    expect(fmtMcap(3.5e12)).toBe("3.50T");
    expect(fmtMcap(1e12)).toBe("1.00T"); // 边界刚好 1T
  });

  it("十亿档：1B-999B → '150.20B'", () => {
    expect(fmtMcap(150.2e9)).toBe("150.20B");
    expect(fmtMcap(1e9)).toBe("1.00B"); // 1B 边界
    expect(fmtMcap(999.99e9)).toBe("999.99B");
  });

  it("百万档：1M-999M → '500M'（无小数）", () => {
    expect(fmtMcap(500e6)).toBe("500M");
    expect(fmtMcap(1e6)).toBe("1M");
    expect(fmtMcap(999e6)).toBe("999M");
  });

  it("百万以下整数", () => {
    expect(fmtMcap(12345)).toBe("12345");
    expect(fmtMcap(0)).toBe("0");
  });

  it("null / undefined / NaN / Infinity → '—'", () => {
    expect(fmtMcap(null)).toBe("—");
    expect(fmtMcap(undefined)).toBe("—");
    expect(fmtMcap(NaN)).toBe("—");
    expect(fmtMcap(Infinity)).toBe("—");
    expect(fmtMcap(-Infinity)).toBe("—");
  });

  it("非 number 类型 → '—'", () => {
    expect(fmtMcap("100")).toBe("—");
    expect(fmtMcap({})).toBe("—");
  });
});

describe("fmtNum — 一般数值", () => {
  it("默认 prec=2", () => {
    expect(fmtNum(3.14159)).toBe("3.14");
    expect(fmtNum(0)).toBe("0.00");
    expect(fmtNum(-1.5)).toBe("-1.50");
  });

  it("显式 prec=1", () => {
    expect(fmtNum(3.14159, 1)).toBe("3.1");
    expect(fmtNum(25.5, 1)).toBe("25.5");
  });

  it("显式 prec=0", () => {
    expect(fmtNum(3.7, 0)).toBe("4"); // toFixed 四舍五入
    expect(fmtNum(3.4, 0)).toBe("3");
  });

  it("显式 prec=3", () => {
    expect(fmtNum(0.123456, 3)).toBe("0.123");
  });

  it("null / undefined / NaN / Infinity → '—'", () => {
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtNum(NaN)).toBe("—");
    expect(fmtNum(Infinity)).toBe("—");
    expect(fmtNum(-Infinity)).toBe("—");
  });

  it("非 number 类型 → '—'", () => {
    expect(fmtNum("3.14")).toBe("—");
    expect(fmtNum(false)).toBe("—");
  });
});

describe("fmtPct — 百分比", () => {
  it("0.05 → '5.0%'", () => {
    expect(fmtPct(0.05)).toBe("5.0%");
    expect(fmtPct(0.15)).toBe("15.0%");
    expect(fmtPct(0.123)).toBe("12.3%");
  });

  it("负数", () => {
    expect(fmtPct(-0.05)).toBe("-5.0%");
  });

  it("0 → '0.0%'", () => {
    expect(fmtPct(0)).toBe("0.0%");
  });

  it("超过 100% 也照常显示", () => {
    expect(fmtPct(1.5)).toBe("150.0%");
    expect(fmtPct(10)).toBe("1000.0%");
  });

  it("null / undefined / NaN / Infinity → '—'", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(NaN)).toBe("—");
    expect(fmtPct(Infinity)).toBe("—");
  });
});
