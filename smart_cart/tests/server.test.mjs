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
test('API tylko do odczytu: JSON, gzip, CORS, ETag i zmiana danych', async t => {
  let source = { key: '1', input: sample() };
  const server = createStoreServer(() => source);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(base + '/v1/stores');
  assert.equal(first.status, 200); assert.equal(first.headers.get('access-control-allow-origin'), '*');
  assert.equal(first.headers.get('content-encoding'), 'gzip');
  assert.equal((await first.json()).count, 1);
  const etag = first.headers.get('etag');
  assert.equal((await fetch(base + '/v1/stores', { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await fetch(base + '/v1/stores', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/v1/stores', { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(base + '/v1/stores', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/gotowe/sklepy.json')).status, 404);
  source = { key: '2', input: sample() }; source.input.stores[0].name = 'Lidl nowy';
  const updated = await fetch(base + '/v1/stores');
  assert.notEqual(updated.headers.get('etag'), etag);
  assert.equal((await updated.json()).stores[0].name, 'Lidl nowy');
  assert.equal((await (await fetch(base + '/health')).json()).count, 1);
});
