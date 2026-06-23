// i18n 防回归：断言所有「显示型中文串」都在 EN 字典里。
// 防的是本仓最常见回归：render 处包了 t(x) 但 EN 字典缺 key → en 模式穿透显示简体。
// 复用 scripts/audit-i18n-keys.mjs 的扫描逻辑（排除注释/逻辑串/插值模板/选择器/prompt 片段）。
import { describe, it, expect } from "vitest";
import { findMissingKeys } from "../scripts/audit-i18n-keys.mjs";

describe("EN 字典完整性（i18n 防回归）", () => {
  it("所有显示型中文串都在 EN 字典里（en 模式不会穿透显示简体）", () => {
    const { report } = findMissingKeys();
    const flat = report.flatMap((r) => r.offs.map((o) => `${r.file}:${o.line}  ${o.text}`));
    // 若失败：给 EN 字典补这些 key；确属非显示串（选择器/prompt 片段）请加进 audit-i18n-keys.mjs 的 ALLOW
    expect(flat).toEqual([]);
  });
});
