import { describe, it, expect } from "vitest";
import { sectorRegimeExposure } from "./sectorRegimeExposure.js";

const entry = (ticker, shares, price, name = ticker) => ({ ticker, shares, currentPrice: price, name });
const stk = (ticker, sector, fundamental, technical, name = ticker) => ({
  ticker, name, sector, score: 50,
  subScores: { fundamental, technical, growth: 50 },
});

describe("sectorRegimeExposure", () => {
  it("returns null on missing inputs", () => {
    expect(sectorRegimeExposure([], [], 60)).toBeNull();
    expect(sectorRegimeExposure([entry("A", 10, 100)], [stk("A", "Tech", 30, 80)], null)).toBeNull();
    expect(sectorRegimeExposure(null, [], 60)).toBeNull();
  });

  it("groups holdings by primary sector", () => {
    const entries = [
      entry("AAPL", 10, 200),  // $2000 Tech
      entry("NVDA", 5, 800),   // $4000 Tech
      entry("JPM", 20, 150),   // $3000 Banking
    ];
    const stocks = [
      stk("AAPL", "Tech", 40, 70),
      stk("NVDA", "Tech", 30, 80),
      stk("JPM", "Banking", 80, 30),
    ];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors.length).toBe(2);
    const tech = r.sectors.find(s => s.sector === "Tech");
    const banking = r.sectors.find(s => s.sector === "Banking");
    expect(tech.count).toBe(2);
    expect(banking.count).toBe(1);
    expect(tech.weight).toBeCloseTo(66.7, 0);   // 6000 / 9000
    expect(banking.weight).toBeCloseTo(33.3, 0); // 3000 / 9000
  });

  it("strips composite sector tags (Tech/AI → Tech)", () => {
    const entries = [entry("A", 10, 100)];
    const stocks = [stk("A", "Tech/AI", 30, 80)];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors[0].sector).toBe("Tech");
  });

  it("computes value-weighted avg Δ within sector", () => {
    // Tech: AAPL $2000 with Δ=+1.8 + NVDA $4000 with Δ=+3
    // weighted avg = (2000*1.8 + 4000*3) / 6000 = (3600+12000)/6000 = 2.6
    const entries = [entry("AAPL", 10, 200), entry("NVDA", 5, 800)];
    const stocks = [stk("AAPL", "Tech", 40, 70), stk("NVDA", "Tech", 30, 80)];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors[0].avgDelta).toBeCloseTo(2.6, 1);
  });

  it("sorts sectors by risk score (weight × |avgDelta|)", () => {
    // Tech: 66.7% weight, avgDelta +2.6 → risk = 1.73
    // Banking: 33.3% weight, avgDelta -3 → risk = 1.0
    const entries = [entry("AAPL", 10, 200), entry("NVDA", 5, 800), entry("JPM", 20, 150)];
    const stocks = [
      stk("AAPL", "Tech", 40, 70), stk("NVDA", "Tech", 30, 80),
      stk("JPM", "Banking", 80, 30),
    ];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors[0].sector).toBe("Tech");
    expect(r.sectors[1].sector).toBe("Banking");
  });

  it("flags top sector when weight ≥ 20% AND |avgDelta| ≥ 3", () => {
    // Tech 60% weight + avgDelta=+3 (qualifying)
    const entries = [entry("A", 10, 600), entry("B", 5, 800)];
    const stocks = [
      stk("A", "Tech", 30, 80),  // delta=+3 at temp=80
      stk("B", "Banking", 70, 50),
    ];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.flag).not.toBeNull();
    expect(r.flag.sector).toBe("Tech");
    expect(r.flag.direction).toBe("tailwind");
  });

  it("no flag when weight < 20% even with extreme delta", () => {
    // Tech only 10% weight (1 of 11 shares), avgDelta=+3
    const entries = [entry("A", 1, 100), entry("B", 50, 18)];  // tech $100 vs bank $900
    const stocks = [stk("A", "Tech", 30, 80), stk("B", "Banking", 70, 50)];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.flag).toBeNull();
  });

  it("no flag when |avgDelta| < 3 even with high weight", () => {
    // 100% Tech but stocks balanced (fund=tech) so delta=0
    const entries = [entry("A", 10, 100), entry("B", 10, 100)];
    const stocks = [stk("A", "Tech", 50, 50), stk("B", "Tech", 50, 50)];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.flag).toBeNull();
  });

  it("limits top stocks per sector to 3", () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(`S${i}`, 10, 100));
    const stocks = entries.map((e, i) => stk(e.ticker, "Tech", 30 + i, 80 - i));
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors[0].stocks.length).toBe(3);
  });

  it("uses '未分类' for stocks with no sector", () => {
    const entries = [entry("X", 10, 100)];
    const stocks = [{
      ticker: "X", score: 50,
      subScores: { fundamental: 30, technical: 80, growth: 50 },
    }];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors[0].sector).toBe("未分类");
  });

  it("ignores entries when stock not found in liveStocks", () => {
    const entries = [entry("UNKNOWN", 10, 100), entry("A", 5, 200)];
    const stocks = [stk("A", "Tech", 30, 80)];
    const r = sectorRegimeExposure(entries, stocks, 80);
    expect(r.sectors.length).toBe(1);
    expect(r.sectors[0].sector).toBe("Tech");
  });
});
