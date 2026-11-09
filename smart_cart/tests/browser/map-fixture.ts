import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { expect, type Page } from '@playwright/test';
import { MAPLIBRE_ASSETS } from '../../src/features/stores/map/document';

export const stores = [
  { id: 'lidl:test', chain: 'lidl', name: 'Lidl', address: 'Łódź, Żółta 1', latitude: 51.75, longitude: 19.45 },
  { id: 'biedronka:test', chain: 'biedronka', name: 'Biedronka', address: 'Warszawa, Testowa 2', latitude: 52.23, longitude: 21.01 },
  { id: 'auchan:test', chain: 'auchan', name: 'Auchan', address: 'Gdańsk, Testowa 3', latitude: 54.35, longitude: 18.65 },
  { id: 'dino:test', chain: 'dino', name: 'Dino', address: 'Poznań, Długa 4', latitude: 52.4, longitude: 16.92 },
];
export const catalog = (points = stores) => ({ version: 1, updatedAt: '2026-11-02T12:00:00Z', count: points.length, stores: points });
export const embedded = (page: Page) => page.frameLocator('[data-testid="stores-map"]');
export const waitForStores = async (page: Page, count: number) => {
  await expect(embedded(page).locator('#map')).toHaveAttribute('data-store-count', String(count));
};

// These credentials exist only in Playwright's mocked HTTP/storage environment.
export const AUTH_URL = 'https://smartcart-test.supabase.invalid';
export const AUTH_STORAGE_KEY = `smartcart-${AUTH_URL.replace(/[^a-z0-9]/gi, '-')}-auth`;
export function testSession(sessionId = '11111111-1111-4111-8111-111111111111', tokenVersion = 1) {
  const user = {
    id: '22222222-2222-4222-8222-222222222222', email: 'map-test@example.invalid',
    aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, is_anonymous: false,
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const access_token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: `${AUTH_URL}/auth/v1`, sub: user.id, aud: 'authenticated', role: 'authenticated',
    exp: 4102444800, iat: 1760000000 + tokenVersion, session_id: sessionId,
  })}.${Buffer.from('mock-signature').toString('base64url')}`;
  return { access_token, refresh_token: `mock-refresh-${sessionId}-${tokenVersion}`, token_type: 'bearer',
    expires_in: 3600, expires_at: 4102444800, user };
}
export type TestSession = ReturnType<typeof testSession>;

/** Simulate another browser tab via the SDK's actual storage and BroadcastChannel protocol. */
export async function changeSession(page: Page, session: TestSession | null, event = session ? 'SIGNED_IN' : 'SIGNED_OUT') {
  await page.evaluate(({ key, session, event }) => {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event, session });
    channel.close();
  }, { key: AUTH_STORAGE_KEY, session, event });
}

async function mockAuth(page: Page, session: TestSession | null) {
  await page.addInitScript(({ key, session }) => {
    if (window !== window.top || location.hostname !== 'localhost') return;
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  }, { key: AUTH_STORAGE_KEY, session });
  // Block every auth URL as well as mocking the intended host: no real account requests.
  await page.route('**/auth/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== AUTH_URL) return route.abort();
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: testSession().user });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    return route.fulfill({ status: 400, json: { code: 'unexpected_test_request' } });
  });
}
export async function localLibrary(filename: string) {
  return { body: await readFile(path.join(process.cwd(), 'node_modules/maplibre-gl/dist', filename)),
    contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } };
}
export async function mockMap(page: Page, session: TestSession | null = testSession()) {
  await mockAuth(page, session);
  // Use real MapLibre/worker code, without downloading public tiles or fonts.
  await page.route(`${MAPLIBRE_ASSETS}**`, async route => {
    const filename = new URL(route.request().url()).pathname.split('/').pop()!;
    if (!['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'].includes(filename)) return route.abort();
    await route.fulfill(await localLibrary(filename));
  });
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: {
    version: 8, glyphs: 'https://fonts.example.invalid/{fontstack}/{range}.pbf', sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#F7F7F2' } }],
  }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  const stack = Buffer.concat([Buffer.from([10, 14]), Buffer.from('Noto Sans Bold'), Buffer.from([18, 5]), Buffer.from('0-255')]);
  await page.route('https://fonts.example.invalid/**', route => route.fulfill({ body: Buffer.concat([Buffer.from([10, stack.length]), stack]),
    contentType: 'application/x-protobuf', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route('**/v1/stores', route => route.fulfill({ json: catalog() }));
}
