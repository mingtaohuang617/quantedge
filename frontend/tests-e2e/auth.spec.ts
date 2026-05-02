import { test, expect } from '@playwright/test';
import { skipOnboarding } from './helpers';

const INVITE = 'MtQuant2026_X9k7P';

test.describe('AuthPage', () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
  });

  test('错误邀请码显示提示', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/邀请码|invit/i).first();
    await expect(input).toBeVisible();
    await input.fill('WRONG_CODE');
    await page.locator('button[type="submit"]').click();
    // 错误提示应出现（包含 "邀请码" 或 "无效"）
    await expect(page.locator('text=/邀请|invalid|无效/i').first()).toBeVisible({ timeout: 3000 });
  });

  test('正确邀请码进入主界面 + 无 JS 报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    const input = page.getByPlaceholder(/邀请码|invit/i).first();
    await input.fill(INVITE);
    await page.locator('button[type="submit"]').click();

    // 进入后应至少有一个 tab 角色按钮存在
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500); // 让 footer + 异步 useEffect 全部跑完

    // 严格检查无 JS 报错 — pageerror + React 渲染期错误（ErrorBoundary 捕获的）双保险
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
    const renderError = await page.evaluate(() => (window as any).__QUANTEDGE_LAST_ERROR__);
    expect(renderError, `ErrorBoundary triggered: ${JSON.stringify(renderError)}`).toBeFalsy();
  });
});
