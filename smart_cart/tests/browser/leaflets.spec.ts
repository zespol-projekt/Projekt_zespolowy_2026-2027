import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AUTH_URL, mockMap } from './map-fixture';
const image = (number: number, signature = '') => ({ url: `https://leaflets.example.invalid/page-${number}.png${signature}`, width: 600, height: 900, mimeType: 'image/png' });
const catalog = (signature = '') => {
  const pages = [1, 2, 3].map(number => image(number, signature));
  return { version: 1, leaflets: [
    { id: 'test-1', chain: { id: 'test', name: 'Sieć testowa' }, title: 'Gazetka testowa', validFrom: '2026-11-01', validTo: '2026-11-20', format: 'images', cover: pages[0], pages },
  ] };
};
async function fixture(page: Page) {
  await mockMap(page);
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({ json: catalog() }));
  await page.route('https://leaflets.example.invalid/**', async route => {
    const headers = await route.request().allHeaders();
    expect(headers.authorization).toBeUndefined();
    expect(headers.apikey).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({ body: await readFile(`tests/fixtures/leaflets/${filename}`), contentType: 'image/png' });
  });
}
test('czytnik: wybór, daty, strony, zoom, menu, reload i powrót', async ({ page }, info) => {
  await fixture(page); const requests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://leaflets.example.invalid')) requests.push(request.url()); });
  await page.goto('/leaflets');
  await page.getByRole('button', { name: 'Sieć testowa', exact: true }).click();
  await expect(page.getByText('01.11.2026 – 20.11.2026 · 3 stron')).toBeVisible();
  await page.getByRole('button', { name: 'Czytaj: Gazetka testowa' }).click();
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Następna strona' }).click();
  const picture = page.getByRole('img', { name: 'Strona 2 gazetki' });
  await expect(picture).toBeVisible();
  const before = await picture.boundingBox();
  await page.getByRole('button', { name: 'Powiększ', exact: true }).click();
  await expect(page.getByText('Strona 2 z 3 · 150%')).toBeVisible();
  expect((await picture.boundingBox())!.width).toBeGreaterThan(before!.width * 1.4);
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Strona 2 z 3 · 150%')).toBeVisible();
  await page.screenshot({ path: info.outputPath('reader.png'), fullPage: true });
  await page.reload(); await expect(page.getByText('Strona 2 z 3 · 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do gazetek' }).click();
  await expect(page.getByRole('button', { name: 'Czytaj: Gazetka testowa' })).toBeVisible();
});
for (const status of [400, 403]) {
  test(`czytnik: Storage ${status} odświeża podpis i zachowuje stronę`, async ({ page }) => {
    await fixture(page);
    let catalogs = 0;
    await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      expect(route.request().headers().accept).toBe('application/json');
      return route.fulfill({ json: catalog(`?token=${++catalogs === 1 ? 'expired' : 'fresh'}`) });
    });
    await page.route(`${image(2).url}?token=expired`, route => route.fulfill({ status }));
    await page.goto('/leaflets/test-1?page=2');
    await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
    await expect(page).toHaveURL(/page=2/);
    expect(catalogs).toBe(2);
  });
}
test('czytnik: ponowny błąd podpisu pozwala ręcznie odświeżyć dostęp', async ({ page }) => {
  await fixture(page);
  let pageRequests = 0;
  await page.route(image(1).url, route => ++pageRequests <= 2 ? route.fulfill({ status: 403 }) : route.fallback());
  await page.goto('/leaflets/test-1');
  await expect(page.getByText(/Dostęp do gazetki wygasł/)).toBeVisible();
  expect(pageRequests).toBe(2);
  await page.getByRole('button', { name: 'Odśwież dostęp do gazetki' }).click();
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
  expect(pageRequests).toBe(3);
});
test('czytnik: HTML zamiast obrazu daje błąd oraz retry', async ({ page }) => {
  await fixture(page);
  await page.route(image(1).url, route => route.fulfill({ body: '<html>expired</html>', contentType: 'text/html' }));
  await page.goto('/leaflets/test-1');
  await expect(page.getByText('Serwer zwrócił inny format zamiast obrazu strony.')).toBeVisible();
  await page.getByRole('button', { name: 'Ponów pobranie strony' }).click();
  await expect(page.getByText('Serwer zwrócił inny format zamiast obrazu strony.')).toBeVisible();
  await expect(page.getByLabel('Wczytywanie strony')).toHaveCount(0);
});
