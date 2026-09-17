import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { loginViaStorage } from './helpers';
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const metrics = { lcpMs: 0, cls: 0, shifts: [] as { value: number; time: number; nodes: string[] }[] };
    Object.assign(window, { scoringPerformance: metrics });
    new PerformanceObserver(list => { for (const e of list.getEntries()) metrics.lcpMs = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number; sources?: { node?: Element }[] })[]) if (!e.hadRecentInput) { metrics.cls += e.value; metrics.shifts.push({ value: e.value, time: e.startTime, nodes: (e.sources || []).map(s => s.node?.outerHTML?.slice(0, 220) || '') }); } }).observe({ type: 'layout-shift', buffered: true });
  });
  await loginViaStorage(page);
  // Deterministic local snapshot: no third-party calls, account writes, or live trading data.
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort();
    if (u.pathname === '/api/auth/session') return route.fallback();
    if (/^\/(api|yahoo|yahoo-cookie|v8)\//.test(u.pathname)) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
});

async function recordPerformance(page: Page, info: TestInfo) {
  const metrics = await page.evaluate(() => ({
    ...(window as Window & { scoringPerformance: { lcpMs: number; cls: number } }).scoringPerformance,
    domContentLoadedMs: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventEnd,
  }));
  expect(metrics.cls).toBeLessThan(0.1);
  await writeFile(info.outputPath('performance.json'), JSON.stringify({ ...metrics, scope: 'Local unthrottled Chromium, offline snapshot; not real-user INP or a Lighthouse audit' }, null, 2));
}

test('desktop score equation, weights, classifications and missing-data state', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?tab=scoring');
  const provenance = page.getByTestId('scoring-provenance');
  await expect(provenance).toBeVisible({ timeout: 20000 });
  await expect(provenance).toContainText('评分行情截至');
  await expect(provenance).toContainText('财报期');
  await expect(page.getByTestId('scoring-validation-status')).toContainText('尚未通过完整样本外验证');
  await recordPerformance(page, testInfo);
  await expect(page.getByTestId('score-equation')).toContainText('60%');
  await page.getByTestId('score-weights-toggle').click();
  await page.getByRole('button', { name: '偏重趋势', exact: true }).click();
  await expect(page.getByTestId('score-equation')).toContainText('70%');
  const equation = await page.getByTestId('score-equation').innerText();
  const nums = equation.match(/[\d.]+/g)!.map(Number);
  expect(Math.round((nums[0] * nums[1] + nums[2] * nums[3]) / 10) / 10).toBe(nums[4]);
  await expect(page.getByTestId('selected-score-value')).toHaveText(nums[4].toFixed(1));
  await page.getByTestId('score-weights-toggle').click();
  await page.screenshot({ path: testInfo.outputPath('scoring-v3-desktop.png'), fullPage: true });
  await page.getByTestId('scoring-type-filter').click();
  await expect(page.getByRole('button', { name: '单股杠杆 ETF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '指数杠杆 ETF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '指数 ETF', exact: true }).click();
  // Select the first filtered asset; selection intentionally remains stable when filters change.
  await page.getByText('EWY', { exact: true }).first().click();
  await expect(provenance).toContainText('分项研究，不合成总分');
  await expect(page.getByTestId('asset-assessment')).toContainText('产品质量');
  await expect(page.getByTestId('asset-assessment')).toContainText('30 日买卖价差中位数');
  await expect(page.getByTestId('asset-assessment')).toContainText('缺少有效观测');
  await expect(page.getByTestId('asset-assessment')).toContainText('产品数据覆盖 60%');
  await expect(page.getByTestId('asset-assessment')).toContainText('0.59 %');
  await expect(page.getByTestId('score-equation')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('scoring-v3-pending-etf.png'), fullPage: true });
  await page.getByTestId('scoring-type-filter').click();
  await page.getByRole('button', { name: '指数杠杆 ETF', exact: true }).click();
  await page.getByText('TQQQ', { exact: true }).first().click();
  await expect(page.getByTestId('asset-assessment')).toContainText('产品数据覆盖 65%');
  await expect(page.getByTestId('asset-assessment')).toContainText('发行商本次响应缺少有效价差观测');
  await expect(page.getByTestId('asset-assessment')).toContainText('日均跟踪偏离');
  await expect(page.getByTestId('asset-assessment')).toContainText('减免截至 2026-09-30');
  await page.getByTestId('asset-assessment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('scoring-v32-product-data.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('asset-assessment').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('asset-assessment')).toContainText('52 个交易日');
  const productBox = await page.getByTestId('asset-assessment').boundingBox();
  expect(productBox!.x).toBeGreaterThanOrEqual(0);
  expect(productBox!.x + productBox!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('scoring-v32-product-data-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByText('SOXS', { exact: true }).first().click();
  const assessment = page.getByTestId('asset-assessment');
  await assessment.getByText('每日重置的持有路径情景', { exact: true }).click();
  await expect(assessment.locator('tbody tr')).toHaveCount(9);
  await assessment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('scoring-v31-leverage.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('asset-assessment').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('asset-assessment')).toBeVisible();
  const box = await page.getByTestId('asset-assessment').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('scoring-v31-leverage-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile scoring details fit the viewport and show dated evidence', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?tab=scoring');
  await expect(page.locator('.virt-row-m').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.virt-row-m').first().click();
  const provenance = page.getByTestId('scoring-provenance');
  await provenance.scrollIntoViewIfNeeded();
  await expect(provenance).toContainText('数据覆盖');
  await expect(provenance).toContainText('评分行情截至');
  await expect(page.getByTestId('scoring-validation-status')).toContainText('实验性研究');
  await recordPerformance(page, testInfo);
  const box = await provenance.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('scoring-v3-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
