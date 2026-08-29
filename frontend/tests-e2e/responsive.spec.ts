import { expect, test } from '@playwright/test';
import { loginViaStorage } from './helpers';

const widths = [360, 390, 768, 1024, 1280, 1440, 2048];

test.describe('响应式与缩放边界', () => {
  for (const width of widths) {
    test(`${width}px 无页面级横向溢出`, async ({ page }) => {
      await loginViaStorage(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
      expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
    });
  }

  for (const zoom of [1.25, 1.5]) {
    test(`${Math.round(zoom * 100)}% 缩放无横向溢出`, async ({ page }) => {
      await loginViaStorage(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 });
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
