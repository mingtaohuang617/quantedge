import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginViaStorage } from './helpers';
for (const width of [1440,390]) test(`favorites daily queue ${width}`, async ({page})=>{
  await page.setViewportSize({width,height:900}); await loginViaStorage(page);
  await page.route('**/api/watchlist/favorites',route=>route.fulfill({json:{tickers:['00700.HK'],kv:true,updated_at:'2026-09-15'}}));
  await page.route('**/api/private/objects/research',route=>route.fulfill({json:{data:[],meta:{}}}));
  const requests:string[]=[];
  await page.route('**/api/private/market-data/tradingview?**',route=>{
    requests.push(route.request().url());
    return route.fulfill({json:{meta:{schema_version:'1.1'},data:{timeframe:'1D',resolved_symbol:'HKEX_DLY:700',timezone:'Asia/Hong_Kong',received_at:'2026-09-15T10:00:00Z',bars:[{time:1789435800,close:438.8}],indicators:{time:1789435800,rsi:47,macd:1,signal:2,histogram:-1}}}});
  });
  await page.goto('/?tab=dailyResearch');
  const panel=page.locator('section[aria-labelledby="daily-watchlist-title"]');
  await panel.getByRole('button',{name:'更新全部星标日线',exact:true}).click();
  await expect(panel.getByRole('cell',{name:'438.8',exact:true})).toBeVisible();
  expect(requests).toHaveLength(1);expect(new URL(requests[0]).searchParams.get('timeframe')).toBe('1D');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('section[aria-labelledby="daily-watchlist-title"]').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await panel.screenshot({path:`test-results/daily-watchlist-${width}.png`});
});
