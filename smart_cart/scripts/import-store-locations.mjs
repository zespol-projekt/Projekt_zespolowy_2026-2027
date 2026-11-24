import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog, resolveDataFile } from './store-catalog.mjs';

const input = JSON.parse(readFileSync(resolveDataFile(), 'utf8'));
const { stores } = buildCatalog(input);
assert.ok(stores.length > 0, 'Katalog placówek jest pusty.');

const quote = (value) => value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
const rows = stores.map((store, index) => {
  const postalCode = input.stores[index].address.postal_code ?? null;
  assert.ok(postalCode === null || /^[0-9]{2}-[0-9]{3}$/u.test(postalCode), store.id);
  const fields = [store.id, store.chain, store.name, store.address, store.city, postalCode].map(quote);
  return `  (${[...fields, store.latitude, store.longitude].join(', ')})`;
});

process.stdout.write(`WITH incoming (id, chain_slug, name, address, city, postal_code, latitude, longitude) AS (
  VALUES
${rows.join(',\n')}
), changed AS (
  INSERT INTO public.store_locations AS current_location
    (id, chain_slug, name, address, city, postal_code, latitude, longitude)
  SELECT * FROM incoming ORDER BY id
  ON CONFLICT (id) DO UPDATE SET
    (name, address, city, postal_code, latitude, longitude) =
    (EXCLUDED.name, EXCLUDED.address, EXCLUDED.city, EXCLUDED.postal_code,
     EXCLUDED.latitude, EXCLUDED.longitude)
  WHERE (current_location.name, current_location.address, current_location.city,
         current_location.postal_code, current_location.latitude, current_location.longitude)
    IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.address, EXCLUDED.city,
                      EXCLUDED.postal_code, EXCLUDED.latitude, EXCLUDED.longitude)
  RETURNING chain_slug
)
SELECT incoming.chain_slug, count(*) AS source_count,
       (SELECT count(*) FROM changed WHERE changed.chain_slug = incoming.chain_slug) AS changed_count
FROM incoming GROUP BY incoming.chain_slug ORDER BY incoming.chain_slug;
`);
