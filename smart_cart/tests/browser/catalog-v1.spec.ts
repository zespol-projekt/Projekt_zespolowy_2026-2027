import { expect, test, type Page } from '@playwright/test';
import { AUTH_URL, changeSession, mockMap, testSession } from './map-fixture';
import { tree, branch, group, groupItem, single, singleItem } from '../fixtures/catalog-v1';

const listId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function setup(page: Page) {
  await mockMap(page);
  const state = { missingApi: false, malformed: false, saveError: false, groupError: false, favorite: false,
    queries: [] as string[], branchOffsets: [] as number[], saved: [] as Record<string, unknown>[],
    holdSearch: null as Promise<void> | null };
  await page.route(`${AUTH_URL}/rest/v1/**`, async route => {
    const request = route.request(); const url = new URL(request.url()); const endpoint = url.pathname.split('/').pop();
    const body = request.postDataJSON();
    const fail = () => route.fulfill({ status: 503, json: { message: 'PRIVATE_SQL_DETAIL' } });
    if (endpoint?.startsWith('catalog_') && state.missingApi) return route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'missing RPC' } });
    if (endpoint === 'catalog_tree') return route.fulfill({ json: tree });
    if (endpoint === 'catalog_branch') {
      state.branchOffsets.push(body.p_offset);
      const result = body.p_subcategory === 'spizarnia-ryz' ? { ...branch(), total: 0, items: [], subcategory: { id: 10, slug: 'spizarnia-ryz', name: 'Ryż', verification_status: 'preliminary', category: { slug: 'spizarnia', name: 'Spiżarnia' } } } : branch(body.p_offset);
      return route.fulfill({ json: state.malformed ? { ...result, version: 2 } : result });
    }
    if (endpoint === 'catalog_search') {
      state.queries.push(body.p_query);
      if (state.holdSearch && body.p_query === 'stare') await state.holdSearch;
      return route.fulfill({ json: { version: 1, query: body.p_query, total: body.p_query === 'brak' ? 0 : 1, limit: 30, offset: 0,
        items: body.p_query === 'brak' ? [] : [{ ...groupItem, name: body.p_query === 'stare' ? 'Spóźniony wynik' : groupItem.name }] } });
    }
    if (endpoint === 'catalog_group') return state.groupError ? fail() : route.fulfill({ json: body.p_group_id === 106 ? { version: 1, group: { ...singleItem, path: single.product.path }, products: [{ ...single.product, offers: single.offers }] } : group });
    if (endpoint === 'catalog_product') return route.fulfill({ json: single });
    if (endpoint === 'shopping_lists') return route.fulfill({ json: [{ id: listId, name: 'Zakupy testowe', updated_at: '2026-11-21T10:00:00Z' }] });
    if (endpoint === 'favorite_groups') {
      if (request.method() === 'POST') state.favorite = true;
      if (request.method() === 'DELETE') state.favorite = false;
      return route.fulfill({ json: state.favorite ? [{ group_id: groupItem.group_id, group: { id: groupItem.group_id, name: groupItem.name, unit: groupItem.unit } }] : [] });
    }
    if (endpoint === 'add_shopping_item') {
      if (state.saveError) return fail();
      state.saved.push(body);
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function openMilk(page: Page) {
  await page.goto('/products?catalog=1');
  await page.getByRole('button', { name: 'Kategoria: Nabiał', exact: true }).click();
  await page.getByRole('button', { name: 'Podkategoria: Mleko', exact: true }).click();
  await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toBeVisible();
}

test('dodawanie z zapisanej listy kieruje produkt do niej zamiast do aktywnego koszyka', async ({ page }) => {
  const state = await setup(page);
  const savedListId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await page.route(`${AUTH_URL}/rest/v1/shopping_lists?**`, route => route.fulfill({ json: [
    { id: listId, name: 'Zakupy testowe', updated_at: '2026-11-21T10:00:00Z' },
    { id: savedListId, name: 'Na weekend', updated_at: '2026-11-20T10:00:00Z' },
  ] }));
  await page.goto('/shopping-lists');
  await page.getByRole('link', { name: 'Otwórz listę: Na weekend' }).click();
  await expect(page.getByText('Wyszukaj produkty i dodaj je do listy.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Szukaj', exact: true }).click();
  await page.getByRole('button', { name: 'Kategoria: Nabiał', exact: true }).click();
  await page.getByRole('button', { name: 'Podkategoria: Mleko', exact: true }).click();
  await expect(page.getByText('Lista: Na weekend', { exact: true }).first()).toBeVisible();
  await page.getByRole('textbox', { name: `Potrzebna ilość: ${groupItem.name} (ml)` }).fill('500');
  await page.getByRole('button', { name: `Dodaj do listy: ${groupItem.name}`, exact: true }).click();
  await expect.poll(() => state.saved.map(item => item.p_list_id)).toEqual([savedListId]);
});

test('ilość w gramach ma wyjaśnienie i zapisuje masę zamiast liczby opakowań', async ({ page }) => {
  const state = await setup(page);
  const item = { ...groupItem, name: 'Ryż biały', unit: 'g', price_from: null, stores_with_price_today: 0 };
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_search`, route => route.fulfill({ json: {
    version: 1, total: 1, limit: 30, offset: 0, items: [item],
  } }));
  await page.goto('/products?q=ryz');
  await expect(page.getByText('Podaj masę w gramach (g), np. 500 oznacza 500 g. To nie liczba opakowań.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Potrzebna ilość: Ryż biały (g)', exact: true }).fill('500');
  await page.getByRole('button', { name: 'Dodaj do listy: Ryż biały', exact: true }).click();
  await expect(page.getByText('Dodano 500 g do listy: Zakupy testowe.', { exact: true })).toBeVisible();
  expect(state.saved).toEqual([{ p_list_id: listId, p_group_id: item.group_id, p_quantity: 500, p_unit: 'g', p_selected_product_id: null }]);
});

test('Home i Szukaj otwierają wspólny katalog, a motyw zachowuje wpisaną ilość', async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Szukaj produktów', exact: true }).fill('mleko 3,2%');
  await page.getByRole('textbox', { name: 'Szukaj produktów', exact: true }).press('Enter');
  const search = page.getByRole('textbox', { name: 'Szukaj w całym katalogu', exact: true });
  await expect(search).toHaveValue('mleko 3,2%');
  await expect(page.getByRole('textbox', { name: 'Szukaj produktów', exact: true })).toHaveCount(0);
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${groupItem.name} (ml)` });
  await quantity.fill('750');
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.getByRole('radio', { name: 'Ciemny', exact: true }).click();
  await page.getByRole('button', { name: 'Zamknij menu przez tło' }).click();
  await expect(page.getByLabel('Menu SMARTCART', { exact: true })).toHaveCount(0);
  await expect(quantity).toHaveValue('750');
  await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toHaveCSS('color', 'rgb(237, 244, 239)');
  await page.screenshot({ path: info.outputPath('catalog-dark.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Ulubione', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Szukaj w Ulubionych' })).toBeVisible();
  await page.getByRole('tab', { name: 'Szukaj', exact: true }).click();
  await expect(quantity).toHaveValue('750');
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.getByRole('radio', { name: 'Jasny', exact: true }).click();
  await page.getByRole('button', { name: 'Zamknij menu przez tło' }).click();
  await expect(page.getByLabel('Menu SMARTCART', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toHaveCSS('color', 'rgb(21, 45, 67)');
  await page.getByRole('tab', { name: 'Start', exact: true }).click();
  await page.getByRole('link', { name: 'Produkty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Katalog kategorii', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Katalog kategorii', exact: true })).toHaveCSS('color', 'rgb(21, 45, 67)');
});

test('karta katalogu mieści długą nazwę i duży tekst, a dodawanie działa z klawiatury', async ({ page }, testInfo) => {
  const state = await setup(page);
  const name = 'Mleko UHT 3,2% bez laktozy w opakowaniu zwrotnym — szczegółowa nazwa grupy o zgodnych cechach';
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_search`, route => route.fulfill({ json: {
    version: 1, total: 1, limit: 30, offset: 0, items: [{ ...groupItem, name }],
  } }));
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/products?catalog=1&q=mleko');
  const heading = page.getByRole('heading', { name, exact: true });
  await expect(heading).toBeVisible();
  const card = heading.locator('..').locator('..');
  await card.evaluate(element => {
    const metrics = Array.from(element.querySelectorAll<HTMLElement>('[dir="auto"], input, textarea')).map(text => {
      const style = getComputedStyle(text);
      return { text, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
    });
    for (const { text, fontSize, lineHeight } of metrics) {
      if (text.textContent === '▦') continue;
      text.style.fontSize = `${fontSize * 2}px`;
      if (Number.isFinite(lineHeight)) text.style.lineHeight = `${lineHeight * 2}px`;
    }
  });
  expect(await card.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('*'))
    .every(child => child.scrollWidth <= child.clientWidth + 1))).toBe(true);
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${name} (ml)` });
  await quantity.focus();
  await page.keyboard.type('750');
  await page.keyboard.press('Tab');
  const add = page.getByRole('button', { name: `Dodaj do listy: ${name}`, exact: true });
  await expect(add).toBeFocused();
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Dodano 750 ml do listy: Zakupy testowe.')).toBeVisible();
  expect(state.saved[0]).toMatchObject({ p_group_id: groupItem.group_id, p_quantity: 750, p_unit: 'ml', p_selected_product_id: null });
  await page.screenshot({ path: testInfo.outputPath('catalog-large-text.png'), fullPage: true });
});

test('jednoelementowa grupa ładuje produkt raz, pozostawia wybór grupy i ukrywa datę Biedronki', async ({ page }) => {
  const state = await setup(page);
  const item = { ...groupItem, unit: 'szt', default_quantity: 1, product_count: 1, price_from: null };
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_search`, route => route.fulfill({ json: { version: 1, total: 1, limit: 30, offset: 0, items: [item] } }));
  let reads = 0;
  await page.route(`${AUTH_URL}/rest/v1/rpc/catalog_group`, route => {
    reads++;
    return route.fulfill({ json: { ...group, group: { ...group.group, ...item }, products: [{ ...group.products[0], package: { quantity: null, unit: null, label: null },
      offers: group.products[0].offers.map(offer => ({ ...offer, price_source: 'kodyzbiedry', unit_price_today: null })) }] } });
  });
  await page.goto('/products?catalog=1&q=mleko');
  await expect(page.getByRole('heading', { name: 'Marka A 1 l', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Pokaż produkty: ${item.name}` })).not.toBeVisible();
  await expect(page.getByText(/Nieznane opakowanie — porównanie cen niedostępne/)).toBeVisible();
  await expect(page.getByText('Data ceny nieznana.', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Cena widziana 21.11.2026')).not.toBeVisible();
  await page.getByRole('textbox', { name: `Potrzebna ilość: ${item.name} (szt)` }).fill('2');
  await page.getByRole('button', { name: `Dodaj do listy: ${item.name}`, exact: true }).click();
  await expect(page.getByText('Dodano 2 szt do listy: Zakupy testowe.')).toBeVisible();
  expect(state.saved[0]).toMatchObject({ p_group_id: item.group_id, p_selected_product_id: null });
  await page.getByRole('button', { name: 'Dodaj wybrany produkt: Marka A 1 l' }).click();
  await expect.poll(() => state.saved.length).toBe(2);
  expect(state.saved[1].p_selected_product_id).toBe(91);
  expect(reads).toBe(1);
});

test('drzewo, powrót, stronicowanie pełnych liczności i zachowanie wpisanej ilości', async ({ page }, testInfo) => {
  const state = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Unexpected text node')) errors.push(message.text()); });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/products?catalog=0');
  await page.getByRole('link', { name: 'Otwórz katalog kategorii →' }).click();
  await expect(page.getByRole('button', { name: 'Kategoria: Nabiał', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('catalog-categories.png'), fullPage: true });
  await page.getByRole('button', { name: 'Kategoria: Nabiał', exact: true }).click();
  await page.getByRole('button', { name: 'Podkategoria: Mleko', exact: true }).click();
  await expect(page.getByText('Kategorie → Nabiał → Mleko', { exact: true })).toBeVisible();
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${groupItem.name} (ml)` });
  await expect(quantity).toHaveValue('');
  await quantity.fill('750');
  await page.getByRole('button', { name: 'Następna strona katalogu' }).click();
  await expect(page.getByText('Wyników: 3 · 3–3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Następna strona katalogu' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Poprzednia strona katalogu' }).click();
  await expect(quantity).toHaveValue('750');
  await page.getByRole('button', { name: `Pokaż produkty: ${groupItem.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Marka A 1 l', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Marka B 500 ml', exact: true })).toBeVisible();
  await expect(page.getByText('2 produktów · 2 sieci · z ceną: 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Od 3,00 zł / 1 l', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Dodaj do listy: ${groupItem.name}`, exact: true }).click();
  await expect(page.getByText('Dodano 750 ml do listy: Zakupy testowe.')).toBeVisible();
  expect(state.saved[0]).toMatchObject({ p_group_id: 53, p_quantity: 750, p_unit: 'ml', p_selected_product_id: null });
  await page.screenshot({ path: testInfo.outputPath('catalog-milk.png'), fullPage: true });
  await page.getByRole('button', { name: 'Wróć do: Nabiał', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Podkategoria: Mleko' })).toBeVisible();
  await page.goBack();
  await expect(quantity).toHaveValue('750');
  expect(state.branchOffsets).toContain(2);
  expect(errors).toEqual([]);
});

test('pojedynczy produkt ma od razu ceny wielu sieci i dodaje konkretny produkt', async ({ page }) => {
  const state = await setup(page);
  await openMilk(page);
  await expect(page.getByRole('button', { name: `Pokaż produkty: ${singleItem.name}` })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: singleItem.name, exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Sieć A', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sieć B', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: `Potrzebna ilość: ${singleItem.name} (ml)` }).fill('500');
  await page.getByRole('button', { name: `Dodaj do listy: ${singleItem.name}`, exact: true }).click();
  await expect(page.getByText('Dodano 500 ml do listy: Zakupy testowe.')).toBeVisible();
  expect(state.saved[0]).toMatchObject({ p_group_id: 106, p_selected_product_id: 93 });
  await expect(page.getByText('Cena potwierdzona: 21.11.2026')).not.toBeVisible();
});

test('globalne wyszukiwanie przyjmuje frazę q, polskie znaki i procenty, niezależnie od gałęzi', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/products?catalog=1&category=spizarnia&subcategory=spizarnia-ryz&q=mleko%203%2C2%25');
  await expect(page.getByRole('textbox', { name: 'Szukaj w całym katalogu' })).toHaveValue('mleko 3,2%');
  await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toBeVisible();
  expect(state.queries).toContain('mleko 3,2%');
  expect(state.branchOffsets).toEqual([]);
  await page.getByRole('textbox', { name: 'Szukaj w całym katalogu' }).fill('brak');
  await expect(page.getByText('Brak wyników. Spróbuj innej frazy lub kategorii.')).toBeVisible();
});

test('niegotowe API i niezgodny kontrakt dają błąd zamiast przykładowego katalogu', async ({ page }) => {
  const state = await setup(page); state.missingApi = true;
  await page.goto('/products?catalog=1');
  await expect(page.getByText('Katalog kategorii nie jest jeszcze dostępny. Spróbuj ponownie później.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kategoria: Nabiał' })).not.toBeVisible();
  state.missingApi = false;
  await page.getByRole('button', { name: 'Ponów pobieranie kategorii' }).click();
  await page.getByRole('button', { name: 'Kategoria: Nabiał' }).click();
  state.malformed = true;
  await page.getByRole('button', { name: 'Podkategoria: Mleko' }).click();
  await expect(page.getByText('Otrzymano niepełne lub niezgodne dane katalogu. Spróbuj ponownie później.')).toBeVisible();
  await expect(page.getByText('Brak wyników. Spróbuj innej frazy lub kategorii.')).not.toBeVisible();
  state.malformed = false;
  await page.getByRole('button', { name: 'Ponów pobieranie wyników' }).click();
  await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toBeVisible();
});

test('błąd szczegółów i zapisu zachowuje ilość, ulubione zapisują group_id', async ({ page }) => {
  const state = await setup(page);
  await openMilk(page);
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${groupItem.name} (ml)` });
  await quantity.fill('250');
  state.groupError = true;
  await page.getByRole('button', { name: `Pokaż produkty: ${groupItem.name}` }).click();
  await page.getByRole('button', { name: 'Ponów pobieranie produktów i cen' }).waitFor();
  await expect(page.getByText('PRIVATE_SQL_DETAIL')).not.toBeVisible();
  state.groupError = false;
  await page.getByRole('button', { name: 'Ponów pobieranie produktów i cen' }).click();
  await expect(page.getByRole('heading', { name: 'Marka A 1 l', exact: true })).toBeVisible();
  state.saveError = true;
  await page.getByRole('button', { name: `Dodaj do listy: ${groupItem.name}`, exact: true }).click();
  await expect(page.getByText('Nie udało się pobrać lub zapisać danych. Spróbuj ponownie.')).toBeVisible();
  await expect(quantity).toHaveValue('250');
  state.saveError = false;
  await page.getByRole('button', { name: 'Dodaj wybrany produkt: Marka A 1 l' }).click();
  await expect(page.getByText('Dodano 250 ml do listy: Zakupy testowe.')).toBeVisible();
  expect(state.saved[0].p_selected_product_id).toBe(91);
  await page.getByRole('button', { name: `Zapisz grupę w ulubionych: ${groupItem.name}` }).click();
  await expect(page.getByRole('button', { name: `Usuń grupę z ulubionych: ${groupItem.name}` })).toBeVisible();
  expect(state.favorite).toBe(true);
});

test('spóźniona odpowiedź wyszukiwania nie zastępuje nowej frazy ani nowej sesji', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  state.holdSearch = new Promise<void>(resolve => { release = resolve; });
  const started = page.waitForRequest(request => request.url().endsWith('/rpc/catalog_search') && request.postDataJSON().p_query === 'stare');
  try {
    await page.goto('/products?catalog=1&q=stare');
    await started;
    await page.getByRole('textbox', { name: 'Szukaj w całym katalogu' }).fill('mleko');
    await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).toBeVisible();
    release();
    await expect(page.getByText('Spóźniony wynik', { exact: true })).not.toBeVisible();
    await changeSession(page, null);
    await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: groupItem.name, exact: true })).not.toBeVisible();
  } finally { release(); }
});

test('nowa sesja czyści szkice ilości bez resetowania wariantu katalogu', async ({ page }) => {
  await setup(page);
  await page.goto('/products?catalog=1&q=mleko');
  const quantity = page.getByRole('textbox', { name: `Potrzebna ilość: ${groupItem.name} (ml)` });
  await quantity.fill('777');
  await changeSession(page, null);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await changeSession(page, testSession('33333333-3333-4333-8333-333333333333'));
  await expect(page.getByRole('heading', { name: 'Katalog kategorii', exact: true })).toBeVisible();
  await expect(quantity).toHaveValue('');
});
