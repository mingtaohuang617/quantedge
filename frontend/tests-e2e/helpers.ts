// 共享 Playwright 测试辅助 — 不能放在 .spec.ts 中（Playwright 禁止跨 spec import）
import type { Page } from '@playwright/test';

const STORE_KEY = 'quantedge_auth';
const ONBOARD_KEY = 'quantedge_onboarded_v1';

/** 通过注入 localStorage 跳过 AuthPage 邀请码流程 + Onboarding 教程 */
export async function loginViaStorage(page: Page) {
  await page.addInitScript(({ authKey, onboardKey }) => {
    try {
      window.localStorage.setItem(authKey, JSON.stringify({
        name: 'E2E Tester', loggedIn: true, ts: Date.now(),
      }));
      window.localStorage.setItem(onboardKey, '1'); // 跳过 onboarding
    } catch {}
  }, { authKey: STORE_KEY, onboardKey: ONBOARD_KEY });
}

/** 跳过首次访问的 Onboarding（不需要 auth） */
export async function skipOnboarding(page: Page) {
  await page.addInitScript((key) => {
    try { window.localStorage.setItem(key, '1'); } catch {}
  }, ONBOARD_KEY);
}
