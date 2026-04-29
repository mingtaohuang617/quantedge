import { test, expect } from '@playwright/test';
import { loginViaStorage } from './helpers';

test.describe('主流程冒烟测试', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaStorage(page);
  });

  test('Scoring 页加载且显示股票列表 + 无 JS 报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    // 等股票列表渲染（至少一个 ticker 可见）
    await expect(page.locator('text=/NVDA|AAPL|TSLA|SPY/').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500); // 让 React 完成异步渲染

    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('能切换到组合回测 tab + 无 JS 报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });

    const backtestTab = page.locator('[role="tab"]').nth(1);
    await backtestTab.click();

    // BacktestEngine 是 lazy 加载的，给它充足时间下载 chunk
    // 加载完成后应至少出现 "回测" / "组合" / "权重" / "构建组合" 之一
    await expect(
      page.locator('text=/回测|构建组合|权重|初始资金|基准/').first()
    ).toBeVisible({ timeout: 20000 });

    expect(errors, `pageerror caught: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('⌘K 命令面板可打开 + 显示动作项', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('Control+K');
    // 应看到搜索框 — 命令面板的 placeholder 含 "搜索"
    const searchInput = page.locator('input[placeholder*="搜索"]').last();
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // 输入 "动量" 应能触发模板项（模板 / 动量成长）
    await searchInput.fill('动量');
    await expect(page.locator('text=/动量成长|动量/').first()).toBeVisible({ timeout: 3000 });

    // ESC 关闭
    await page.keyboard.press('Escape');
  });

  test('密度切换按钮改变 root 类名', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });

    const root = page.locator('div.density-cozy, div.density-compact, div.density-dense').first();
    const before = await root.getAttribute('class');
    expect(before).toMatch(/density-(cozy|compact|dense)/);

    // 找密度切换按钮（title 含 "密度"）
    const densityBtn = page.locator('button[title*="密度"]').first();
    await densityBtn.click();
    await page.waitForTimeout(200);
    const after = await root.getAttribute('class');
    expect(after).not.toEqual(before);
  });

  test('工作区切换器可打开 + 显示新建按钮', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });

    // 工作区按钮（title 含 "切换工作区"）
    const wsBtn = page.locator('button[title*="切换工作区"]').first();
    await expect(wsBtn).toBeVisible();
    await page.waitForTimeout(300); // 等动画
    await wsBtn.click({ force: true }); // force：避免 animate-* class 触发的 detach
    // 弹层应显示 "新建工作区" 按钮
    await expect(page.locator('text=/新建工作区/').first()).toBeVisible({ timeout: 3000 });
  });
});
