import { test, expect } from '@playwright/test';
import { loginViaStorage } from './helpers';

test.describe('Desktop sidebar brand visibility', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaStorage(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('quantedge_layout', 'sidebar');
    });
  });

  test('keeps a single visible brand when the sidebar expands', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.getByTestId('desktop-sidebar');
    const headerBrand = page.getByTestId('header-brand');
    const sidebarBrand = sidebar.getByText('QuantEdge', { exact: true });

    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await expect(headerBrand).toHaveCSS('opacity', '1');
    await expect(sidebarBrand).toHaveCSS('opacity', '0');

    await sidebar.hover();
    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await expect(sidebar).toHaveCSS('width', '176px');
    await expect(headerBrand).toHaveCSS('opacity', '0');
    await expect(sidebarBrand).toHaveCSS('opacity', '1');

    await page.mouse.move(700, 400);
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await expect(headerBrand).toHaveCSS('opacity', '1');
  });

  test('also expands from keyboard focus', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.getByTestId('desktop-sidebar');
    await sidebar.getByRole('tab').first().focus();

    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await expect(page.getByTestId('header-brand')).toHaveCSS('opacity', '0');
  });
});
