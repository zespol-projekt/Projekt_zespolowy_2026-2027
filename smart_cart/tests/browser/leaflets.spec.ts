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
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
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

async function showReaderControls(page: Page) {
  await page.getByRole('button', { name: 'Pokaż sterowanie gazetką', exact: true }).click({ position: { x: 10, y: 10 } });
}

for (const [chain, name] of [['biedronka', 'Biedronka'], ['lidl', 'Lidl']] as const) {
  test(`${name}: po zamknięciu gazetki jedno Wróć wraca na Start`, async ({ page }) => {
    await fixture(page);
    const template = catalog().leaflets[0];
    await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({ json: { version: 1, leaflets: [
      { ...template, id: `oferta-${chain}`, chain: { id: chain, name }, title: `Oferta ${name}` },
    ] } }));
    await page.goto('/');
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('link', { name: `Gazetki: ${name}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/leaflets\\?chain=${chain}$`));
      // Reopening the reader must not add another copy of the list to history.
      for (let open = 0; open < 2; open++) {
        await page.getByRole('button', { name: `Czytaj: Oferta ${name}`, exact: true }).click();
        await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
        await page.getByRole('button', { name: 'Zamknij gazetkę' }).click();
        await expect(page).toHaveURL(new RegExp(`/leaflets\\?chain=${chain}$`));
      }
      await page.getByRole('button', { name: 'Wróć', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('home-grid')).toBeVisible();
    }
  });
}

test('każdy kafelek na Start otwiera gazetki swojej marki, a czytnik do nich wraca', async ({ page }) => {
  await fixture(page);
  const brands = [
    ['lidl', 'Lidl'], ['biedronka', 'Biedronka'], ['dino', 'Dino'],
    ['kaufland', 'Kaufland'], ['carrefour', 'Carrefour'],
  ] as const;
  const template = catalog().leaflets[0];
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({
    json: { version: 1, leaflets: brands.map(([id, name]) => ({
      ...template, id: `gazetka-${id}`, chain: { id, name }, title: `Oferta ${name}`,
    })) },
  }));
  await page.goto('/');
  for (const [id, name] of brands) {
    await page.getByRole('link', { name: `Gazetki: ${name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/leaflets\\?chain=${id}$`));
    await expect(page.getByRole('heading', { name: `Gazetki – ${name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Czytaj:/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Czytaj: Oferta ${name}` })).toBeVisible();
    if (id === 'carrefour') {
      await page.getByRole('button', { name: 'Czytaj: Oferta Carrefour' }).click();
      await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
      await page.getByRole('button', { name: 'Zamknij gazetkę' }).click();
      await expect(page.getByRole('heading', { name: 'Gazetki – Carrefour' })).toBeVisible();
      await page.getByRole('button', { name: 'Wszystkie sieci' }).click();
      await expect(page.getByRole('button', { name: /^Czytaj:/ })).toHaveCount(5);
    }
    await page.getByRole('tab', { name: 'Start', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
});

test('czytnik: pełne okno, daty, strony, zoom, reload i zamknięcie', async ({ page }, info) => {
  await fixture(page); const requests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://leaflets.example.invalid')) requests.push(request.url()); });
  await page.goto('/leaflets');
  await page.getByRole('button', { name: 'Sieć testowa', exact: true }).click();
  await expect(page.getByText('Obowiązuje: 01.11.2026 – 20.11.2026')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Czytaj: Gazetka testowa' }).locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Czytaj: Gazetka testowa' }).click();
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Otwórz menu' })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Następna strona' })).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Zamknij gazetkę' });
  await expect(close).toBeFocused();
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.x).toBeGreaterThan(300);
  expect(closeBox.y).toBeLessThan(30);
  await showReaderControls(page);
  expect(requests.length).toBeGreaterThanOrEqual(2); // Cover and the reader use the first page, never preload the whole leaflet.
  expect(requests.every(url => url.endsWith('/page-1.png'))).toBe(true);
  await page.getByRole('button', { name: 'Następna strona' }).click();
  const picture = page.getByRole('img', { name: 'Strona 2 gazetki' });
  await expect(picture).toBeVisible();
  const before = await picture.boundingBox();
  await page.getByRole('button', { name: 'Powiększ', exact: true }).click();
  await expect(page.getByText('Strona 2 z 3 · 150%')).toBeVisible();
  expect((await picture.boundingBox())!.width).toBeGreaterThan(before!.width * 1.4);
  await page.getByRole('button', { name: 'Pomniejsz', exact: true }).click();
  await page.getByRole('button', { name: 'Ukryj sterowanie gazetką' }).click({ position: { x: 10, y: 10 } });
  await page.screenshot({ path: info.outputPath('reader.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
  await showReaderControls(page);
  await expect(page.getByText('Strona 2 z 3 · 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij gazetkę' }).click();
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

test('kafelki pokazują pierwszą stronę i datę; pomijają przyszłe i zakończone gazetki', async ({ page }, info) => {
  await fixture(page);
  const template = catalog().leaflets[0];
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({ json: { version: 1, leaflets: [
    { ...template, cover: null },
    { ...template, id: 'expired', title: 'Zakończona', validTo: '2026-11-14' },
    { ...template, id: 'future', title: 'Przyszła', validFrom: '2026-11-16' },
  ] } }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/leaflets');
  const tile = page.getByRole('button', { name: 'Czytaj: Gazetka testowa', exact: true });
  await expect(tile.locator('img')).toBeVisible();
  await expect(tile).toContainText('Obowiązuje: 01.11.2026 – 20.11.2026');
  await expect(page.getByRole('button', { name: /^Czytaj:/ })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('leaflet-tiles-320.png'), fullPage: true });
  await tile.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
});

test('miniatura: błąd pobierania, ponowienie i pusta lista aktualnych gazetek', async ({ page }) => {
  await fixture(page);
  let broken = true;
  await page.route(image(1).url, route => broken ? route.fulfill({ status: 500 }) : route.fallback());
  await page.goto('/leaflets');
  await expect(page.getByText('Podgląd niedostępny. Możesz otworzyć gazetkę.')).toBeVisible();
  broken = false;
  await page.getByRole('button', { name: 'Ponów pobranie miniatury' }).click();
  await expect(page.getByRole('button', { name: 'Czytaj: Gazetka testowa' }).locator('img')).toBeVisible();
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => route.fulfill({ json: { version: 1, leaflets: [] } }));
  await page.getByRole('button', { name: 'Odśwież gazetki' }).click();
  await expect(page.getByText('Brak aktualnych gazetek. Sprawdź ponownie później.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Czytaj:/ })).toHaveCount(0);
});

test('czytnik: przesuwanie stron, granice gazetki i zachowanie po powiększeniu', async ({ page }) => {
  await fixture(page);
  await page.goto('/leaflets/test-1');
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
  await showReaderControls(page);
  const swipe = async (direction: 'left' | 'right') => {
    const box = (await page.getByTestId('leaflet-page-viewport').boundingBox())!;
    const from = direction === 'left' ? 0.8 : 0.2;
    const to = 1 - from;
    await page.mouse.move(box.x + box.width * from, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, box.y + 70, { steps: 12 });
    await page.mouse.up();
  };
  await swipe('right');
  await expect(page.getByText('Strona 1 z 3 · 100%')).toBeVisible();
  await swipe('left');
  await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole('button', { name: 'Powiększ', exact: true }).click();
  await swipe('left');
  await expect(page.getByText('Strona 2 z 3 · 150%')).toBeVisible();
  await page.getByRole('button', { name: 'Pomniejsz', exact: true }).click();
  await swipe('left');
  await expect(page.getByRole('img', { name: 'Strona 3 gazetki' })).toBeVisible();
  await swipe('left');
  await expect(page.getByText('Strona 3 z 3 · 100%')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Następna strona' })).toBeDisabled();
  await swipe('right');
  await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
});
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

test('czytnik: gest dotykowy zmienia stronę', async ({ page }) => {
  await fixture(page);
  await page.goto('/leaflets/test-1');
  await expect(page.getByRole('img', { name: 'Strona 1 gazetki' })).toBeVisible();
  const box = (await page.getByTestId('leaflet-page-viewport').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const y = box.y + 70;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.8, y }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * (0.8 - step * 0.05), y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
  await cdp.detach();
});

test('pełne okno gazetki: klawiatura, Escape i mały ekran', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/leaflets/test-1');
  const picture = page.getByRole('img', { name: 'Strona 1 gazetki' });
  await expect(picture).toBeVisible();
  const counter = page.getByTestId('leaflet-page-counter');
  await expect(counter).toHaveText('1/3');
  const counterBox = (await counter.boundingBox())!;
  expect(counterBox.y).toBeGreaterThan(400);
  expect(counterBox.y + counterBox.height).toBeLessThanOrEqual(480);
  const box = (await picture.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(481);
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('img', { name: 'Strona 2 gazetki' })).toBeVisible();
  await expect(counter).toHaveText('2/3');
  await page.keyboard.press('ArrowLeft');
  await expect(picture).toBeVisible();
  await expect(counter).toHaveText('1/3');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/leaflets$/);
  await expect(page.getByRole('button', { name: 'Zamknij gazetkę' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Otwórz menu' })).toBeVisible();
});

test('kafelki: wygasły podpis miniatury jest odświeżany; siatka działa w ciemnym motywie', async ({ page }, info) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('smartcart.theme.v1', 'dark'));
  let catalogs = 0;
  await page.route(`${AUTH_URL}/functions/v1/leaflets`, route => {
    const data = catalog(`?token=${++catalogs === 1 ? 'expired' : 'fresh'}`);
    return route.fulfill({ json: { version: 1, leaflets: [...data.leaflets, { ...data.leaflets[0], id: 'second', title: 'Druga gazetka' }] } });
  });
  await page.route(`${image(1).url}?token=expired`, route => route.fulfill({ status: 403 }));
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto('/leaflets');
  const first = page.getByRole('button', { name: 'Czytaj: Gazetka testowa', exact: true });
  const second = page.getByRole('button', { name: 'Czytaj: Druga gazetka', exact: true });
  await expect(first.locator('img')).toBeVisible();
  await expect(second.locator('img')).toBeVisible();
  expect(catalogs).toBe(2);
  const a = (await first.boundingBox())!; const b = (await second.boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('leaflet-tiles-dark-desktop.png'), fullPage: true });
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
