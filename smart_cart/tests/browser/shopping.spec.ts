import { expect, test } from '@playwright/test';
import { AUTH_URL, changeSession, mockMap, testSession } from './map-fixture';

const listId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const group = { id: 17, name: 'Mleko UHT 3,2% · z laktozą', unit: 'ml', default_quantity: 1000, offer_count: 1, lowest_price: 6 };

test('koszyk rozpoznaje daty cen w wycenie i propozycji, zachowując zgodność ze starszym API', async ({ page }) => {
  await mockMap(page);
  const item = { id: itemId, list_id: listId, group_id: group.id, quantity: 1000, unit: 'ml',
    selected_product_id: null, extra_store_ids: [], group, selected_product: null };
  const pick = { offer_id: 1, product_id: 91, name: 'Produkt testowy', package_count: 1, quantity: 1000, unit: 'ml',
    sale_mode: 'package', total_price: 6, regular_total: 6, promotion_applied: false, requires_activation: false,
    requires_card: false, condition: null, observed_at: '2026-11-22T10:00:00Z', valid_from: null, valid_to: null };
  const picks = [
    { ...pick, offer_id: 1, price_source: 'antonka', observed_at: '2026-11-20T23:00:00Z' },
    { ...pick, offer_id: 2, price_source: 'antonka_historia', observed_at: '2026-11-10T10:00:00Z' },
    { ...pick, offer_id: 3, price_source: 'tanszykoszyk', observed_at: '2026-11-20T10:00:00Z' },
    { ...pick, offer_id: 4, price_source: 'kodyzbiedry' },
    { ...pick, offer_id: 5 },
    { ...pick, offer_id: 6, price_source: 'antonka', observed_at: null },
    { ...pick, offer_id: 7, price_source: 'antonka_historia', observed_at: '2026-02-30' },
    { ...pick, offer_id: 8, price_source: 'unknown-source' },
  ];
  const quote = { status: 'priced', name: group.name, required_quantity: 1000, unit: 'ml', total_price: 48,
    purchased_quantity: 8000, surplus: 7000, picks };
  await page.route(`${AUTH_URL}/rest/v1/shopping_lists?**`, route => route.fulfill({ json: [
    { id: listId, name: 'Test dat koszyka', updated_at: '2026-11-22T10:00:00Z' },
  ] }));
  await page.route(`${AUTH_URL}/rest/v1/shopping_list_items?**`, route => route.fulfill({ json: [item] }));
  await page.route(`${AUTH_URL}/rest/v1/rpc/compare_basket`, route => route.fulfill({ json: { version: 2, stores: [
    { store_id: 1, store_name: 'Sieć testowa', complete: true, available_count: 1, requested_count: 1, total_price: 48,
      items: [{ ...quote, item_id: itemId, group_id: group.id, extra_selected: false,
        alternative: { ...quote, total_price: 40, purchased_quantity: 10000, surplus: 9000, picks: [
          { ...pick, offer_id: 9, quantity: 5000, package_count: 5, total_price: 20, regular_total: 30,
            price_source: 'antonka_historia', observed_at: '2026-11-09T10:00:00Z', promotion_applied: true },
          { ...pick, offer_id: 10, quantity: 5000, package_count: 5, total_price: 20, regular_total: 30,
            price_source: 'kodyzbiedry', promotion_applied: true },
        ] } }],
    },
  ] } }));
  await page.goto('/cart');
  await expect(page.getByText('48,00 zł · Najtańszy pełny koszyk', { exact: true })).toBeVisible();
  for (const date of ['21.11.2026', '10.11.2026', '20.11.2026', '09.11.2026']) {
    await expect(page.getByText(`Cena widziana ${date}`, { exact: true })).toHaveCount(1);
  }
  await expect(page.getByText('Data ceny nieznana.', { exact: true })).toHaveCount(6);
  await expect(page.getByText(/22\.11\.2026|30\.02\.2026/)).toHaveCount(0);
  await expect(page.getByText('Kup 10 000 ml za 40,00 zł.', { exact: true })).toBeVisible();
});

test('stary podgląd ofert rozpoznaje źródło daty i nie pokazuje dat pobrania', async ({ page }) => {
  await mockMap(page);
  await page.route(`${AUTH_URL}/rest/v1/rpc/search_product_groups`, route => route.fulfill({ json: [{ ...group, offer_count: 5 }] }));
  const offer = { product_id: 91, group_id: group.id, store_id: 1, store_name: 'Sieć testowa',
    product_name: 'Mleko testowe 1 l', gramatura_norm: '1 l', quantity_value: 1000, quantity_unit: 'ml', sale_mode: 'package',
    regular_price: 6, single_price: 6, price_status: 'prawdziwa', promo_price: null, verified_promotion: false };
  await page.route(`${AUTH_URL}/rest/v1/catalog_offers?**`, route => route.fulfill({ json: [
    { ...offer, offer_id: 1, price_source: 'antonka', regular_price_observed_at: '2026-11-21T10:00:00Z' },
    { ...offer, offer_id: 2, price_source: 'tanszykoszyk', regular_price_observed_at: '2026-11-20T10:00:00Z' },
    { ...offer, offer_id: 3, price_source: 'kodyzbiedry', regular_price_observed_at: '2026-11-22T10:00:00Z' },
    { ...offer, offer_id: 4, regular_price_observed_at: '2026-11-22T10:00:00Z' },
    { ...offer, offer_id: 5, price_source: 'antonka', regular_price_observed_at: null },
  ] }));
  await page.goto('/products?catalog=0');
  await page.getByRole('button', { name: `Rozwiń oferty: ${group.name}` }).click();
  await expect(page.getByText('Dane sieciowe · Cena widziana 21.11.2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Dane sieciowe · Cena widziana 20.11.2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Dane sieciowe · Data ceny nieznana.', { exact: true })).toHaveCount(3);
  await expect(page.getByText(/22\.11\.2026|Cena potwierdzona:/)).toHaveCount(0);
});

test('zmiana frazy od razu ukrywa stare wyniki i czeka na odpowiedź nowego wyszukiwania', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-20T12:00:00Z') });
  await mockMap(page);
  const queries: string[] = [];
  const nextGroup = { ...group, id: 18, name: 'Ryż biały', unit: 'g' };
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${AUTH_URL}/rest/v1/rpc/search_product_groups`, async route => {
    const phrase = route.request().postDataJSON().search_query;
    queries.push(phrase);
    if (phrase === 'ryż') await held;
    await route.fulfill({ json: phrase === 'ryż' ? [nextGroup] : [group] });
  });
  await page.goto('/products?catalog=0');
  const previousResult = page.getByRole('button', { name: `Rozwiń oferty: ${group.name}` });
  await expect(previousResult).toBeVisible();
  await page.clock.pauseAt(new Date('2026-11-20T12:05:00Z'));
  await page.getByRole('textbox', { name: 'Szukaj grupy produktów' }).fill('ryż');
  await expect(previousResult).not.toBeVisible();
  expect(queries).toEqual(['']);
  await page.clock.runFor(300);
  await expect.poll(() => queries).toEqual(['', 'ryż']);
  await expect(previousResult).not.toBeVisible();
  await expect(page.getByText('Nie znaleziono grup produktów. Spróbuj innej nazwy.')).not.toBeVisible();
  release();
  await expect(page.getByRole('button', { name: `Rozwiń oferty: ${nextGroup.name}` })).toBeVisible();
  await expect(previousResult).not.toBeVisible();
});

test('grupy, oferty, prywatne listy i edycja przeliczają koszyk, niepełna sieć nie ma sumy', async ({ page }) => {
  await mockMap(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let name = 'Zakupy'; let quantity = 0; let selected: number | null = null; let extras: number[] = []; let favorite = false;
  let created = false;
  await page.route(`${AUTH_URL}/rest/v1/**`, route => {
    const request = route.request(); const url = new URL(request.url());
    const endpoint = url.pathname.split('/').pop(); const body = request.postDataJSON();
    const item = () => ({ id: itemId, list_id: listId, group_id: group.id, quantity, unit: 'ml', selected_product_id: selected, extra_store_ids: extras,
      group, selected_product: selected ? { id: selected, canonical_name: 'Marka Test 1 l' } : null });
    if (endpoint === 'search_product_groups') return route.fulfill({ json: [group] });
    if (endpoint === 'catalog_offers') return route.fulfill({ json: [{ offer_id: 1, product_id: 91, group_id: group.id, store_id: 1, store_name: 'Sieć A',
      product_name: 'Marka Test 1 l', gramatura_norm: '1 l', quantity_value: 1000, quantity_unit: 'ml', sale_mode: 'package', regular_price: 6, single_price: 6,
      price_status: 'prawdziwa', regular_price_observed_at: '2026-11-01T12:00:00Z', promo_price: null, verified_promotion: false }] });
    if (endpoint === 'shopping_lists') {
      if (request.method() === 'POST') created = true;
      if (request.method() === 'PATCH') name = body.name;
      if (request.method() === 'DELETE') { created = false; quantity = 0; }
      return route.fulfill({ json: created ? [{ id: listId, name, updated_at: '2026-11-14T12:00:00Z' }] : [] });
    }
    if (endpoint === 'add_shopping_item') { quantity += body.p_quantity; selected = body.p_selected_product_id; return route.fulfill({ json: [item()] }); }
    if (endpoint === 'shopping_list_items') {
      if (request.method() === 'PATCH') { if ('quantity' in body) quantity = body.quantity; if ('selected_product_id' in body) selected = body.selected_product_id; if ('extra_store_ids' in body) extras = body.extra_store_ids; }
      if (request.method() === 'DELETE') quantity = 0;
      return route.fulfill({ json: quantity ? [item()] : [] });
    }
    if (endpoint === 'favorite_groups') { if (request.method() === 'POST') favorite = true; if (request.method() === 'DELETE') favorite = false; return route.fulfill({ json: favorite ? [{ group_id: group.id, group }] : [] }); }
    if (endpoint === 'compare_basket') {
      const requested = body.p_items[0];
      const quote = { status: 'priced', name: group.name, required_quantity: requested.quantity, unit: 'ml', total_price: 6 * Math.ceil(requested.quantity / 1000),
        purchased_quantity: 1000 * Math.ceil(requested.quantity / 1000), surplus: 0, picks: [], item_id: itemId, group_id: group.id, extra_selected: false, alternative: null };
      return route.fulfill({ json: { version: 2, stores: [
        { store_id: 1, store_name: 'Sieć A', complete: true, available_count: 1, requested_count: 1, total_price: quote.total_price, items: [quote] },
        { store_id: 2, store_name: 'Sieć B', complete: false, available_count: 0, requested_count: 1, total_price: null, items: [{ ...quote, status: 'missing', total_price: null }] },
      ] } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/products?catalog=0');
  await page.getByRole('textbox', { name: 'Szukaj grupy produktów' }).fill('mleko');
  await page.getByRole('button', { name: `Rozwiń oferty: ${group.name}` }).click();
  await expect(page.getByText('Marka Test 1 l', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj do ulubionych', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Usuń z ulubionych' })).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj do listy — najtańszy odpowiednik', exact: true }).click();
  await expect(page.getByText('Dodano do listy zakupów.')).toBeVisible();
  await page.goto('/cart');
  await expect(page.getByText('6,00 zł · Najtańszy pełny koszyk')).toBeVisible();
  await expect(page.getByText(/Brak pełnej wyceny — 0\/1/)).toBeVisible();
  await page.getByRole('textbox', { name: `Ilość dla ${group.name} (ml)` }).fill('2000');
  await page.getByRole('button', { name: 'Zapisz ilość', exact: true }).click();
  await expect(page.getByText('12,00 zł · Najtańszy pełny koszyk')).toBeVisible();
  await page.getByRole('button', { name: 'Zmień produkt', exact: true }).click();
  await page.getByRole('button', { name: 'Wybierz: Marka Test 1 l', exact: true }).click();
  await expect(page.getByText('Wybrany produkt: Marka Test 1 l')).toBeVisible();
  await page.getByRole('textbox', { name: 'Zmień nazwę listy' }).fill('Na tydzień');
  await page.getByRole('button', { name: 'Zapisz nazwę', exact: true }).click();
  await expect.poll(() => name).toBe('Na tydzień');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Zmień nazwę listy' })).toHaveValue('Na tydzień');
  await expect(page.getByText('12,00 zł · Najtańszy pełny koszyk')).toBeVisible();
  await changeSession(page, null);
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await expect(page.getByText('Wybrany produkt: Marka Test 1 l')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('logowanie wraca do celu, jawne wylogowanie czyści cel', async ({ page }) => {
  await mockMap(page, null);
  await page.route(`${AUTH_URL}/auth/v1/token?grant_type=password`, route => route.fulfill({ json: testSession() }));
  await page.goto('/rules');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('map-test@example.invalid');
  await page.getByLabel('Hasło', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByText('Zasady porównywania', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/rules$/);
  await page.getByRole('button', { name: 'Otwórz menu' }).click();
  await page.getByRole('button', { name: 'Profil', exact: true }).click();
  await page.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('anulowane logowanie nie otwiera aplikacji po spóźnionej odpowiedzi', async ({ page }) => {
  await mockMap(page, null);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${AUTH_URL}/auth/v1/token?grant_type=password`, async route => { await held; await route.fulfill({ json: testSession() }); });
  await page.goto('/products?catalog=0');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('map-test@example.invalid');
  await page.getByLabel('Hasło', { exact: true }).fill('test-password');
  const request = page.waitForRequest(`${AUTH_URL}/auth/v1/token?grant_type=password`);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click(); await request;
  await page.getByRole('button', { name: 'Anuluj operację', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'SMARTCART — ekran startowy' })).not.toBeVisible();
});
