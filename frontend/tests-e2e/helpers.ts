// 共享 Playwright 测试辅助 — 不能放在 .spec.ts 中（Playwright 禁止跨 spec import）
import type { Page } from '@playwright/test';

const ONBOARD_KEY = 'quantedge_onboarded_v1';

/** 通过同源 session API mock 登录；认证状态不再写入 localStorage。 */
export async function loginViaStorage(page: Page) {
  await page.route('**/api/auth/session', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: { id: 'private-investor', name: 'E2E Tester', plan: 'pro', workspace_id: 'private-default' },
          csrf_token: 'e2e-csrf-token',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
        meta: { schema_version: '1.0', request_id: 'e2e-session' },
      }),
    });
  });
  await page.addInitScript((onboardKey) => {
    try {
      window.localStorage.setItem(onboardKey, '1'); // 跳过 onboarding
    } catch {}
  }, ONBOARD_KEY);
}

/** 跳过首次访问的 Onboarding（不需要 auth） */
export async function skipOnboarding(page: Page) {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, '1'); } catch {}
  }, ONBOARD_KEY);
}
