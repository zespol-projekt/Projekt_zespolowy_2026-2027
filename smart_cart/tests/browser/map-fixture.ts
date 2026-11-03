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
export async function localLibrary(filename: string) {
  return { body: await readFile(path.join(process.cwd(), 'node_modules/maplibre-gl/dist', filename)),
    contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } };
}
export async function mockMap(page: Page) {
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
