import { expect, test } from '@playwright/test';
import { tree } from '../fixtures/catalog-v1';
import { AUTH_URL, changeSession, mockMap, testSession } from './map-fixture';

test('logo jest po lewej stronie nagłówka, a menu po prawej', async ({ page }) => {
  await mockMap(page);
  await page.goto('/');
  const logo = page.getByRole('link', { name: 'SMARTCART — ekran startowy' });
  const menu = page.getByRole('button', { name: 'Otwórz menu' });
  await expect(logo).toBeVisible();
  for (const width of [280, 320, 1024]) {
    await page.setViewportSize({ width, height: 740 });
    const box = (await logo.boundingBox())!;
    const header = (await logo.locator('..').boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(box.x - header.x).toBeCloseTo(16);
    expect(header.x + header.width - menuBox.x - menuBox.width).toBeCloseTo(16);
    expect(box.width).toBeLessThanOrEqual(220);
    expect(box.x + box.width).toBeLessThan(menuBox.x);
  }
});

test('wystająca część przycisku Koszyk otwiera koszyk', async ({ page }) => {
  await mockMap(page);
  await page.goto('/');
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 740 });
    const cart = page.getByRole('tab', { name: 'Koszyk', exact: true });
    const home = page.getByRole('tab', { name: 'Start', exact: true });
    await expect(cart).toBeVisible();
    const cartBox = (await cart.boundingBox())!;
    const homeBox = (await home.boundingBox())!;
    const bar = (await page.getByTestId('bottom-bar-background').boundingBox())!;
    const content = (await page.getByTestId('home-grid').boundingBox())!;
    expect(content.y + content.height).toBeCloseTo(bar.y, 0);
    expect(homeBox.y - cartBox.y).toBeGreaterThanOrEqual(15);
    const cartLabel = (await cart.getByText('Koszyk').boundingBox())!;
    const homeLabel = (await home.getByText('Start').boundingBox())!;
    expect(Math.abs(cartLabel.y - homeLabel.y)).toBeLessThan(2);
    await page.mouse.click(cartBox.x + cartBox.width / 2, cartBox.y + 5);
    await expect(page).toHaveURL(/\/cart$/);
    await home.click();
  }
});

test('Start mieści skróty i gazetki bez pionowego przewijania', async ({ page }, info) => {
  await mockMap(page); await page.goto('/');
  await expect(page.getByRole('tab')).toHaveCount(5);
  expect(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('aria-label')))).toEqual(['Start', 'Ulubione', 'Koszyk', 'Szukaj', 'Mapa']);
  const grid = page.getByTestId('home-grid');
  const lidlTile = grid.getByRole('link', { name: 'Gazetki: Lidl' }).getByTestId('leaflet-chain-tile');
  await expect(lidlTile).toHaveCSS('background-color', 'rgb(10, 80, 161)');
  await expect(lidlTile).toHaveCSS('border-radius', '6px');
  const biedronkaTile = grid.getByRole('link', { name: 'Gazetki: Biedronka' }).getByTestId('leaflet-chain-tile');
  await expect(biedronkaTile).toHaveCSS('background-color', 'rgb(253, 237, 20)');
  await expect(biedronkaTile).toHaveCSS('border-color', 'rgb(0, 0, 0)');
  const names = ['Listy zakupów', 'Ulubione', 'Produkty', 'Gazetki'];
  const targets = ['/shopping-lists', '/favorites', '/products', '/leaflets'];
  for (const [width, height] of [[1024, 768], [820, 390], [390, 740], [360, 640], [320, 480]]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const boxes = await Promise.all(names.map(name => grid.getByRole('link', { name, exact: true }).boundingBox()));
      expect(boxes[1]!.y).toBeCloseTo(boxes[2]!.y);
      expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.9);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
      if (width !== 820) expect(boxes[3]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height);
      expect(await grid.evaluate(element => element.scrollHeight)).toBe(await grid.evaluate(element => element.clientHeight));
      const leaflet = (await grid.getByRole('link', { name: 'Gazetki: Lidl' }).boundingBox())!;
      const cartTab = (await page.getByRole('tab', { name: 'Koszyk' }).boundingBox())!;
      expect(leaflet.y + leaflet.height).toBeLessThanOrEqual(cartTab.y);
    }).toPass({ timeout: 3500 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(grid.getByText('Wszystkie Twoje zapisane listy')).toBeVisible();
  await page.screenshot({ path: info.outputPath('home-light.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 480 });
  for (let i = 0; i < names.length; i++) {
    await grid.getByRole('link', { name: names[i], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${targets[i]}$`));
    await page.getByRole('tab', { name: 'Start', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Następne sieci' }).click();
  await expect(page.getByRole('button', { name: 'Poprzednie sieci' })).toBeEnabled();
  await grid.getByRole('link', { name: 'Gazetki: Carrefour' }).click();
  await expect(page).toHaveURL(/\/leaflets\?chain=carrefour$/);
  await expect(page.getByText('Brak aktualnych gazetek tej sieci.')).toBeVisible();
});

test('wyszukiwanie Home przekazuje znaki specjalne, katalog ma jedno pole', async ({ page }) => {
  await mockMap(page); let query = '';
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_tree`, route => route.fulfill({ json: tree }));
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_search`, route => { query = route.request().postDataJSON().p_query; return route.fulfill({ json: { version: 1, total: 0, limit: 30, offset: 0, items: [] } }); });
  await page.goto('/');
  const value = 'Mleko 3,2% & Łódź + / ?';
  const search = page.getByRole('textbox', { name: 'Szukaj produktów', exact: true });
  const searchFrame = search.locator('..');
  await expect(searchFrame).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(searchFrame).toHaveCSS('border-radius', '16px');
  await expect(searchFrame).toHaveCSS('min-height', '52px');
  await expect(search).toHaveCSS('font-size', '16px');
  await search.fill(value);
  await expect(search).toHaveCSS('outline-style', 'none');
  await expect(searchFrame).toHaveCSS('border-top-width', '1px');
  await expect(searchFrame).toHaveCSS('box-shadow', 'none');
  await search.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Szukaj w całym katalogu' })).toHaveValue(value);
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect.poll(() => query).toBe(value);
  for (const path of ['/profile', '/help', '/rules', '/cart', '/leaflets', '/favorites', '/stores']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Otwórz menu' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Szukaj produktów', exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('textbox', { name: 'Miasto lub adres sklepu' })).toBeVisible();
});

test('menu zamyka się Escape i tłem, zachowuje trasę i focus; motyw działa po restarcie', async ({ page }, info) => {
  await mockMap(page); await page.goto('/cart');
  const open = page.getByRole('button', { name: 'Otwórz menu' });
  const panel = page.getByLabel('Menu SMARTCART', { exact: true });
  await open.click();
  await expect(panel).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Zamknij menu', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Ciemny' }).click();
  await expect(page.getByRole('radio', { name: 'Ciemny' })).toBeChecked();
  await expect(page.getByText('SMARTCART · wersja 1.0.0')).toBeVisible();
  await expect(page.getByRole('button', { name: /wersja/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('menu-dark.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/cart$/); await expect(open).toBeFocused();
  await open.click(); await page.getByRole('button', { name: 'Zamknij menu przez tło' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await page.reload(); await open.click();
  await expect(panel).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Ciemny' })).toBeChecked();
  await page.getByRole('radio', { name: 'Systemowy' }).click();
  await expect(page.getByRole('radio', { name: 'Systemowy' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.emulateMedia({ colorScheme: 'light' });
  const cartHeading = page.getByRole('heading', { name: 'Twój Koszyk', exact: true });
  await expect(cartHeading).toHaveCSS('color', 'rgb(21, 45, 67)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(cartHeading).toHaveCSS('color', 'rgb(237, 244, 239)');
  await page.getByRole('tab', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('home-grid')).toBeVisible();
  await expect(page.getByLabel('Menu SMARTCART', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('home-dark.png'), fullPage: true });
  await open.click(); await page.getByRole('button', { name: 'Pomoc', exact: true }).click();
  await expect(page).toHaveURL(/\/help$/);
  await page.getByRole('button', { name: 'Wróć', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('nowe widoki są chronione, login zachowuje deep link i reload', async ({ page }) => {
  await mockMap(page, null);
  await page.route(`${AUTH_URL}/auth/v1/token?grant_type=password`, route => route.fulfill({ json: testSession() }));
  for (const target of ['/help', '/rules', '/leaflets', '/leaflets/test-1?page=2', '/profile']) {
    await page.goto(target);
    await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Otwórz menu' })).toBeHidden();
  }
  await page.goto('/leaflets/test-1?page=2');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('map-test@example.invalid');
  await page.getByLabel('Hasło', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page).toHaveURL(/\/leaflets\/test-1\?page=2$/);
  await expect(page.getByText('Ta gazetka nie jest już dostępna.')).toBeVisible();
});

test('Profil: kod, walidacja, odpowiedź API i zachowana sesja', async ({ page }) => {
  await mockMap(page); let saves = 0;
  await page.route(`${AUTH_URL}/auth/v1/reauthenticate`, route => route.fulfill({ json: {} }));
  await page.route(`${AUTH_URL}/auth/v1/user`, route => {
    if (route.request().method() === 'PUT') { saves++; expect(route.request().postDataJSON()).toEqual({ password: 'new-test-password', nonce: '123456', code_challenge: null, code_challenge_method: null }); }
    return route.fulfill({ json: testSession().user });
  });
  await page.goto('/profile');
  await expect(page.getByText('map-test@example.invalid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zmień hasło', exact: true }).click();
  await page.getByRole('button', { name: 'Wyślij kod potwierdzenia' }).click();
  await page.getByRole('textbox', { name: 'Kod potwierdzenia' }).fill('123456');
  await page.getByLabel('Nowe hasło', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
  await expect(page.getByText('Hasło musi mieć co najmniej 8 znaków.', { exact: true })).toBeVisible();
  await page.getByLabel('Nowe hasło', { exact: true }).fill('new-test-password');
  await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
  await expect(page.getByText('Hasła nie są takie same.')).toBeVisible();
  await page.getByLabel('Powtórz nowe hasło', { exact: true }).fill('new-test-password');
  await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
  await expect(page.getByText('Hasło zostało zmienione. Pozostajesz zalogowany.')).toBeVisible();
  expect(saves).toBe(1);
  await expect(page.getByLabel('Nowe hasło', { exact: true })).toHaveCount(0);
});

test('wylogowanie z menu pokazuje błąd także po przejściu do logowania', async ({ page }) => {
  await mockMap(page);
  await page.route(`${AUTH_URL}/auth/v1/logout*`, route => route.fulfill({ status: 500, json: { code: 'unexpected_failure' } }));
  await page.goto('/profile'); await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await expect(page.getByText('Usługa jest chwilowo niedostępna. Spróbuj ponownie później.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('zewnętrzna zmiana sesji usuwa pola hasła', async ({ page }) => {
  await mockMap(page); await page.goto('/profile');
  await page.getByRole('button', { name: 'Zmień hasło', exact: true }).click();
  await changeSession(page, null);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await expect(page.getByText('Zmiana hasła', { exact: true })).toBeHidden();
});

test('Profil: anulowanie w trakcie zapisu nie pokazuje późnego sukcesu', async ({ page }) => {
  await mockMap(page);
  await page.route(`${AUTH_URL}/auth/v1/reauthenticate`, route => route.fulfill({ json: {} }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${AUTH_URL}/auth/v1/user`, async route => {
    if (route.request().method() === 'PUT') await held;
    await route.fulfill({ json: testSession().user });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Zmień hasło', exact: true }).click();
  await page.getByRole('button', { name: 'Wyślij kod potwierdzenia' }).click();
  await page.getByRole('textbox', { name: 'Kod potwierdzenia' }).fill('123456');
  await page.getByLabel('Nowe hasło', { exact: true }).fill('fixture-password');
  await page.getByLabel('Powtórz nowe hasło', { exact: true }).fill('fixture-password');
  const requested = page.waitForRequest(request => request.url().endsWith('/auth/v1/user') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click(); await requested;
  const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/auth/v1/user'));
  await page.getByRole('button', { name: 'Anuluj zmianę hasła' }).click();
  release(); await aborted;
  await expect(page.getByText(/Wysłanego żądania nie można cofnąć/)).toBeVisible();
  await expect(page.getByText('Hasło zostało zmienione. Pozostajesz zalogowany.')).toHaveCount(0);
  await expect(page.getByLabel('Nowe hasło', { exact: true })).toHaveCount(0);
  await expect(page.getByText('map-test@example.invalid', { exact: true })).toBeVisible();
});

test('ciemna mapa i małe menu zachowują czytelność oraz focus wewnątrz modalu', async ({ page }, info) => {
  await mockMap(page); await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/stores');
  const chain = page.getByRole('checkbox', { name: 'Lidl, 1 sklepów', exact: true });
  await expect(chain).toBeVisible();
  await expect(chain.locator('img')).toBeVisible();
  await expect(chain).toHaveCSS('background-color', 'rgb(10, 80, 161)');
  await page.screenshot({ path: info.outputPath('map-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  const panel = page.getByLabel('Menu SMARTCART', { exact: true });
  await expect(panel).toBeFocused();
  await expect(page.getByRole('link', { name: 'SMARTCART — ekran startowy' })).toBeHidden();
  const logo = panel.getByRole('img', { name: 'SmartCart', exact: true });
  const themes = panel.getByRole('radio');
  const version = panel.getByText('SMARTCART · wersja 1.0.0');
  await expect(themes).toHaveCount(3);
  for (const radio of await themes.all()) {
    await expect(radio).toHaveText(/\S/);
    await expect(radio).not.toContainText(/Jasny|Ciemny|Systemowy/);
  }
  for (const width of [280, 1024, 320]) {
    await page.setViewportSize({ width, height: 568 });
    const panelBox = (await panel.boundingBox())!;
    const logoBox = (await logo.boundingBox())!;
    const title = (await panel.getByRole('heading', { name: 'Motyw' }).boundingBox())!;
    const rules = (await panel.getByRole('button', { name: 'Zasady porównywania' }).boundingBox())!;
    const versionBox = (await version.boundingBox())!;
    const logout = (await panel.getByRole('button', { name: 'Wyloguj się' }).boundingBox())!;
    const boxes = await Promise.all((await themes.all()).map(radio => radio.boundingBox()));
    expect(panelBox.width).toBeCloseTo(Math.min(width * 0.6, 252), 0);
    for (const box of boxes) {
      expect(box!.y).toBeCloseTo(boxes[0]!.y, 0);
      expect(box!.x + box!.width).toBeLessThan(panelBox.x + panelBox.width);
    }
    expect(versionBox.y - logout.y - logout.height).toBeCloseTo(32, 0);
    expect(panelBox.y + panelBox.height - versionBox.y - versionBox.height).toBeCloseTo(0, 0);
    expect((title.y + rules.y + rules.height) / 2).toBeCloseTo((panelBox.y + logout.y - 8) / 2, 0);
    expect(logoBox.y + logoBox.height / 2).toBeCloseTo((panelBox.y + title.y) / 2, 0);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Menu SMARTCART"]')
      || document.activeElement?.getAttribute('aria-label') === 'Zamknij menu przez tło')).toBe(true);
  }
  await expect(version).toBeVisible();
  await expect(version).toHaveCSS('font-size', '10px');
});
