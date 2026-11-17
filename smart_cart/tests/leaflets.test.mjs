import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLeaflets, pageIndex, validLeafletId } from '../src/features/leaflets/model.ts';
import { fetchPage, fetchLeaflets } from '../src/features/leaflets/transport.ts';
const page = { url: 'https://assets.example.invalid/1.png', width: 100, height: 200, mimeType: 'image/png' };
const manifest = () => ({ version: 1, leaflets: [{ id: 'test-1', chain: { id: 'test', name: 'Sieć' }, title: 'Żółta gazetka', validFrom: '2026-11-01', validTo: '2026-11-20', format: 'images', cover: null, pages: [page, { ...page, url: 'https://assets.example.invalid/2.png' }] }] });
const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
const signal = () => new AbortController().signal;
const auth = () => ({ getSessionKey: () => 'one', getAccessToken: async () => ({ ok: true, data: 'fixture' }), subscribe: () => () => {} });
test('kontrakt zachowuje kolejność stron, daty i polskie znaki; waliduje identyfikatory', () => {
  const parsed = parseLeaflets(manifest());
  assert.equal(parsed.leaflets[0].title, 'Żółta gazetka'); assert.equal(parsed.leaflets[0].pages[1].url, 'https://assets.example.invalid/2.png');
  for (const id of ['../profile', 'id/other', '%2f', '', 'A']) assert.equal(validLeafletId(id), false);
  assert.equal(pageIndex('200', 2), 1); assert.equal(pageIndex('-1', 2), 0);
});
test('kontrakt odrzuca PDF, duplikaty, niewłaściwe daty i niezabezpieczone adresy', () => {
  for (const mutate of [v => v.leaflets.push(v.leaflets[0]), v => v.leaflets[0].format = 'pdf', v => v.leaflets[0].validFrom = '2026-02-30', v => v.leaflets[0].validTo = '2020-01-01', v => v.leaflets[0].pages = [{ ...page, url: 'http://example.invalid/file' }], v => v.leaflets[0].pages = []]) {
    const value = manifest(); mutate(value); assert.throws(() => parseLeaflets(value));
  }
});
test('obrazy sprawdzają MIME i sygnaturę, nie przekazują tokenów', async () => {
  const uri = await fetchPage(page, signal(), async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.deepEqual(options.headers, { Accept: 'image/png' });
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });
  assert.match(uri, /^data:image\/png;base64,/);
  await assert.rejects(fetchPage(page, signal(), async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })), /format/);
  await assert.rejects(fetchPage(page, signal(), async () => new Response('<html>', { headers: { 'Content-Type': 'image/png' } })), /prawidłowym/);
});
test('czytnik obsługuje brak pliku, wygasły URL, sieć, duży plik i timeout', async () => {
  for (const status of [404, 410, 401, 403, 500]) await assert.rejects(fetchPage(page, signal(), async () => new Response(null, { status })));
  await assert.rejects(fetchPage(page, signal(), async () => { throw new TypeError('network'); }), /połączenie/);
  await assert.rejects(fetchPage(page, signal(), async () => new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(9 * 1024 * 1024) } })), /duży/);
  await assert.rejects(fetchPage(page, signal(), () => new Promise(() => {}), 10), /czas oczekiwania/);
});
test('brak endpointu, obcy host lub brak sesji nie wysyła żądania', async () => {
  const request = () => { assert.fail('network request'); };
  await assert.rejects(fetchLeaflets(undefined, undefined, auth(), signal(), request), /nie są jeszcze dostępne/);
  await assert.rejects(fetchLeaflets(page.url, 'https://project.example.invalid', auth(), signal(), request), /konfiguracji/);
  await assert.rejects(fetchLeaflets('https://project.example.invalid/leaflets', 'https://project.example.invalid', { ...auth(), getSessionKey: () => null }, signal(), request), /Zaloguj/);
});
test('manifest wymaga JSON, pobiera tylko metadane i ponawia 401 raz', async () => {
  let calls = 0, refreshes = 0;
  const url = 'https://project.example.invalid/leaflets';
  const result = await fetchLeaflets(url, url, { ...auth(), refreshAfterUnauthorized: async () => { refreshes++; return { ok: true, data: 'fresh' }; } }, signal(), async (_, options) => {
    calls++; if (calls === 1) return new Response(null, { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer fresh'); return Response.json(manifest());
  });
  assert.equal(calls, 2); assert.equal(refreshes, 1); assert.equal(result.leaflets.length, 1);
  await assert.rejects(fetchLeaflets(url, url, auth(), signal(), async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })), /katalogu/);
});
test('zmiana sesji anuluje pobieranie manifestu', async () => {
  let key = 'one', listener, release; const pending = new Promise(resolve => { release = resolve; });
  const access = { ...auth(), getSessionKey: () => key, subscribe: fn => { listener = fn; return () => {}; } };
  const url = 'https://project.example.invalid/leaflets';
  const fetching = fetchLeaflets(url, url, access, signal(), () => pending);
  await new Promise(resolve => setImmediate(resolve)); key = 'two'; listener();
  release(Response.json(manifest())); await assert.rejects(fetching, /przerwane/);
});
