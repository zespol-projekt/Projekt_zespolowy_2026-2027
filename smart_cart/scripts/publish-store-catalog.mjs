import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildCatalog, resolveDataFile } from './store-catalog.mjs';

const [queryResult, outputDirectory] = process.argv.slice(2);
assert.ok(queryResult && outputDirectory, 'Podaj plik odpowiedzi SQL i katalog wyjściowy.');
const expected = buildCatalog(JSON.parse(readFileSync(resolveDataFile(), 'utf8')));
const { rows } = JSON.parse(readFileSync(queryResult, 'utf8').replace(/^\uFEFF/u, ''));
const stores = rows[0]?.stores;
assert.ok(Array.isArray(stores));
assert.equal(stores.length, expected.count);

const expectedById = new Map(expected.stores.map((store) => [store.id, store]));
const verified = stores.map((store) => {
  const match = expectedById.get(store.id);
  assert.ok(match, `Nieznana lub powtórzona placówka: ${store.id}`);
  const { latitude, longitude, ...details } = store;
  assert.deepEqual({ ...details, latitude: match.latitude, longitude: match.longitude }, match);
  assert.ok(Math.abs(latitude - match.latitude) < 1e-9, store.id);
  assert.ok(Math.abs(longitude - match.longitude) < 1e-9, store.id);
  expectedById.delete(store.id);
  return { ...match, latitude, longitude };
});
assert.equal(expectedById.size, 0);

const body = JSON.stringify({ ...expected, stores: verified });
const version = createHash('sha256').update(body).digest('hex');
writeFileSync(join(outputDirectory, `${version}.json.gz`), gzipSync(body));
writeFileSync(join(outputDirectory, 'activate-store-catalog.sql'), `INSERT INTO public.store_catalog_publication (version)
VALUES ('${version}')
ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version;
`);
console.log(version);
