import { test, expect } from '@playwright/test';
import { loginViaStorage } from './helpers';

test.describe('Mobile v8 shell', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaStorage(page);
    await page.goto('/?tab=scoring');
    await expect(page.locator('nav.md\\:hidden[aria-label="主导航"]')).toBeVisible({ timeout: 15_000 });
  });

  test('五项主导航可达、URL 可恢复且页面无横向溢出', async ({ page }) => {
    const navTabs = page.locator('nav.md\\:hidden[aria-label="主导航"] [role="tab"]');
    await expect(navTabs).toHaveCount(5);

    for (const tab of await navTabs.all()) {
      const box = await tab.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole('tab', { name: '实时监控' }).click();
    await expect(page).toHaveURL(/tab=monitor/);
    await page.getByRole('tab', { name: '更多' }).click();
    await expect(page).toHaveURL(/tab=me/);
    await expect(page.getByText('研究工具').first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('系统状态可打开，个股详情支持系统返回关闭', async ({ page }) => {
    await page.getByRole('tab', { name: '更多' }).click();
    await page.getByRole('button', { name: /系统与数据状态/ }).last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('tab', { name: '量化评分' }).click();
    const firstStock = page.locator('.virt-row-m').first();
    await expect(firstStock).toBeVisible({ timeout: 15_000 });
    await firstStock.click();
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
    await page.goBack();
    await expect(firstStock).toBeVisible();
  });
});
