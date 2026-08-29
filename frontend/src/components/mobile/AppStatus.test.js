import { describe, expect, it, vi, afterEach } from "vitest";
import { deriveAppStatus } from "./AppStatus.jsx";

describe("deriveAppStatus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("刷新优先于其他状态", () => {
    expect(deriveAppStatus({ apiOnline: false, updatedAt: null, refreshing: true })).toBe("refreshing");
  });

  it("区分实时、缓存、滞后与离线", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    expect(deriveAppStatus({ apiOnline: true, updatedAt: 1_000_000_000 - 60_000, refreshing: false })).toBe("live");
    expect(deriveAppStatus({ apiOnline: true, updatedAt: 1_000_000_000 - 10 * 60_000, refreshing: false })).toBe("cached");
    expect(deriveAppStatus({ apiOnline: true, updatedAt: 1_000_000_000 - 13 * 60 * 60_000, refreshing: false })).toBe("stale");
    expect(deriveAppStatus({ apiOnline: false, updatedAt: 1_000_000_000, refreshing: false })).toBe("offline");
  });
});
