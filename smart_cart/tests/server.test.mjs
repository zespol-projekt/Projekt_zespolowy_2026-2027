import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, createStoreServer, resolveDataFile } from '../server/serwer-mapy.mjs';

const appRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('domyślne dane są w repozytorium, obok katalogu aplikacji',()=>{
  assert.equal(resolveDataFile({}),path.resolve(appRoot,'../dane-sklepow/gotowe/sklepy.json'));
  assert.ok(resolveDataFile({}).startsWith(path.resolve(appRoot,'..')+path.sep));
  assert.ok(!resolveDataFile({}).startsWith(appRoot+path.sep));
});
test('własny katalog danych: ścieżka bezwzględna lub względna wobec aplikacji',()=>{
  const dataRoot=path.resolve(appRoot,'../../inne-dane');
  assert.equal(resolveDataFile({SMARTCART_DATA_DIR:dataRoot}),path.join(dataRoot,'gotowe','sklepy.json'));
  assert.equal(resolveDataFile({SMARTCART_DATA_DIR:'../../inne-dane'}),path.join(dataRoot,'gotowe','sklepy.json'));
});

function sample() { return { schema_version: 1, generated_at: '2026-11-02T12:00:00Z', count: 1, stores: [{
  id: 'lidl:1', chain: 'lidl', name: 'Lidl', quality: { status: 'ready', issues: [] },
  address: { country: 'PL', city: 'Łódź', formatted: 'Łódź, Testowa 1' }, location: { latitude: 51.75, longitude: 19.45 },
}] }; }
test('publikacja pomija pola źródłowe i odrzuca rekordy wymagające weryfikacji', () => {
  assert.equal(buildCatalog(sample()).stores[0].quality, undefined);
  for (const mutate of [
    s => { s.quality.status = 'review'; }, s => { s.quality.issues.push('missing_coordinates'); },
    s => { s.source_review = { status: 'requires_review' }; }, s => { s.location.latitude = null; },
  ]) { const input = sample(); mutate(input.stores[0]); assert.throws(() => buildCatalog(input)); }
});
test('chronione API tylko do odczytu: JSON, gzip, CORS, ETag i zmiana danych', async t => {
  let source = { key: '1', input: sample() };
  const headers = { Authorization: 'Bearer test-session' };
  const server = createStoreServer(() => source, async header => ({ ok: header === headers.Authorization, status: 401 }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(base + '/v1/stores', { headers });
  assert.equal(first.status, 200); assert.equal(first.headers.get('access-control-allow-origin'), '*');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('content-encoding'), 'gzip');
  assert.equal((await first.json()).count, 1);
  const etag = first.headers.get('etag');
  const unchanged = await fetch(base + '/v1/stores', { headers: { ...headers, 'If-None-Match': etag } });
  assert.equal(unchanged.status, 304); assert.equal(unchanged.headers.get('cache-control'), 'no-store');
  const head = await fetch(base + '/v1/stores', { method: 'HEAD', headers });
  assert.equal(head.status, 200); assert.equal(head.headers.get('etag'), etag); assert.equal(await head.text(), '');
  const preflight = await fetch(base + '/v1/stores', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(preflight.status, 204); assert.equal(await preflight.text(), '');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal((await fetch(base + '/v1/stores', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/gotowe/sklepy.json')).status, 404);
  source = { key: '2', input: sample() }; source.input.stores[0].name = 'Lidl nowy';
  const updated = await fetch(base + '/v1/stores', { headers });
  assert.notEqual(updated.headers.get('etag'), etag);
  assert.equal((await updated.json()).stores[0].name, 'Lidl nowy');
  assert.equal((await (await fetch(base + '/health')).json()).count, 1);
});

test('brak sesji, odmowa i awaria auth nie ujawniają katalogu, HEAD ani ETag', async t => {
  let loads = 0;
  let checks = 0;
  const server = createStoreServer(() => { loads++; return { key: '1', input: sample() }; }, async header => {
    checks++;
    if (header === 'Bearer broken') throw new Error('internal details');
    if (header === 'Bearer allowed') return { ok: true };
    return { ok: false, status: header === 'Bearer forbidden' ? 403 : 401 };
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const allowed = await fetch(base + '/v1/stores', { headers: { Authorization: 'Bearer allowed' } });
  const etag = allowed.headers.get('etag'); await allowed.arrayBuffer();
  const initialLoads = loads;
  for (const method of ['GET', 'HEAD']) for (const [authorization, status] of [[undefined, 401], ['Bearer fake', 401], ['Bearer forbidden', 403], ['Bearer broken', 503]]) {
    const headers = { 'If-None-Match': etag, ...(authorization ? { Authorization: authorization } : {}) };
    const response = await fetch(base + '/v1/stores', { method, headers });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('www-authenticate'), status === 401 ? 'Bearer' : null);
    const body = await response.text();
    assert.ok(!body.includes('stores') && !body.includes('Lidl') && !body.includes('internal details'));
    if (method === 'HEAD') assert.equal(body, '');
  }
  assert.equal(loads, initialLoads, 'odmowa następuje przed odczytem danych');
  const initialChecks = checks;
  assert.equal((await fetch(base + '/v1/stores', { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal(checks, initialChecks, 'health i OPTIONS nie wymagają Supabase');
});

test('serwer nie może zostać uruchomiony bez weryfikatora sesji', () => {
  assert.throws(() => createStoreServer(() => ({ key: '1', input: sample() })), /weryfikatora sesji/);
});
