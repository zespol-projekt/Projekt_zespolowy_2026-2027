import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AUTH_URL, mockMap } from './map-fixture';
const image = (number: number) => ({ url: `https://leaflets.example.invalid/page-${number}.png`, width: 600, height: 900, mimeType: 'image/png' });
async function fixture(page: Page) {
  await mockMap(page);
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({ json: { version: 1, leaflets: [
    { id: 'test-1', chain: { id: 'test', name: 'Sieć testowa' }, title: 'Gazetka testowa', validFrom: '2026-11-01', validTo: '2026-11-20', format: 'images', cover: image(1), pages: [image(1), image(2), image(3)] },
  ] } }));
  await page.route('https://leaflets.example.invalid/**', async route => {
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().headers().apikey).toBeUndefined();
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
test('czytnik: wygasły URL i HTML zamiast obrazu dają błąd oraz retry', async ({ page }) => {
  await fixture(page); let status = 403;
  await page.route('https://leaflets.example.invalid/page-1.png', route => route.fulfill({ status, body: '<html>expired</html>', contentType: 'text/html' }));
  await page.goto('/leaflets/test-1');
  await expect(page.getByText(/Dostęp do gazetki wygasł/)).toBeVisible();
  status = 200; await page.getByRole('button', { name: 'Ponów pobranie strony' }).click();
  await expect(page.getByText('Serwer zwrócił inny format zamiast obrazu strony.')).toBeVisible();
  await expect(page.getByLabel('Wczytywanie strony')).toHaveCount(0);
});
