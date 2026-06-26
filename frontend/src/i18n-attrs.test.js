// i18n 防回归：断言 placeholder / title / aria-label / alt 四个显示属性里没有 hardcoded 中文。
// 防的是 audit-i18n（只扫 JSX 文本节点）和 audit-i18n-keys（只验 key 在不在字典）都盖不到的一类泄漏：
//   placeholder="例: …"  /  title={`按 ${x} 排序`}  → 过两个 audit 却在 en 模式显简体。
// 复用 scripts/audit-i18n-attrs.mjs 的扫描逻辑（字面量属性 + 表达式属性内裸中文字面量）。
import { describe, it, expect } from "vitest";
import { findRawAttrs } from "../scripts/audit-i18n-attrs.mjs";

describe("显示属性无裸中文（i18n 防回归）", () => {
  it("placeholder/title/aria-label/alt 都不是 hardcoded 中文（须经 t()）", () => {
    const { report } = findRawAttrs();
    const flat = report.flatMap((r) => r.offs.map((o) => `${r.file}:${o.line}  ${o.attr}=${o.text}`));
    // 若失败：把该属性值包 t()（如 placeholder={t('…')} / title={t('…{x}…', { x })}）
    expect(flat).toEqual([]);
  });
});
