import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginViaStorage } from './helpers';
import { STOCKS } from '../src/data.js';
import { dailySymbol } from '../src/lib/dailyWatchlist.js';
test.use({ serviceWorkers: 'block' });
for (const width of [1440, 390]) test(`scoring uses dated daily quotes without changing scores ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await loginViaStorage(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const requests: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/auth/session') return route.fallback();
    if (/^\/(api|yahoo|yahoo-cookie|v8)\//.test(url.pathname)) {
      requests.push(url.href);
      return route.fulfill({status:503,json:{}});
    }
    return route.continue();
  });
  const rows = STOCKS.filter(stock => dailySymbol(stock.ticker)).map(stock => ({ ticker: stock.ticker, status: 'success', snapshot: {
    timeframe: '1D', resolved_symbol: dailySymbol(stock.ticker), received_at: new Date().toISOString(), timezone: 'UTC',
    previous_close: 100, bar: { time: 1789516800, close: 123.45 }, indicators: { time: 1789516800, rsi: 61.25, macd: 2.75, signal: 2, histogram: .75 },
  } }));
  await page.route('**/api/private/market-data/daily-snapshots', route => route.fulfill({json:{meta:{schema_version:'1.0'},data:{timeframe:'1D',rows,generated_at:new Date().toISOString()}}}));
  await page.goto('/?tab=scoring');
  if(width<500) { await expect(page.locator('.virt-row-m').first()).toBeVisible({timeout:20000}); await page.locator('.virt-row-m').first().click(); }
  const quote = page.getByTestId('daily-quote-provenance');
  await expect(quote).toContainText('61.25', {timeout:20000}); await expect(quote).toContainText('2.7500');
  await expect(quote).toContainText('2026-09-16'); await expect(quote).toContainText('尚未按这份日线重算');
  const equation = await page.getByTestId('score-equation').innerText();
  await expect(quote).toContainText('123.45');
  rows.forEach(row => { row.snapshot.bar.close=150; row.snapshot.received_at=new Date(Date.now()+1000).toISOString(); });
  await quote.getByRole('button',{name:'刷新日线快照'}).click();
  await expect(quote).toContainText('150');
  await expect(page.getByTestId('score-equation')).toHaveText(equation);
  await quote.scrollIntoViewIfNeeded();
  const box=await quote.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
  expect((await new AxeBuilder({page}).include('[data-testid="daily-quote-provenance"]').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath('daily-scoring.png')});
  expect(requests.filter(url => /interval=(5m|30m|1m)/.test(decodeURIComponent(url)))).toEqual([]);
  expect(errors).toEqual([]);
});
