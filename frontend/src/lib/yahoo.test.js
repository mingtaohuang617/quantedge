// yahoo.test — Yahoo Finance helper 单测
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  tickerToYahoo,
  yahooChartUrl,
  fetchYahooChart,
  fetchCurrentPrice,
  fetchPriceHistory,
} from "./yahoo.js";

describe("tickerToYahoo — 代码规范化", () => {
  it("美股纯 ticker 原样返回", () => {
    expect(tickerToYahoo("NVDA")).toBe("NVDA");
    expect(tickerToYahoo("AAPL")).toBe("AAPL");
    expect(tickerToYahoo("BRK.A")).toBe("BRK.A"); // 美股带点不变
  });

  it(".HK 港股去前导 0 + padStart(4)", () => {
    expect(tickerToYahoo("00700.HK")).toBe("0700.HK"); // 5 位 → 4 位
    expect(tickerToYahoo("00005.HK")).toBe("0005.HK");
    expect(tickerToYahoo("0700.HK")).toBe("0700.HK"); // 4 位保持
    expect(tickerToYahoo("09988.HK")).toBe("9988.HK");
  });

  it(".SH 上交所 → .SS", () => {
    expect(tickerToYahoo("600519.SH")).toBe("600519.SS");
    expect(tickerToYahoo("601398.SH")).toBe("601398.SS");
  });

  it(".SZ 深交所原样保留", () => {
    expect(tickerToYahoo("000001.SZ")).toBe("000001.SZ");
    expect(tickerToYahoo("300750.SZ")).toBe("300750.SZ");
  });

  it("null / undefined / 空串 → null", () => {
    expect(tickerToYahoo(null)).toBeNull();
    expect(tickerToYahoo(undefined)).toBeNull();
    expect(tickerToYahoo("")).toBeNull();
  });
});

describe("yahooChartUrl — URL 构造", () => {
  it("默认 interval=1d range=1d", () => {
    const url = yahooChartUrl("NVDA");
    expect(url).toContain("/api/yahoo?host=query1");
    expect(url).toContain("interval%3D1d");
    expect(url).toContain("range%3D1d");
    expect(url).toContain("NVDA");
  });

  it("自定义 interval/range 进入 URL", () => {
    const url = yahooChartUrl("NVDA", "1d", "1mo");
    expect(url).toContain("interval%3D1d");
    expect(url).toContain("range%3D1mo");
  });

  it("ticker 含特殊字符走 encodeURIComponent", () => {
    const url = yahooChartUrl("BRK.A");
    expect(url).toContain("BRK.A");
  });
});

describe("fetchYahooChart — 拉 chart", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功 → 返回 chart.result[0]", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: 100 } }] },
      }),
    });
    const result = await fetchYahooChart("NVDA");
    expect(result?.meta?.regularMarketPrice).toBe(100);
  });

  it("HTTP !ok → 返回 null", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false });
    const result = await fetchYahooChart("NVDA");
    expect(result).toBeNull();
  });

  it("fetch throw → 返回 null（catch 兜底）", async () => {
    global.fetch.mockRejectedValueOnce(new Error("network"));
    const result = await fetchYahooChart("NVDA");
    expect(result).toBeNull();
  });

  it("非法 ticker → 不拉直接 null", async () => {
    const result = await fetchYahooChart(null);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("缺 chart.result → null", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chart: { error: "not found" } }),
    });
    const result = await fetchYahooChart("UNKNOWN");
    expect(result).toBeNull();
  });
});

describe("fetchCurrentPrice — 取 regularMarketPrice", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("成功 → number", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: 250.5 } }] },
      }),
    });
    expect(await fetchCurrentPrice("NVDA")).toBe(250.5);
  });

  it("meta 缺字段 → null", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chart: { result: [{ meta: {} }] } }),
    });
    expect(await fetchCurrentPrice("NVDA")).toBeNull();
  });

  it("price 非 number → null", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: "N/A" } }] },
      }),
    });
    expect(await fetchCurrentPrice("NVDA")).toBeNull();
  });
});

describe("fetchPriceHistory — 取 close 数组", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("成功 → number[]", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            { indicators: { quote: [{ close: [100, 101, 102, 103] }] } },
          ],
        },
      }),
    });
    const prices = await fetchPriceHistory("NVDA");
    expect(prices).toEqual([100, 101, 102, 103]);
  });

  it("close 缺失 → null", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ indicators: { quote: [{}] } }] },
      }),
    });
    expect(await fetchPriceHistory("NVDA")).toBeNull();
  });

  it("默认 range=1mo（拼到 URL）", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chart: { result: [{}] } }),
    });
    await fetchPriceHistory("NVDA");
    const callUrl = global.fetch.mock.calls[0][0];
    expect(callUrl).toContain("range%3D1mo");
  });
});
