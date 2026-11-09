import { expect, test } from '@playwright/test';
import { AUTH_STORAGE_KEY, AUTH_URL, catalog, changeSession, mockMap, stores, testSession, waitForStores } from './map-fixture';

test('bez sesji katalog nie jest pobierany', async ({ page }) => {
  await mockMap(page, null);
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/v1/stores')) requests++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/[Zz]aloguj się/)).toBeVisible();
  await expect(page.getByTestId('stores-map')).toHaveCount(0);
  expect(requests).toBe(0);
});

test('odświeżenie tokenu tej samej sesji zachowuje mapę i katalog', async ({ page }) => {
  await mockMap(page);
  let requests = 0;
  let verifications = 0;
  await page.route(`${AUTH_URL}/auth/v1/user`, route => {
    verifications++;
    return route.fulfill({ json: testSession().user });
  });
  page.on('request', request => { if (request.url().endsWith('/v1/stores')) requests++; });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  const before = verifications;
  await changeSession(page, testSession(undefined, 2), 'TOKEN_REFRESHED');
  await expect.poll(() => verifications).toBeGreaterThan(before);
  await waitForStores(page, 4);
  expect(requests).toBe(1);
});

test('wylogowanie w innej karcie usuwa widoczną mapę', async ({ page }) => {
  await mockMap(page);
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  await changeSession(page, null);
  await expect(page.getByTestId('stores-map')).toHaveCount(0);
  await expect(page.getByText(/[Zz]aloguj się/)).toBeVisible();
});

test('nowa sesja tej samej osoby anuluje stary katalog i ignoruje jego odpowiedź', async ({ page }) => {
  await mockMap(page);
  let releaseOld!: () => void;
  const held = new Promise<void>(resolve => { releaseOld = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  let finished!: () => void;
  const firstFinished = new Promise<void>(resolve => { finished = resolve; });
  const firstToken = testSession().access_token;
  let requests = 0;
  await page.route('**/v1/stores', async route => {
    requests++;
    if (route.request().headers().authorization !== `Bearer ${firstToken}`) {
      return route.fulfill({ json: catalog(stores.slice(1, 3)) });
    }
    started();
    await held;
    try { await route.fulfill({ json: catalog(stores.slice(0, 1)) }); }
    catch (error) { if (!route.request().failure()) throw error; }
    finally { finished(); }
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await firstStarted;
  const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/v1/stores'));
  await changeSession(page, testSession('33333333-3333-4333-8333-333333333333'));
  await aborted;
  await waitForStores(page, 2);
  releaseOld();
  await firstFinished;
  await waitForStores(page, 2);
  expect(requests).toBe(2);
});

test('401 odświeża token i ponawia pobranie jeden raz', async ({ page }) => {
  await mockMap(page);
  const refreshed = testSession(undefined, 2);
  let refreshes = 0;
  const tokens: string[] = [];
  await page.route(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, route => {
    refreshes++;
    return route.fulfill({ json: refreshed });
  });
  await page.route('**/v1/stores', route => {
    tokens.push(route.request().headers().authorization);
    return tokens.length === 1 ? route.fulfill({ status: 401, json: {} }) : route.fulfill({ json: catalog() });
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await waitForStores(page, 4);
  expect(refreshes).toBe(1);
  expect(tokens).toEqual([`Bearer ${testSession().access_token}`, `Bearer ${refreshed.access_token}`]);
});

test('drugie 401 kończy bieżącą sesję bez pętli ponowień', async ({ page }) => {
  await mockMap(page);
  let refreshes = 0;
  let requests = 0;
  await page.route(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, route => {
    refreshes++;
    return route.fulfill({ json: testSession(undefined, 2) });
  });
  await page.route('**/v1/stores', route => {
    requests++;
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/stores', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/[Zz]aloguj się/)).toBeVisible();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  await expect(page.getByTestId('stores-map')).toHaveCount(0);
  expect(refreshes).toBe(1);
  expect(requests).toBe(2);
});
