import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, resolveDataFile } from '../scripts/store-catalog.mjs';

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
