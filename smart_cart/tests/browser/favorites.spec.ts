import { expect, test, type Page } from '@playwright/test';
import { AUTH_URL, changeSession, mockMap } from './map-fixture';

const milk = { id: 17, name: 'Mleko UHT 3,2% bez laktozy', unit: 'ml', default_quantity: 1000, offer_count: 1, lowest_price: 6 };
const eggs = { ...milk, id: 18, name: 'Jajka z chowu na wolnym wybiegu, rozmiar L', unit: 'szt' };
const firstList = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondList = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup(page: Page) {
  await mockMap(page);
  const state = {
    groups: [milk, eggs], favoriteError: false, removeError: false, saveError: false, offerError: false,
    saved: [] as { p_group_id: number; p_quantity: number; p_unit: string; p_selected_product_id: number | null; p_list_id: string }[],
    deletes: [] as string[], offerReads: 0, holdSave: null as Promise<void> | null,
  };
  await page.route(`${AUTH_URL}/rest/v1/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.split('/').pop()!;
    const fail = () => route.fulfill({ status: 503, json: { message: 'PRIVATE_BACKEND_DETAIL' } });
    if (request.method() === 'DELETE') state.deletes.push(endpoint);
    if (endpoint === 'favorite_groups') {
      if (request.method() === 'DELETE') {
        if (state.removeError) return fail();
        const id = Number(url.searchParams.get('group_id')?.slice(3));
        state.groups = state.groups.filter(group => group.id !== id);
      }
      if (state.favoriteError) return fail();
      return route.fulfill({ json: state.groups.map(group => ({ group_id: group.id, group })) });
    }
    if (endpoint === 'shopping_lists') return route.fulfill({ json: [
      { id: firstList, name: 'Na tydzień', updated_at: '2026-11-20T10:00:00Z' },
      { id: secondList, name: 'Weekend', updated_at: '2026-11-19T10:00:00Z' },
    ] });
    if (endpoint === 'add_shopping_item') {
      if (state.saveError) return fail();
      state.saved.push(request.postDataJSON());
      if (state.holdSave) await state.holdSave;
      return route.fulfill({ json: [] });
    }
    if (endpoint === 'catalog_offers') {
      state.offerReads++;
      if (state.offerError) return fail();
      return route.fulfill({ json: [{ offer_id: 1, product_id: 91, group_id: milk.id, store_id: 1, store_name: 'Sieć A',
        product_name: 'Mleko testowe 500 ml', gramatura_norm: '500 ml', quantity_value: 500, quantity_unit: 'ml', sale_mode: 'package',
        single_price: 6, regular_price: 6, price_status: 'prawdziwa', regular_price_observed_at: null, promo_price: null, verified_promotion: false }] });
    }
    if (endpoint === 'search_product_groups') return route.fulfill({ json: [milk] });
    return route.fulfill({ json: [] });
  });
  return state;
}

test('ulubione: ręczna ilość, wybór listy i podgląd na małym ekranie', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/favorites');
  await expect(page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` })).toBeVisible();
  expect(state.offerReads).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('favorites-compact.png'), fullPage: true });
  await page.getByRole('button', { name: `Dodaj do listy: ${milk.name}`, exact: true }).click();
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${milk.name} (ml)` });
  await expect(quantity).toHaveValue('');
  await page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` }).click();
  await expect(page.getByText(/Podaj dodatnią ilość/)).toBeVisible();
  expect(state.saved).toEqual([]);
  await quantity.fill('750,25');
  await page.getByRole('button', { name: 'Lista: Weekend', exact: true }).click();
  await page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` }).click();
  await expect(page.getByText('Dodano 750,25 ml do listy: Weekend.')).toBeVisible();
  expect(state.saved).toEqual([{ p_group_id: milk.id, p_quantity: 750.25, p_unit: 'ml', p_selected_product_id: null, p_list_id: secondList }]);
  await page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` }).click();
  await expect(page.getByText('Mleko testowe 500 ml', { exact: true })).toBeVisible();
  await expect(page.getByText('Data potwierdzenia ceny niedostępna')).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj ten produkt: Mleko testowe 500 ml' }).click();
  await expect.poll(() => state.saved.length).toBe(2);
  expect(state.saved[1].p_selected_product_id).toBe(91);
  await page.screenshot({ path: testInfo.outputPath('favorites-expanded.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Zwiń produkty i ceny', exact: true }).click();
  await expect(quantity).toHaveValue('750,25');
});

test('reload zachowuje ulubione, a usunięcie odświeża serduszko w katalogu bez zmiany zakupów', async ({ page }) => {
  const state = await setup(page);
  // Existing shopping data must survive removing a favorite.
  state.saved.push({ p_group_id: milk.id, p_quantity: 500, p_unit: 'ml', p_selected_product_id: null, p_list_id: firstList });
  await page.goto('/favorites');
  await expect(page.getByRole('button', { name: `Usuń z ulubionych: ${milk.name}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: `Usuń z ulubionych: ${milk.name}` })).toBeVisible();
  await page.getByRole('button', { name: `Usuń z ulubionych: ${milk.name}` }).click();
  await expect(page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` })).not.toBeVisible();
  expect(state.saved).toEqual([{ p_group_id: milk.id, p_quantity: 500, p_unit: 'ml', p_selected_product_id: null, p_list_id: firstList }]);
  expect(state.deletes).toEqual(['favorite_groups']);
  await page.goto('/products');
  await page.getByRole('button', { name: `Rozwiń oferty: ${milk.name}` }).click();
  await expect(page.getByRole('button', { name: 'Dodaj do ulubionych', exact: true })).toBeVisible();
});

test('ilość sztuk jest całkowita, a drugi zapis jest blokowany podczas żądania', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/favorites');
  await page.getByRole('button', { name: `Dodaj do listy: ${eggs.name}`, exact: true }).click();
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${eggs.name} (szt)` });
  await quantity.fill('1,5');
  const add = page.getByRole('button', { name: `Dodaj grupę: ${eggs.name}` });
  await add.click();
  await expect(page.getByText(/Podaj całkowitą liczbę sztuk/)).toBeVisible();
  expect(state.saved).toEqual([]);
  let release!: () => void;
  state.holdSave = new Promise<void>(resolve => { release = resolve; });
  await quantity.fill('2');
  await add.click();
  await expect(add).toBeDisabled();
  await expect(page.getByRole('button', { name: `Usuń z ulubionych: ${eggs.name}` })).toBeDisabled();
  await expect.poll(() => state.saved.length).toBe(1);
  release();
  await expect(page.getByText('Dodano 2 szt do listy: Na tydzień.')).toBeVisible();
  await expect(add).toBeEnabled();
  expect(state.saved).toHaveLength(1);
});

test('błąd pobierania nie udaje pustej listy, a ponowienie i pusty widok prowadzą do katalogu', async ({ page }) => {
  const state = await setup(page);
  state.favoriteError = true;
  await page.goto('/favorites');
  await expect(page.getByRole('button', { name: 'Ponów pobieranie ulubionych' })).toBeVisible();
  await expect(page.getByText('Nie masz jeszcze ulubionych grup.')).not.toBeVisible();
  await expect(page.getByText('PRIVATE_BACKEND_DETAIL')).not.toBeVisible();
  state.favoriteError = false;
  await page.getByRole('button', { name: 'Ponów pobieranie ulubionych' }).click();
  await expect(page.getByRole('button', { name: `Usuń z ulubionych: ${milk.name}` })).toBeVisible();
  state.groups = [];
  await page.getByRole('button', { name: 'Odśwież ulubione' }).click();
  await expect(page.getByText('Nie masz jeszcze ulubionych grup.')).toBeVisible();
  await page.getByRole('link', { name: 'Przejdź do katalogu →' }).click();
  await expect(page).toHaveURL(/\/products$/);
});

test('błędy zapisu, usuwania i ofert zachowują grupę oraz wpisaną ilość', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/favorites');
  state.removeError = true;
  await page.getByRole('button', { name: `Usuń z ulubionych: ${milk.name}` }).click();
  await expect(page.getByText('Nie udało się pobrać lub zapisać danych. Spróbuj ponownie.')).toBeVisible();
  await expect(page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` })).toBeVisible();
  await page.getByRole('button', { name: `Dodaj do listy: ${milk.name}`, exact: true }).click();
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${milk.name} (ml)` });
  await quantity.fill('250');
  state.saveError = true;
  await page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` }).click();
  await expect(page.getByText('Nie udało się pobrać lub zapisać danych. Spróbuj ponownie.')).toBeVisible();
  await expect(quantity).toHaveValue('250');
  expect(state.saved).toEqual([]);
  state.saveError = false;
  await page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` }).click();
  await expect(page.getByText('Dodano 250 ml do listy: Na tydzień.')).toBeVisible();
  state.offerError = true;
  await page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` }).click();
  await expect(page.getByRole('button', { name: 'Ponów pobieranie ofert' })).toBeVisible();
  await expect(page.getByText('Brak ofert w bazie.')).not.toBeVisible();
  state.offerError = false;
  await page.getByRole('button', { name: 'Ponów pobieranie ofert' }).click();
  await expect(page.getByText('Mleko testowe 500 ml', { exact: true })).toBeVisible();
  await expect(quantity).toHaveValue('250');
});

test('wylogowanie podczas zapisu usuwa ulubione i ignoruje spóźniony wynik', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  state.holdSave = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/favorites');
  await page.getByRole('button', { name: `Dodaj do listy: ${milk.name}`, exact: true }).click();
  await page.getByRole('textbox', { name: `Potrzebna ilość: ${milk.name} (ml)` }).fill('500');
  await page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` }).click();
  await expect.poll(() => state.saved.length).toBe(1);
  await changeSession(page, null);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` })).not.toBeVisible();
  await expect(page.getByText('Dodano 500 ml do listy: Na tydzień.')).not.toBeVisible();
});

test('klawiatura: fokus pola, Enter bez zapisu, wybór listy i anulowanie rozwiniętej grupy', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/favorites');
  const open = page.getByRole('button', { name: `Dodaj do listy: ${milk.name}`, exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${milk.name} (ml)` });
  await expect(quantity).toBeFocused();
  await quantity.fill('350');
  await page.keyboard.press('Enter');
  await expect(quantity).not.toBeFocused();
  expect(state.saved).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Lista: Na tydzień', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const weekend = page.getByRole('button', { name: 'Lista: Weekend', exact: true });
  await expect(weekend).toBeFocused();
  await page.keyboard.press('Space');
  await expect(weekend).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: `Dodaj grupę: ${milk.name}` })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Dodano 350 ml do listy: Weekend.')).toBeVisible();

  const details = page.getByRole('button', { name: `Produkty i ceny: ${milk.name}` });
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Mleko testowe 500 ml', { exact: true })).toBeVisible();
  const cancel = page.getByRole('button', { name: `Anuluj dodawanie: ${milk.name}` });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(quantity).not.toBeVisible();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  expect(state.saved).toHaveLength(1);
  await page.keyboard.press('Enter');
  await expect(quantity).toBeFocused();
  await expect(quantity).toHaveValue('350');
  await details.focus();
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Zwiń produkty i ceny', exact: true });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(details).toBeFocused();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
});

test('mały ekran i dwukrotnie większy tekst zachowują pełne nazwy i dostęp do przycisków', async ({ page }, testInfo) => {
  const state = await setup(page);
  const longName = 'Mleko UHT 3,2% bez laktozy w opakowaniu zwrotnym — szczegółowa nazwa grupy produktów o zgodnych cechach';
  const listName = 'Zakupy na cały tydzień dla rodziny — bardzo długa nazwa listy';
  state.groups = [{ ...milk, name: longName }];
  await page.route(`${AUTH_URL}/rest/v1/shopping_lists?**`, route => route.fulfill({ json: [
    { id: firstList, name: listName, updated_at: '2026-11-20T10:00:00Z' },
    { id: secondList, name: 'Weekend', updated_at: '2026-11-19T10:00:00Z' },
  ] }));
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/favorites');
  await page.getByRole('button', { name: `Dodaj do listy: ${longName}`, exact: true }).click();
  const card = page.getByRole('button', { name: `Produkty i ceny: ${longName}` }).locator('..').locator('..');
  // Browser-only stress check: double rendered text and line height in this card.
  // Native system font scaling still requires a physical device check.
  await card.evaluate(element => {
    const texts = Array.from(element.querySelectorAll<HTMLElement>('[dir="auto"], input, textarea'));
    const sizes = texts.map(text => {
      const style = getComputedStyle(text);
      return { text, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
    });
    for (const { text, fontSize, lineHeight } of sizes) {
      if (text.textContent === '♥' || text.textContent === '▦') continue;
      text.style.fontSize = `${fontSize * 2}px`;
      if (Number.isFinite(lineHeight)) text.style.lineHeight = `${lineHeight * 2}px`;
    }
  });
  expect(await card.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('*'))
    .every(child => child.scrollWidth <= child.clientWidth + 1))).toBe(true);
  await expect(card.getByText(longName, { exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: `Usuń z ulubionych: ${longName}` });
  const touchTarget = await remove.boundingBox();
  expect(touchTarget?.width).toBeGreaterThanOrEqual(44);
  expect(touchTarget?.height).toBeGreaterThanOrEqual(44);
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${longName} (ml)` });
  await quantity.fill('500');
  await page.keyboard.press('Enter');
  const add = page.getByRole('button', { name: `Dodaj grupę: ${longName}` });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('favorites-large-text.png'), fullPage: true });
  await add.click();
  await expect(page.getByText(`Dodano 500 ml do listy: ${listName}.`)).toBeVisible();
  expect(state.saved[0].p_quantity).toBe(500);
});
