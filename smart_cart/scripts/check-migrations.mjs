import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { metadataSql } from './catalog-metadata.mjs';
import { pozycjeZObserwacji, sqlImportu } from './import/import-katalogu.mjs';
import { obserwacjaKodyzbiedry, obserwacjaTanszykoszyk } from './import/zrodla.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.SMARTCART_TEST_DB_CONTAINER ?? 'smartcart-pg17-check';
// Only an explicitly named throwaway container is accepted. Never a remote URL.
if (!/^smartcart-(pg17|migration)-check$/.test(container)) throw new Error('Use an isolated SMARTCART test container.');
function sql(input) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', container.includes('pg17') ? 'supabase_admin' : 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Migration check failed');
  if (result.stdout.trim()) process.stdout.write(result.stdout);
}
const baseline = fs.readFileSync(path.join(root, 'tests/fixtures/legacy-schema.sql'), 'utf8');
const tables = baseline.match(/CREATE TABLE IF NOT EXISTS "public"\."[^"]+" \([\s\S]*?\n\);/g) ?? [];
const sequences = baseline.match(/CREATE SEQUENCE IF NOT EXISTS "public"\."[^"]+"[\s\S]*?;/g) ?? [];
const alterations = baseline.match(/ALTER TABLE ONLY "public"\."[^"]+"[\s\S]*?;/g) ?? [];
const functions = [...baseline.matchAll(/CREATE OR REPLACE FUNCTION "public"\."(fn_log_price_change|fn_set_updated_at|norm_text)"[\s\S]*?\$\$;/g)].map(m => m[0]);
const view = baseline.match(/CREATE OR REPLACE VIEW "public"\."v_store_offers_full"[\s\S]*?;/)?.[0] ?? '';
const triggers = baseline.match(/CREATE OR REPLACE TRIGGER "[^"]+"[\s\S]*?;/g) ?? [];
sql(`
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
SET check_function_bodies=false;
${tables.join('\n')}
${sequences.join('\n')}
${alterations.join('\n')}
${functions.join('\n')}
${view}
${triggers.join('\n')}
`);
if (process.env.SMARTCART_CHECK_INVENTORY) {
  const inventory = JSON.parse(fs.readFileSync(path.resolve(process.env.SMARTCART_CHECK_INVENTORY), 'utf8').replace(/^\uFEFF/, '')).rows[0].inventory;
  const groups = JSON.stringify(inventory.groups).replaceAll("'", "''");
  const products = JSON.stringify(inventory.products).replaceAll("'", "''");
  sql(`
    INSERT INTO public.categories(id,name) SELECT DISTINCT category_id,'Category '||category_id FROM jsonb_to_recordset('${groups}'::jsonb) AS x(category_id integer);
    INSERT INTO public.base_products(id,category_id,name) SELECT id,category_id,name FROM jsonb_to_recordset('${groups}'::jsonb) AS x(id integer,category_id integer,name text);
    INSERT INTO public.products(id,product_key,base_product_id,canonical_name,quantity_value,quantity_unit)
      SELECT id,'inventory:'||id,base_product_id,name,quantity,unit FROM jsonb_to_recordset('${products}'::jsonb)
      AS x(id integer,base_product_id integer,name text,quantity numeric,unit text);
  `);
}
for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  sql(`BEGIN;\n${fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')}\nCOMMIT;`);
  console.log(`Applied to isolated container: ${file}`);
}
if (process.env.SMARTCART_CHECK_INVENTORY) sql('SELECT classification_source,sale_mode,count(*) FROM public.products GROUP BY 1,2 ORDER BY 1,2; SELECT count(*) AS comparison_groups FROM public.comparison_groups;');
// tests/database.sql first, then further scenario files (tests/database-*.sql) in name order.
for (const file of ['database.sql', ...fs.readdirSync(path.join(root, 'tests')).filter(f => /^database-.+\.sql$/.test(f)).sort()]) {
  sql(fs.readFileSync(path.join(root, 'tests', file), 'utf8'));
}
const reviewed = metadataSql({ groups: [{ key: "test'$$", base_product_id: 91500, name: "Test's $$ reviewed", unit: 'g', products: [{ id: 91500, sale_mode: 'package' }] }] })
  .replace(/^BEGIN;\n/, '').replace(/\nCOMMIT;\n$/, '\n');
sql(`BEGIN;
 INSERT INTO public.categories(id,name) VALUES(91500,'Metadata test');
 INSERT INTO public.base_products(id,category_id,name) VALUES(91500,91500,'Metadata test');
 INSERT INTO public.products(id,product_key,base_product_id,canonical_name,quantity_value,quantity_unit)
 VALUES(91500,'metadata:test',91500,'Metadata product 500g',500,'g');
 ${reviewed}
 DO $verify$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM public.products p JOIN public.comparison_groups g ON g.id=p.comparison_group_id
     WHERE p.id=91500 AND p.classification_source='reviewed' AND g.name='Test''s $$ reviewed') THEN
     RAISE EXCEPTION 'Generated metadata transaction failed'; END IF;
 END $verify$;
 ROLLBACK;`);
// Import katalogu: wygenerowany SQL wykonany dwa razy na "starych" produktach (dopasowanie, zastąpienie, nietknięte rekordy).
sql(`
INSERT INTO public.stores(slug, name) VALUES ('biedronka', 'Biedronka'), ('lidl', 'Lidl') ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.base_products(id, category_id, name) SELECT 93001, id, 'Mleko UHT 3,2%' FROM public.categories WHERE slug = 'nabial';
INSERT INTO public.products(id, product_key, base_product_id, ean, canonical_name, quantity_value, quantity_unit) VALUES
  (93101, 'ean:5900000000017', 93001, '5900000000017', 'Stara nazwa mleka 1 l', 1000, 'ml'),
  (93102, 'name:stary', 93001, NULL, 'Mleko UHT 3,2% Pilos 1l', 1000, 'ml'),
  (93103, 'name:nietkniety', 93001, NULL, 'Mleko stare inne 1l', 1000, 'ml');
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source)
SELECT 'old:1', id, 93101, 'Stara nazwa mleka 1 l', 9.99, 'prawdziwa', 'kodyzbiedry' FROM public.stores WHERE slug = 'biedronka' UNION ALL
SELECT 'old:2', id, 93102, 'Mleko UHT 3,2% Pilos 1l', 1.99, 'prawdziwa', 'tanszykoszyk' FROM public.stores WHERE slug = 'lidl' UNION ALL
SELECT 'old:3', id, 93103, 'Mleko stare inne 1l', 2.49, 'prawdziwa', 'antonka' FROM public.stores WHERE slug = 'lidl';
`);
const { pozycje } = pozycjeZObserwacji([
  obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: 'Mleko UHT 3,2% Łaciate 1 l', cena: '3.79', cena_widziana: '2026-11-18T18:00:00Z' }),
  obserwacjaTanszykoszyk({ id_zrodla: 'a', nazwa: 'Mleko UHT 3,2% Pilos 1l', gramatura: '1l', cena_promocyjna: '2.25', typ_promocji: 'obniżka',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/a', ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
  obserwacjaTanszykoszyk({ id_zrodla: 'b', nazwa: "Mleko UHT 3,2% Mlekovita 1 l", gramatura: '1 l', cena_promocyjna: '2.99', typ_promocji: 'przy zakupie 3',
    warunek: "cena za 1 szt. poza promocją: 3,49 zł", wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/b',
    ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
]);
const importSql = sqlImportu(pozycje, { tryb: 'zapis', pliki: [{ sciezka: 'test.csv', sha256: '0'.repeat(64), wiersze: 3 }] });
for (const przebieg of [1, 2]) {
  sql(importSql);
  sql(`DO $verify$ DECLARE lidl integer := (SELECT id FROM public.stores WHERE slug = 'lidl'); BEGIN
    IF (SELECT canonical_name FROM public.products WHERE id = 93101) <> 'Mleko UHT 3,2% Łaciate 1 l' THEN RAISE EXCEPTION 'Produkt po EAN nie zastąpiony'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:1' AND regular_price = 3.79 AND price_source = 'kodyzbiedry'
      AND (regular_price_observed_at AT TIME ZONE 'Europe/Warsaw')::date = '2026-11-18') THEN RAISE EXCEPTION 'Oferta po EAN nie zastąpiona'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:2' AND regular_price IS NULL AND price_status = 'brak'
      AND promo_price = 2.25 AND promo_scope = 'nationwide' AND promo_rule = '{"kind":"unit"}' AND valid_to = '2026-11-21'
      AND promo_evidence_url = 'https://tanszykoszyk.pl/produkt/a') THEN RAISE EXCEPTION 'Oferta po nazwie nie zastąpiona'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:3' AND regular_price = 2.49 AND price_source = 'antonka' AND last_import_run_id IS NULL)
      THEN RAISE EXCEPTION 'Niedopasowana stara oferta została zmieniona'; END IF;
    IF (SELECT count(*) FROM public.products WHERE canonical_name = 'Mleko UHT 3,2% Mlekovita 1 l') <> 1 THEN RAISE EXCEPTION 'Nowy produkt zdublowany'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.catalog_offers WHERE product_name = 'Mleko UHT 3,2% Mlekovita 1 l' AND store_id = lidl
      AND regular_price = 3.49 AND promo_rule = '{"kind":"min_quantity","min_quantity":3}' AND group_name = 'Mleko UHT 3,2% · z laktozą')
      THEN RAISE EXCEPTION 'Nowy produkt bez oferty lub grupy mleka'; END IF;
    IF (SELECT count(*) FROM public.store_offers) <> 4 THEN RAISE EXCEPTION 'Oczekiwano 4 ofert, jest %', (SELECT count(*) FROM public.store_offers); END IF;
    IF (SELECT count(*) FROM public.import_runs) <> ${przebieg} THEN RAISE EXCEPTION 'Brak wpisu w rejestrze importów'; END IF;
  END $verify$;`);
}
const proba = sqlImportu(pozycje, { tryb: 'proba' });
sql(proba);
sql(`DO $verify$ BEGIN IF (SELECT count(*) FROM public.import_runs) <> 2 THEN RAISE EXCEPTION 'Tryb próbny zapisał dane'; END IF; END $verify$;`);
console.log('Catalog import: EAN/name matching, replacement, untouched old offers, idempotent rerun and dry-run rollback passed.');
console.log('Database migration and RLS scenarios passed.');
