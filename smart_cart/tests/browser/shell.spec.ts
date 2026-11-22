import { expect, test } from '@playwright/test';
import { tree } from '../fixtures/catalog-v1';
import { AUTH_URL, changeSession, mockMap, testSession } from './map-fixture';

test('Home ma pięć kafelków we właściwych rzędach i pięć zakładek', async ({ page }, info) => {
  await mockMap(page); await page.goto('/');
  await expect(page.getByRole('tab')).toHaveCount(5);
  expect(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('aria-label')))).toEqual(['Home', 'Ulubione', 'Koszyk', 'Szukaj', 'Mapa']);
  const grid = page.getByTestId('home-grid');
  await expect(grid.getByRole('link')).toHaveCount(5);
  const names = ['Listy zakupów', 'Ulubione', 'Gazetki', 'Mapa sklepów', 'Produkty'];
  const targets = ['/cart', '/favorites', '/leaflets', '/stores', '/products'];
  for (const size of [390, 320]) {
    await page.setViewportSize({ width: size, height: 740 });
    const boxes = await Promise.all(names.map(name => grid.getByRole('link', { name, exact: true }).boundingBox()));
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    expect(boxes[2]!.width).toBeGreaterThan(boxes[0]!.width * 1.9);
    expect(Math.abs(boxes[3]!.y - boxes[4]!.y)).toBeLessThan(2);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[3]!.y).toBeGreaterThan(boxes[2]!.y);
  }
  await page.screenshot({ path: info.outputPath('home-light.png'), fullPage: true });
  for (let i = 0; i < names.length; i++) {
    await grid.getByRole('link', { name: names[i], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${targets[i]}$`));
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
  }
});

test('wyszukiwanie Home przekazuje znaki specjalne, katalog ma jedno pole', async ({ page }) => {
  await mockMap(page); let query = '';
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_tree`, route => route.fulfill({ json: tree }));
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_search`, route => { query = route.request().postDataJSON().p_query; return route.fulfill({ json: { version: 1, total: 0, limit: 30, offset: 0, items: [] } }); });
  await page.goto('/');
  const value = 'Mleko 3,2% & Łódź + / ?';
  await page.getByRole('textbox', { name: 'Szukaj produktów', exact: true }).fill(value);
  await page.getByRole('textbox', { name: 'Szukaj produktów', exact: true }).press('Enter');
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
  await open.click();
  await expect(page.getByRole('button', { name: 'Zamknij menu', exact: true })).toBeFocused();
  await page.getByRole('radio', { name: 'Ciemny' }).click();
  await expect(page.getByRole('radio', { name: 'Ciemny' })).toBeChecked();
  await expect(page.getByText('SMARTCART · wersja 1.0.0')).toBeVisible();
  await expect(page.getByRole('button', { name: /wersja/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('menu-dark.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Zamknij menu', exact: true })).toBeHidden();
  await expect(page).toHaveURL(/\/cart$/); await expect(open).toBeFocused();
  await open.click(); await page.getByRole('button', { name: 'Zamknij menu przez tło' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await page.reload(); await open.click();
  await expect(page.getByRole('radio', { name: 'Ciemny' })).toBeChecked();
  await page.getByRole('radio', { name: 'Systemowy' }).click();
  await page.getByRole('button', { name: 'Zamknij menu', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.getByText('Listy zakupów', { exact: true })).toHaveCSS('color', 'rgb(21, 45, 67)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByText('Listy zakupów', { exact: true })).toHaveCSS('color', 'rgb(237, 244, 239)');
  await page.getByRole('tab', { name: 'Home' }).click();
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
  await expect(chain.getByText('Lidl', { exact: true })).toHaveCSS('color', 'rgb(237, 244, 239)');
  await page.screenshot({ path: info.outputPath('map-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await expect(page.getByRole('button', { name: 'Zamknij menu', exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: 'SMARTCART — ekran startowy' })).toBeHidden();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Menu SMARTCART"]')
      || document.activeElement?.getAttribute('aria-label') === 'Zamknij menu przez tło')).toBe(true);
  }
  await page.getByText('SMARTCART · wersja 1.0.0').scrollIntoViewIfNeeded();
  await expect(page.getByText('SMARTCART · wersja 1.0.0')).toBeVisible();
});
