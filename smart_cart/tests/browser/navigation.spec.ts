import { test, expect } from '@playwright/test';

test('kolejne wejścia na różne trasy i przeładowania zachowują działającą aplikację', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/v1/stores', route => route.fulfill({ json: {
    version: 1, updatedAt: '2026-11-02T12:00:00Z', count: 0, stores: [],
  } }));
  // This checks routing and reloads; map engine/provider tests live separately.
  await page.route('https://unpkg.com/**', route => route.abort());
  for (const route of ['/stores', '/', '/stores', '/settings', '/', '/stores']) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole('link', { name: 'SMARTCART — ekran startowy' })).toBeVisible();
    const reload = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(reload?.status(), `${route} reload`).toBe(200);
    await expect(page.getByRole('link', { name: 'SMARTCART — ekran startowy' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
