import { test, expect } from '@playwright/test';
import { skipOnboarding } from './helpers';

const INVITE = 'MintoInvest';

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

    // 严格检查无 JS 报错 — Maximize2 这类未定义的 ReferenceError 必须被捕获
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
