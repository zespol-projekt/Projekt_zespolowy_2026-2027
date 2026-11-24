import { test, expect } from '@playwright/test';
import { MAPLIBRE_ASSETS, createMapDocument, createNativeMapSource } from '../../src/features/stores/map/document';
import { stores, catalog, embedded, waitForStores, localLibrary, mockMap } from './map-fixture';

test.beforeEach(async ({ page }) => mockMap(page));

test('podkład Polski odbiera kafelki bez błędów silnika', async ({ page }) => {
  const tiles: string[] = [];
  await page.route('https://tiles.openfreemap.org/styles/positron', route => route.fulfill({
    json: {
      version: 8,
      glyphs: 'https://fonts.example.invalid/{fontstack}/{range}.pbf',
      sources: { base: { type: 'vector', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'] } },
      layers: [
        { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water' },
        { id: 'roads', type: 'line', source: 'base', 'source-layer': 'transportation', filter: ['==', 'class', 'primary'] },
        { id: 'building', type: 'fill', source: 'base', 'source-layer': 'building' },
      ],
    },
    headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await page.route('https://tiles.openfreemap.org/planet/**', route => {
    tiles.push(route.request().url());
    return route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf',
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, stores.length);
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  await expect(embedded(page).locator('canvas')).toBeVisible();
  await expect(page.getByText(/Nie udało się (wczytać|pobrać)/)).toHaveCount(0);
});

test('filtry i znaczniki mają wspólne kolory, a filtry mieszczą się między przyciskami mapy', async ({ page }) => {
  await page.route(MAPLIBRE_ASSETS + 'maplibre-gl.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: `
      export * from './maplibre-gl.mjs?original';
      import { Map as BaseMap } from './maplibre-gl.mjs?original';
      export class Map extends BaseMap {
        addImage(name, image, options) {
          if (image instanceof ImageData) {
            const color = y => {
              const offset = (y * image.width + image.width / 2) * 4;
              return 'rgb(' + image.data.slice(offset, offset + 3).join(', ') + ')';
            };
            document.getElementById('map').setAttribute('data-marker-' + name, color(4) + ' / ' + color(0));
          }
          return super.addImage(name, image, options);
        }
      }
    `,
  }));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  const filters = page.getByRole('checkbox', { name: /^(Lidl|Biedronka|Dino|Kaufland|Carrefour),/ });
  await expect(filters).toHaveCount(5);
  for (const filter of await filters.all()) {
    const logo = filter.locator('img');
    await expect(logo).toHaveJSProperty('complete', true);
    expect(await logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  const palettes = [
    ['Lidl', 'rgb(10, 80, 161)', 'rgb(10, 80, 161)'],
    ['Biedronka', 'rgb(253, 237, 20)', 'rgb(0, 0, 0)'],
    ['Dino', 'rgb(242, 230, 211)', 'rgb(16, 154, 75)'],
    ['Kaufland', 'rgb(255, 255, 255)', 'rgb(225, 9, 21)'],
    ['Carrefour', 'rgb(255, 255, 255)', 'rgb(37, 79, 155)'],
  ];
  for (const [name, background, border] of palettes) {
    const tile = page.getByRole('checkbox', { name: new RegExp(`^${name},`) });
    await expect(tile).toHaveCSS('background-color', background);
    await expect(tile).toHaveCSS('border-color', border);
    await expect(tile).toHaveCSS('border-radius', '6px');
    await expect(embedded(page).locator('#map')).toHaveAttribute(`data-marker-${name.toLowerCase()}`, `${background} / ${border}`);
  }
  const search = await page.getByRole('textbox', { name: 'Miasto lub adres sklepu' }).boundingBox();
  const locationButton = page.getByRole('button', { name: 'Moja lokalizacja' });
  await expect(locationButton).toHaveText(/\S/);
  await expect(locationButton).not.toContainText('Moja lokalizacja');
  const location = await locationButton.boundingBox();
  expect(search).not.toBeNull();
  expect(location).not.toBeNull();
  expect(location!.width).toBe(44);
  expect(location!.x).toBeGreaterThan(search!.x + search!.width);
  expect(search!.y).toBeGreaterThanOrEqual(location!.y);
  expect(search!.y + search!.height).toBeLessThanOrEqual(location!.y + location!.height);
  const reset = page.getByRole('button', { name: 'Pokaż całą Polskę' });
  const zoom = embedded(page).getByRole('button', { name: 'Przybliż', exact: true });
  await expect(zoom).toBeVisible();
  for (const [width, height] of [[320, 568], [1024, 720]]) {
    await page.setViewportSize({ width, height });
    const tiles = await filters.all();
    for (const tile of tiles) await expect(tile).toBeInViewport({ ratio: 1 });
    await expect(async () => {
      const [resetBox, zoomBox, ...boxes] = await Promise.all(
        [reset, zoom, ...tiles].map(item => item.boundingBox()),
      );
      let previousRight = zoomBox!.x + zoomBox!.width;
      for (const box of boxes) {
        expect(box!.y).toBeCloseTo(resetBox!.y);
        expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(1);
        expect(box!.x - previousRight).toBeGreaterThanOrEqual(2);
        expect(box!.x - previousRight).toBeLessThanOrEqual(8);
        previousRight = box!.x + box!.width;
      }
      expect(resetBox!.x - previousRight).toBeCloseTo(4);
    }).toPass({ timeout: 5000 });
  }
  await page.setViewportSize({ width: 320, height: 440 });
  const carrefour = page.getByRole('checkbox', { name: /^Carrefour,/ });
  await carrefour.click();
  await expect(carrefour).not.toBeChecked();
  await expect(reset).toBeInViewport({ ratio: 1 });
});

test('koszyk lekko nachodzi na mapę i otwiera się po kliknięciu w tym miejscu', async ({ page }) => {
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  const map = page.getByTestId('stores-map');
  const cart = page.getByRole('tab', { name: 'Koszyk', exact: true });
  await expect(map).toBeVisible();
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const mapBox = (await map.boundingBox())!;
    const cartBox = (await cart.boundingBox())!;
    const overlap = mapBox.y + mapBox.height - cartBox.y;
    expect(overlap).toBeGreaterThanOrEqual(5);
    expect(overlap).toBeLessThanOrEqual(12);
  }
  const cartBox = (await cart.boundingBox())!;
  await page.mouse.click(cartBox.x + cartBox.width / 2, cartBox.y + 4);
  await expect(page).toHaveURL(/\/cart$/);
});

test('domyślna mapa, pięć filtrów, wyszukiwanie, karta i zewnętrzna nawigacja', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, stores.length);
  await expect(page.getByText('Sklepy na mapie')).toHaveCount(0);
  await expect(page.getByText(/sklepów · Polska/)).toHaveCount(0);
  for (const name of ['Lidl', 'Biedronka', 'Dino', 'Kaufland', 'Carrefour']) {
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
  const card = page.getByTestId('store-card');
  await expect(card).toContainText('Łódź, Żółta 1');
  const cardSize = async () => {
    const box = (await card.boundingBox())!;
    const frame = (await page.getByTestId('stores-map').boundingBox())!;
    return { width: box.width, height: box.height, left: box.x - frame.x };
  };
  const initialSize = await cardSize();
  expect(initialSize).toMatchObject({ width: 232, height: 144 });
  expect(initialSize.left).toBeLessThan(14);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(cardSize).toEqual(initialSize);
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

test('podpowiedź i wpisana nazwa miejscowości pomijają ulicę o podobnej nazwie', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const bytow = { ...stores[0], city: 'Bytów', address: 'ul. Długa 1, 77-100 Bytów' };
  const lebork = { ...stores[1], city: 'Lębork', address: 'ul. Bytowska 2, 84-300 Lębork' };
  await page.route('**/functions/v1/store-catalog', route => route.fulfill({ json: catalog([bytow, lebork]) }));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 2);

  const search = page.getByRole('textbox', { name: 'Miasto lub adres sklepu' });
  const searchFrame = search.locator('..');
  const suggestions = page.getByTestId('city-suggestions');
  await expect(searchFrame).toHaveCSS('background-color', 'rgb(234, 234, 229)');
  await expect(searchFrame).toHaveCSS('border-radius', '16px');
  await expect(searchFrame).toHaveCSS('min-height', '52px');
  await expect(search).toHaveCSS('font-size', '16px');
  await search.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS('outline-style', 'none');
  await expect(search).toHaveCSS('border-top-width', '0px');
  await expect(search).toHaveCSS('box-shadow', 'none');
  await expect(searchFrame).toHaveCSS('border-top-width', '0px');
  await expect(searchFrame).toHaveCSS('box-shadow', 'none');
  await search.fill('B');
  await expect(suggestions).toBeHidden();
  await search.fill('By');
  await expect(suggestions.getByRole('button')).toHaveCount(1);
  await suggestions.getByRole('button', { name: 'Bytów' }).click();
  await expect(search).toHaveValue('Bytów');
  await expect(suggestions).toBeHidden();
  await waitForStores(page, 1);
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '1');

  await search.fill('bytow');
  await search.press('Enter');
  await expect(suggestions).toBeHidden();
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '2');
  await page.getByRole('checkbox', { name: /^Lidl,/ }).click();
  await waitForStores(page, 0);
  await search.fill('bytowska 2');
  await waitForStores(page, 1);
});

test('karta sklepu rośnie i mieści długi adres bez przewijania', async ({ page }) => {
  const address = 'ul. Prezydenta Gabriela Narutowicza 21, pawilon handlowy przy skrzyżowaniu z ulicą Łódzką, 95-050 Konstantynów Łódzki';
  await page.route('**/functions/v1/store-catalog', route => route.fulfill({ json: catalog([{ ...stores[0], address }]) }));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 1);
  await page.getByRole('button', { name: 'Pokaż wyniki na mapie' }).click();
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '1');
  await embedded(page).locator('canvas').click();

  const card = page.getByTestId('store-card');
  const addressElement = card.getByText(address, { exact: true });
  const directions = card.getByRole('button', { name: 'Wyznacz trasę' });
  await expect(addressElement).toBeInViewport({ ratio: 1 });
  await expect(directions).toBeInViewport({ ratio: 1 });
  expect((await card.boundingBox())!.height).toBeGreaterThan(144);
  const addressBox = (await addressElement.boundingBox())!;
  expect(addressBox.y + addressBox.height).toBeLessThan((await directions.boundingBox())!.y);
  expect(await card.evaluate(element => element.scrollHeight)).toBe(await card.evaluate(element => element.clientHeight));
});

test('jasna mapa ma jeden podpis, który zwija się po 5 sekundach i daje się ponownie otworzyć', async ({ page }) => {
  let modules = 0;
  page.on('request', request => { if (request.url() === MAPLIBRE_ASSETS + 'maplibre-gl.mjs') modules++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, stores.length);
  await expect(page.getByRole('button', { name: /Włącz (ciemną|jasną) mapę/ })).toHaveCount(0);
  await expect(page.getByText('All the Places')).toHaveCount(0);
  const map = embedded(page);
  const info = map.getByRole('button', { name: 'Źródła i licencje mapy' });
  const credits = map.locator('#map-attribution');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(credits).toHaveText('© OpenMapTiles · © OpenStreetMap · GUGiK · Overture Maps');
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
  await page.getByRole('tab', { name: 'Mapa', exact: true }).click();
  await waitForStores(page, stores.length);
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
  await waitForStores(page, stores.length);
  await expect(page.getByText(/Brak zgody/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Moja lokalizacja' }).click();
  await expect(page.getByText(/Brak zgody na lokalizację/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^Dino,/ }).click();
  await waitForStores(page, stores.length - 1);
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
  await waitForStores(page, stores.length);
  expect(await page.evaluate(() => (window as unknown as { locationRequests: number }).locationRequests)).toBe(0);
  await page.getByRole('button', { name: 'Moja lokalizacja' }).click();
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-focus-request', '1');
  expect(await page.evaluate(() => (window as unknown as { locationRequests: number }).locationRequests)).toBeGreaterThan(0);
  await expect(embedded(page).locator('#map')).toHaveAttribute('aria-busy', 'false');
  await embedded(page).locator('canvas').click();
  await expect(page.getByTestId('store-card')).toContainText('0 m w linii prostej');
});

test('błąd katalogu można ponowić', async ({ page }) => {
  let failed = true;
  await page.route('**/functions/v1/store-catalog', route => failed ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: catalog() }));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sklepy są chwilowo niedostępne')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await waitForStores(page, stores.length);
});

test('błąd silnika daje ponowienie bez zmiany ekranu', async ({ page }) => {
  await page.route(MAPLIBRE_ASSETS + 'maplibre-gl.mjs', route => route.abort());
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Uruchom mapę ponownie' })).toBeVisible();
  await page.unroute(MAPLIBRE_ASSETS + 'maplibre-gl.mjs');
  await page.route(MAPLIBRE_ASSETS + 'maplibre-gl.mjs', async route => route.fulfill(await localLibrary('maplibre-gl.mjs')));
  await page.getByRole('button', { name: 'Uruchom mapę ponownie' }).click();
  await waitForStores(page, stores.length);
});

test('8545 punkty pozostają jedną warstwą, filtry nie przeładowują ramki', async ({ page }) => {
  const points = Array.from({ length: 8545 }, (_, i) => ({ ...stores[i % stores.length], id: stores[i % stores.length].chain + ':' + i,
    latitude: 49.2 + (i % 80) * 0.065, longitude: 14.5 + Math.floor(i / 80) * 0.09 }));
  await page.route('**/functions/v1/store-catalog', route => route.fulfill({ json: catalog(points) }));
  let modules = 0;
  page.on('request', request => { if (request.url() === MAPLIBRE_ASSETS + 'maplibre-gl.mjs') modules++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 8545);
  await expect(embedded(page).locator('canvas')).toHaveCount(1);
  await expect(embedded(page).locator('.maplibregl-marker')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^Dino,/ }).click();
  const remaining = points.filter(point => point.chain !== "dino").length;
  await waitForStores(page, remaining);
  expect(modules).toBe(1);
});

test('kliknięcie grupy przybliża mapę, a kolejne otwiera sklep', async ({ page }) => {
  const points = [stores[0], { ...stores[3], address: 'Łódź, Żółta 2', latitude: 51.75001, longitude: 19.45001 }];
  await page.route('**/functions/v1/store-catalog', route => route.fulfill({ json: catalog(points) }));
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 2);
  await page.getByRole('button', { name: 'Pokaż wyniki na mapie' }).click();
  const region = embedded(page).locator('#map');
  await expect(region).toHaveAttribute('data-focus-request', '1');
  // Capture the 400 ms animation in the browser, even if the test runner resumes
  // after it finishes. Keep checking both motion start and the final idle state.
  await region.evaluate(element => {
    element.setAttribute('data-test-motion-started', 'false');
    const observer = new MutationObserver(records => {
      if (element.getAttribute('aria-busy') === 'true' || records.some(record => record.oldValue === 'true')) {
        element.setAttribute('data-test-motion-started', 'true');
        observer.disconnect();
      }
    });
    observer.observe(element, { attributes: true, attributeFilter: ['aria-busy'], attributeOldValue: true });
  });
  await embedded(page).locator('canvas').click();
  await expect(region).toHaveAttribute('data-test-motion-started', 'true');
  await expect(region).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('store-card')).toHaveCount(0);
  await embedded(page).locator('canvas').click();
  await expect(page.getByTestId('store-card')).toContainText('Łódź, Żółta');
});

test('na małym ekranie mapa mieści się nad nawigacją', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, stores.length);
  const map = await page.getByTestId('stores-map').boundingBox();
  const tabs = await page.getByRole('tab', { name: 'Mapa', exact: true }).boundingBox();
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
  expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'ready', channel }), expect.objectContaining({ type: 'data-ready', count: stores.length })]));
  expect(await page.evaluate(() => location.origin)).toBe(new URL(source.baseUrl).origin);
  await expect(page.getByRole('button', { name: 'Źródła i licencje mapy' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#map-attribution')).toBeHidden();
  await page.getByRole('button', { name: 'Źródła i licencje mapy' }).click();
  await expect(page.locator('#map-attribution')).toBeVisible();
});
