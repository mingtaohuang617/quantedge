import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginViaStorage } from './helpers';

for (const width of [1440,390]) test(`TradingView private research panel ${width}`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await loginViaStorage(page);
  await page.route('**/api/private/objects/research', route => route.fulfill({json:{data:[],meta:{schema_version:'1.1'}}}));
  await page.route('**/api/private/market-data/tradingview?**', route => route.fulfill({json:{meta:{schema_version:'1.1'},data:{resolved_symbol:'HKEX_DLY:700',currency:'HKD',delay_seconds:900,received_at:'2026-09-15T09:00:00Z',bars:[{time:1789459140,close:438.8}],indicators:{rsi:45.43,macd:-0.1424,signal:-0.1648,histogram:0.0224}}}}));
  await page.goto('/?tab=dailyResearch');
  const panel=page.locator('section[aria-labelledby="tv-title"]');
  await expect(panel.getByLabel('K 线周期')).toHaveValue('日线');
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  const dailyRequest=page.waitForRequest(req => req.url().includes('/market-data/tradingview?'));
  await panel.getByLabel('TradingView 标的').fill('HKEX:700');
  await panel.getByRole('button',{name:'查询快照'}).click();
  expect(new URL((await dailyRequest).url()).searchParams.get('timeframe')).toBe('1D');
  await expect(panel.getByText('延迟 15 分钟')).toBeVisible();
  await expect(panel.getByText('HKEX_DLY:700 · HKD')).toBeVisible();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).include('section[aria-labelledby="tv-title"]').withTags(['wcag2a','wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  await panel.screenshot({path:`test-results/tradingview-${width}.png`});
});
