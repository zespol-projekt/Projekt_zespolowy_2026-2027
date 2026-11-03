import { test, expect } from '@playwright/test';
import { MAPLIBRE_ASSETS, createMapDocument, createNativeMapSource } from '../../src/features/stores/map/document';
import { stores, catalog, embedded, waitForStores, localLibrary, mockMap } from './map-fixture';

test.beforeEach(async ({ page }) => mockMap(page));

test('domyślna mapa, cztery filtry, wyszukiwanie, karta i zewnętrzna nawigacja', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  await expect(page.getByText('4 sklepów · Polska')).toBeVisible();
  for (const name of ['Lidl', 'Biedronka', 'Auchan', 'Dino']) {
    const filter = page.getByRole('checkbox', { name: new RegExp('^' + name + ',') });
    await expect(filter).toBeChecked();
    await filter.click();
    await expect(filter).not.toBeChecked();
  }
  await expect(page.getByText('Wybierz sieć sklepów')).toBeVisible();
  await page.getByRole('button', { name: 'Pokaż wszystkie sklepy' }).click();
  await page.getByRole('textbox', { name: 'Miasto lub adres sklepu' }).fill('lodz zolta');
  await waitForStores(page, 1);
  await page.getByRole('button', { name: 'Pokaż wyniki na mapie' }).click();
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '1');
  await embedded(page).locator('canvas').click();
  await expect(page.getByTestId('store-card')).toContainText('Łódź, Żółta 1');
  await expect(page).toHaveURL(/\/stores$/);
  await page.context().route('https://www.google.com/maps/dir/**', route => route.fulfill({ body: 'navigation' }));
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Wyznacz trasę', exact: true }).click();
  const navigation = await popup;
  await navigation.waitForURL('https://www.google.com/maps/dir/**');
  expect(new URL(navigation.url()).searchParams.get('destination')).toBe('51.75,19.45');
  await navigation.close();
  await page.getByRole('button', { name: 'Zamknij kartę sklepu' }).click();
  await expect(page.getByTestId('store-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('jasna mapa ma jeden podpis, który zwija się po 5 sekundach i daje się ponownie otworzyć', async ({ page }) => {
  let modules = 0;
  page.on('request', request => { if (request.url() === MAPLIBRE_ASSETS + 'maplibre-gl.mjs') modules++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  await expect(page.getByRole('button', { name: /Włącz (ciemną|jasną) mapę/ })).toHaveCount(0);
  await expect(page.getByText('All the Places')).toHaveCount(0);
  const map = embedded(page);
  const info = map.getByRole('button', { name: 'Źródła i licencje mapy' });
  const credits = map.locator('#map-attribution');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(credits).toHaveText('© OpenMapTiles · © OpenStreetMap');
  await expect(credits.getByRole('link', { name: '© OpenMapTiles', exact: true })).toHaveAttribute('href', 'https://openmaptiles.org/');
  await expect(credits.getByRole('link', { name: '© OpenStreetMap', exact: true })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect(credits).toBeHidden({ timeout: 7000 });
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(map.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);
  await page.clock.install();
  await info.click();
  await expect(credits).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(credits).toBeVisible();
  await info.click();
  await expect(credits).toBeHidden();
  await page.getByRole('link', { name: 'SMARTCART — ekran startowy' }).click();
  await page.getByRole('tab', { name: 'Sklepy', exact: true }).click();
  await waitForStores(page, 4);
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  expect(modules).toBe(1);
});

test('odmowa lokalizacji pozostawia mapę i filtry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'denied' }) } });
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition: (_ok: unknown, fail: (error: { code: number; message: string }) => void) => fail({ code: 1, message: 'denied' }),
    } });
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  await expect(page.getByText(/Brak zgody/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Moja lokalizacja' }).click();
  await expect(page.getByText(/Brak zgody na lokalizację/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^Dino,/ }).click();
  await waitForStores(page, 3);
});

test('lokalizacja jest pobierana po kliknięciu i centruje mapę', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.75, longitude: 19.45 });
  await page.addInitScript(() => {
    const getPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    (window as unknown as { locationRequests: number }).locationRequests = 0;
    navigator.geolocation.getCurrentPosition = (...args) => {
      (window as unknown as { locationRequests: number }).locationRequests++;
      return getPosition(...args);
    };
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  expect(await page.evaluate(() => (window as unknown as { locationRequests: number }).locationRequests)).toBe(0);
  await page.getByRole('button', { name: 'Moja lokalizacja' }).click();
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '1');
  expect(await page.evaluate(() => (window as unknown as { locationRequests: number }).locationRequests)).toBeGreaterThan(0);
  await embedded(page).locator('canvas').click();
  await expect(page.getByTestId('store-card')).toContainText('0 m w linii prostej');
});

test('błąd katalogu można ponowić', async ({ page }) => {
  let failed = true;
  await page.route('**/v1/stores', route => failed ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: catalog() }));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sklepy są chwilowo niedostępne')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await waitForStores(page, 4);
});

test('błąd silnika daje ponowienie bez zmiany ekranu', async ({ page }) => {
  await page.route(MAPLIBRE_ASSETS + 'maplibre-gl.mjs', route => route.abort());
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Uruchom mapę ponownie' })).toBeVisible();
  await page.unroute(MAPLIBRE_ASSETS + 'maplibre-gl.mjs');
  await page.route(MAPLIBRE_ASSETS + 'maplibre-gl.mjs', async route => route.fulfill(await localLibrary('maplibre-gl.mjs')));
  await page.getByRole('button', { name: 'Uruchom mapę ponownie' }).click();
  await waitForStores(page, 4);
});

test('7753 punkty pozostają jedną warstwą, filtry nie przeładowują ramki', async ({ page }) => {
  const points = Array.from({ length: 7753 }, (_, i) => ({ ...stores[i % 4], id: stores[i % 4].chain + ':' + i,
    latitude: 49.2 + (i % 80) * 0.065, longitude: 14.5 + Math.floor(i / 80) * 0.09 }));
  await page.route('**/v1/stores', route => route.fulfill({ json: catalog(points) }));
  let modules = 0;
  page.on('request', request => { if (request.url() === MAPLIBRE_ASSETS + 'maplibre-gl.mjs') modules++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 7753);
  await expect(embedded(page).locator('canvas')).toHaveCount(1);
  await expect(embedded(page).locator('.maplibregl-marker')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^Dino,/ }).click();
  await waitForStores(page, 5815);
  await expect(page.getByText('5815 sklepów · Polska')).toBeVisible();
  expect(modules).toBe(1);
});

test('kliknięcie grupy przybliża mapę, a kolejne otwiera sklep', async ({ page }) => {
  const points = [stores[0], { ...stores[3], address: 'Łódź, Żółta 2', latitude: 51.75001, longitude: 19.45001 }];
  await page.route('**/v1/stores', route => route.fulfill({ json: catalog(points) }));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 2);
  await page.getByRole('button', { name: 'Pokaż wyniki na mapie' }).click();
  const region = embedded(page).locator('#map');
  await expect(region).toHaveAttribute('data-focus-request', '1');
  await embedded(page).locator('canvas').click();
  await expect(region).toHaveAttribute('aria-busy', 'true');
  await expect(region).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('store-card')).toHaveCount(0);
  await embedded(page).locator('canvas').click();
  await expect(page.getByTestId('store-card')).toContainText('Łódź, Żółta');
});

test('na małym ekranie mapa mieści się nad nawigacją', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  const map = await page.getByTestId('stores-map').boundingBox();
  const tabs = await page.getByRole('tab', { name: 'Sklepy', exact: true }).boundingBox();
  expect(map!.height).toBeGreaterThanOrEqual(200);
  expect(map!.y + map!.height).toBeLessThan(tabs!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('dokument z adresem bazowym uruchamia workery i komunikację WebView', async ({ page }) => {
  const channel = 'native-origin-test';
  const source = createNativeMapSource(createMapDocument(channel));
  await page.route(source.baseUrl, route => route.fulfill({ contentType: 'text/html', body: source.html }));
  await page.addInitScript(() => {
    const bridgeWindow = window as unknown as { ReactNativeWebView: { postMessage: (message: string) => void }; nativeMessages: Record<string, unknown>[] };
    bridgeWindow.nativeMessages = [];
    bridgeWindow.ReactNativeWebView = { postMessage: raw => bridgeWindow.nativeMessages.push(JSON.parse(raw)) };
  });
  await page.goto(source.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { nativeMessages: { type: string }[] }).nativeMessages.some(m => m.type === 'bridge-ready'));
  await page.evaluate(({ channel, stores }) => {
    (window as unknown as { SmartcartMap: { receive: (message: object) => void } }).SmartcartMap.receive({ channel, type: 'state',
      state: { stores, selectedId: null, userLocation: null, focus: null, attributionSeen: true } });
  }, { channel, stores });
  await page.waitForFunction(() => (window as unknown as { nativeMessages: { type: string }[] }).nativeMessages.some(m => m.type === 'data-ready'));
  const messages = await page.evaluate(() => (window as unknown as { nativeMessages: Record<string, unknown>[] }).nativeMessages);
  expect(messages.filter(m => m.type === 'error')).toEqual([]);
  expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'ready', channel }), expect.objectContaining({ type: 'data-ready', count: 4 })]));
  expect(await page.evaluate(() => location.origin)).toBe(new URL(source.baseUrl).origin);
  await expect(page.getByRole('button', { name: 'Źródła i licencje mapy' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#map-attribution')).toBeHidden();
  await page.getByRole('button', { name: 'Źródła i licencje mapy' }).click();
  await expect(page.locator('#map-attribution')).toBeVisible();
});
