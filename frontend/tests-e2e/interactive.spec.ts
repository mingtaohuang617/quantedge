// 全交互 E2E — 模拟真实用户点击主要按钮，监听全程 pageerror
// 这个测试就是为了抓 BacktestEngine TDZ / 漏 lucide import 这类只在交互时才触发的运行时错误
// 任何导致页面渲染或交互崩溃的 ReferenceError 都会被这里抓住
import { test, expect } from '@playwright/test';
import { loginViaStorage } from './helpers';

test.describe('全交互冒烟', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaStorage(page);
  });

  test('依次进入四个 tab + 触发主要按钮，全程零 pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));

    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800); // Scoring 异步渲染

    // ── 1) 切换到组合回测 ──
    await page.locator('[role="tab"]').nth(1).click();
    // 等 BacktestEngine lazy chunk 加载完
    await expect(page.locator('text=/回测|构建组合|权重|初始资金|基准/').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);

    // ── 2) 切换到实时监控 ──
    await page.locator('[role="tab"]').nth(2).click();
    await expect(page.locator('text=/市场情绪|预警|板块/').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // ── 3) 切换到投资日志 ──
    await page.locator('[role="tab"]').nth(3).click();
    await expect(page.locator('text=/新增看好|暂无投资记录|论点|添加第一个/').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // ── 4) 回到量化评分 ──
    await page.locator('[role="tab"]').nth(0).click();
    await expect(page.locator('text=/NVDA|AAPL|MARS|SPY/').first()).toBeVisible({ timeout: 10000 });

    // ── 5) 触发主题切换、密度切换、工作区切换 — 这些都是头部按钮 ──
    const themeBtn = page.locator('button[title*="切换"]').first();
    if (await themeBtn.isVisible()) await themeBtn.click();
    await page.waitForTimeout(200);

    const densityBtn = page.locator('button[title*="密度"]').first();
    if (await densityBtn.isVisible()) await densityBtn.click();
    await page.waitForTimeout(200);

    // 检查 React ErrorBoundary 没被触发（pageerror 抓不到 React 渲染错）
    const renderError = await page.evaluate(() => (window as any).__QUANTEDGE_LAST_ERROR__);
    expect(renderError, `ErrorBoundary triggered: ${JSON.stringify(renderError)}`).toBeFalsy();
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('点击股票 → 详情面板渲染 + 切换价格图时间维度，零 pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));

    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // 点列表里的第一个股票项（按钮，含某 ticker 文本）
    const firstStock = page.locator('button').filter({ hasText: /MARS|UFO|MU|EWY|NVDA/ }).first();
    await firstStock.click();
    // 详情面板出现 — 等 "综合评分" / "价格走势" 等关键标识
    await expect(page.locator('text=/综合评分|价格走势|关键日期/').first()).toBeVisible({ timeout: 8000 });

    // 切换价格图时间维度（点 1Y/5Y/全部 任一）
    const rangeBtn = page.locator('button').filter({ hasText: /^1年$|^5年$|^全部$/ }).first();
    if (await rangeBtn.isVisible()) {
      await rangeBtn.click();
      await page.waitForTimeout(500);
    }

    // 检查 React ErrorBoundary 没被触发（pageerror 抓不到 React 渲染错）
    const renderError = await page.evaluate(() => (window as any).__QUANTEDGE_LAST_ERROR__);
    expect(renderError, `ErrorBoundary triggered: ${JSON.stringify(renderError)}`).toBeFalsy();
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('回测引擎完整流程：切 tab → 看到默认组合的所有按钮无报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));

    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });
    await page.locator('[role="tab"]').nth(1).click();

    // 等 BacktestEngine 完整渲染（默认组合 + 各种按钮就位）
    await expect(page.locator('text=/构建组合|初始资金/').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2000); // 等回测自动跑一下

    // 滚动一下结果区，触发各种 sub-component 渲染（确保整个 page 没有漏 import）
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(500);

    // 检查 React ErrorBoundary 没被触发（pageerror 抓不到 React 渲染错）
    const renderError = await page.evaluate(() => (window as any).__QUANTEDGE_LAST_ERROR__);
    expect(renderError, `ErrorBoundary triggered: ${JSON.stringify(renderError)}`).toBeFalsy();
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('Journal 流程：切 tab → 点新增标的按钮 → 关闭，零 pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));

    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });
    await page.locator('[role="tab"]').nth(3).click();

    await expect(page.locator('text=/新增看好|暂无投资记录|论点/').first()).toBeVisible({ timeout: 15000 });

    // 点 CSV 导入按钮（如果存在）
    const csvBtn = page.locator('button[title*="CSV"]').first();
    if (await csvBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await csvBtn.click();
      await expect(page.locator('text=/支持的列名|CSV/').first()).toBeVisible({ timeout: 3000 });
      // ESC / X 关闭
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 检查 React ErrorBoundary 没被触发（pageerror 抓不到 React 渲染错）
    const renderError = await page.evaluate(() => (window as any).__QUANTEDGE_LAST_ERROR__);
    expect(renderError, `ErrorBoundary triggered: ${JSON.stringify(renderError)}`).toBeFalsy();
    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
