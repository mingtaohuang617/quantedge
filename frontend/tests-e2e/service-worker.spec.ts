import { test, expect } from '@playwright/test';

test('first worker activation preserves the open form; later controller changes reload once', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ status: 403, json: { error: { code: 'unauthorized' } } }));
  // Hold the real first installation until there is user input to preserve.
  await page.addInitScript(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => new Promise((resolve, reject) => {
      window.addEventListener('test:install-worker', () => register(...args).then(resolve, reject), { once: true });
    });
  });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1; });
  await page.goto('/');
  const input = page.getByPlaceholder('请输入邀请码');
  await input.fill('unsent-user-input');
  await page.evaluate(() => window.dispatchEvent(new Event('test:install-worker')));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Observe beyond the controllerchange callback and a possible reload.
  await page.waitForTimeout(750);
  expect(navigations).toBe(1);
  await expect(input).toHaveValue('unsent-user-input');
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  });
  await expect.poll(() => navigations).toBe(2);
  await expect(input).toHaveValue('');
});
