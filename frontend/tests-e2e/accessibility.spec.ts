import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginViaStorage } from './helpers';

const pages = [
  '量化评分', '组合回测', 'Smart Beta', 'Mining Alpha', '实时监控',
  '投资日志', '宏观看板', '10x 猎手', '股性检测', '复利的力量',
];

test.describe('十个功能页无 serious 或 critical axe 问题', () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginViaStorage(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15_000 });
  });

  for (const [index, name] of pages.entries()) {
    test(name, async ({ page }) => {
      await page.locator('[role="tab"]').nth(index).click();
      await expect(page.locator('[role="tab"]').nth(index)).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(500);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
      const summary = blocking.map(item => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map(node => ({ html: node.html, target: node.target })),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
});
