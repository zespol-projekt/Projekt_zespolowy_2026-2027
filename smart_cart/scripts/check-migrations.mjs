import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { metadataSql } from './catalog-metadata.mjs';
import { pozycjeZObserwacji, sqlImportu } from './import/import-katalogu.mjs';
import { obserwacjaKodyzbiedry, obserwacjaTanszykoszyk } from './import/zrodla.mjs';
import { rdzenNazwy, WZORZEC_ILOSCI_W_NAZWIE } from './import/normalizacja.mjs';
import { czytajTekst, decyzja, parsujCsv, sqlPrzegladu } from './mleko/przeglad-mleka.mjs';

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
// Wynik zapytania (stdout) - np. CSV z \copy ... TO STDOUT.
function sqlOut(input) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', container.includes('pg17') ? 'supabase_admin' : 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Query failed');
  return result.stdout;
}
// Skrypt, który ma się nie udać (z komunikatem pasującym do wzorca).
function sqlFails(input, pattern) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', container.includes('pg17') ? 'supabase_admin' : 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
    input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0 || !pattern.test(result.stderr)) throw new Error(`Expected failure ${pattern}, got: ${result.stderr || 'success'}`);
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
  (93103, 'name:nietkniety', 93001, NULL, 'Mleko stare inne 1l', 1000, 'ml'),
  (93104, 'name:rdzen', 93001, NULL, 'Mleko UHT 3,2% Wiejskie 1 l', 1000, 'ml'),
  (93105, 'name:zmienne', 93001, NULL, 'Mleko UHT 3,2% Zmienne 1 l', 500, 'ml');
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source)
SELECT 'old:1', id, 93101, 'Stara nazwa mleka 1 l', 9.99, 'prawdziwa', 'kodyzbiedry' FROM public.stores WHERE slug = 'biedronka' UNION ALL
SELECT 'old:2', id, 93102, 'Mleko UHT 3,2% Pilos 1l', 1.99, 'prawdziwa', 'tanszykoszyk' FROM public.stores WHERE slug = 'lidl' UNION ALL
SELECT 'old:3', id, 93103, 'Mleko stare inne 1l', 2.49, 'prawdziwa', 'antonka' FROM public.stores WHERE slug = 'lidl' UNION ALL
SELECT 'old:4', id, 93104, 'Mleko UHT 3,2% Wiejskie 1 l', 2.00, 'prawdziwa', 'antonka' FROM public.stores WHERE slug = 'lidl' UNION ALL
SELECT 'old:5', id, 93105, 'Mleko UHT 3,2% Zmienne 1 l', 2.00, 'prawdziwa', 'antonka' FROM public.stores WHERE slug = 'lidl';
`);
const { pozycje } = pozycjeZObserwacji([
  obserwacjaKodyzbiedry({ ean: '5900000000017', nazwa: 'Mleko UHT 3,2% Łaciate 1 l', cena: '3.79', cena_widziana: '2026-11-19T18:00:00Z',
    utworzono_zrodlo: '2026-11-18' }),
  obserwacjaTanszykoszyk({ id_zrodla: 'a', nazwa: 'Mleko UHT 3,2% Pilos 1l', gramatura: '1l', cena_promocyjna: '2.25', typ_promocji: 'obniżka',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/a', ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
  obserwacjaTanszykoszyk({ id_zrodla: 'b', nazwa: "Mleko UHT 3,2% Mlekovita 1 l", gramatura: '1 l', cena_promocyjna: '2.99', typ_promocji: 'przy zakupie 3',
    warunek: "cena za 1 szt. poza promocją: 3,49 zł", wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/b',
    ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
  // Duble: dwa EAN pod jedną nazwą (jeden produkt), nazwa bez ilości, identyczna nazwa z błędną gramaturą w bazie.
  obserwacjaKodyzbiedry({ ean: '5900000000031', nazwa: 'Mleko UHT 3,2% Duo 1 l', cena: '3.19', cena_widziana: '2026-11-18T18:00:00Z' }),
  obserwacjaKodyzbiedry({ ean: '5900000000024', nazwa: 'Mleko UHT 3,2% Duo 1 l', cena: '3.19', cena_widziana: '2026-11-18T18:00:00Z' }),
  obserwacjaTanszykoszyk({ id_zrodla: 'd', nazwa: 'Mleko UHT 3,2% Wiejskie', gramatura: '1 l', cena_promocyjna: '1.89', typ_promocji: 'obniżka',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/d', ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
  obserwacjaTanszykoszyk({ id_zrodla: 'e', nazwa: 'Mleko UHT 3,2% Zmienne 1 l', gramatura: '500 ml', cena_promocyjna: '1.79', typ_promocji: 'obniżka',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/e', ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
  obserwacjaTanszykoszyk({ id_zrodla: 'c', nazwa: 'Mleko UHT 3,2% Ponad Limit 1 l', gramatura: '1 l', cena_promocyjna: '2.79', typ_promocji: 'obniżka',
    wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/c', ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl'),
]);
// Limit: nowa pozycja ponad limitem nie powstaje, istniejąca ponad limitem nadal jest aktualizowana.
for (const p of pozycje) p.poza_limitem = /Ponad Limit|Pilos/.test(p.nazwa);
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
    IF EXISTS (SELECT 1 FROM public.products WHERE canonical_name LIKE '%Ponad Limit%') THEN RAISE EXCEPTION 'Pozycja ponad limitem utworzyła produkt'; END IF;
    IF (SELECT count(*) FROM public.products WHERE canonical_name = 'Mleko UHT 3,2% Duo 1 l') <> 1
      OR NOT EXISTS (SELECT 1 FROM public.products WHERE product_key = 'ean:5900000000024' AND ean = '5900000000024')
      THEN RAISE EXCEPTION 'Dwa EAN pod jedną nazwą nie dały jednego produktu'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:4' AND promo_price = 1.89 AND last_import_run_id IS NOT NULL)
      THEN RAISE EXCEPTION 'Brak dopasowania po nazwie bez ilości'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers o JOIN public.products p ON p.id = o.product_id WHERE o.offer_key = 'old:5'
      AND o.promo_price = 1.79 AND p.quantity_value = 1000) THEN RAISE EXCEPTION 'Brak dopasowania po identycznej nazwie'; END IF;
    IF (SELECT count(*) FROM public.store_offers) <> 7 THEN RAISE EXCEPTION 'Oczekiwano 7 ofert, jest %', (SELECT count(*) FROM public.store_offers); END IF;
    IF (SELECT count(*) FROM public.import_runs) <> ${przebieg} THEN RAISE EXCEPTION 'Brak wpisu w rejestrze importów'; END IF;
  END $verify$;`);
}
// Rdzeń nazwy: SQL (pg_temp.rdzen w imporcie) i JavaScript dają to samo.
const nazwyRdzenia = ['Awokado Hass 1 szt.', 'KASZA BULGUR PLONY NATURY 4X100 g', 'GROCH ŁUSKANY PLONY NATURY 0,5 kg',
  'KUKURYDZA SŁODKA NASZA SPIŻ.340/285g', 'Mleko UHT 3,2% Łaciate 1 l', 'Mąka pszenna typ 650 1kg', 'Woda 6 x 1,5 L', "Ser O'Kej 150 G"];
sql(`CREATE FUNCTION pg_temp.rdzen(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $r$
  SELECT public.norm_text(regexp_replace(lower(coalesce(t, '')), '${WZORZEC_ILOSCI_W_NAZWIE}', ' ', 'g')) $r$;
DO $verify$ BEGIN
${nazwyRdzenia.map(n => `  IF pg_temp.rdzen('${n.replace(/'/g, "''")}') <> '${rdzenNazwy(n).replace(/'/g, "''")}' THEN
    RAISE EXCEPTION 'Rdzeń nazwy różni się: % -> % (JS: %)', '${n.replace(/'/g, "''")}', pg_temp.rdzen('${n.replace(/'/g, "''")}'), '${rdzenNazwy(n).replace(/'/g, "''")}'; END IF;`).join('\n')}
END $verify$;`);
const proba = sqlImportu(pozycje, { tryb: 'proba' });
sql(proba);
sql(`DO $verify$ BEGIN IF (SELECT count(*) FROM public.import_runs) <> 2 THEN RAISE EXCEPTION 'Tryb próbny zapisał dane'; END IF; END $verify$;`);
// Sprzątanie: najpierw blokada przez produkt na liście zakupów, potem właściwe sprzątanie i ponowne (bez zmian).
sql(`
INSERT INTO public.stores(slug, name) VALUES ('dino', 'Dino') ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.base_products(id, category_id, name) SELECT 93002, id, 'Kasza testowa' FROM public.categories WHERE slug = 'sypkie-i-makarony';
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit) VALUES
  (93106, 'name:dino', 93001, 'Mleko UHT 3,2% Dino 1 l', 1000, 'ml'),
  (93107, 'name:kasza', 93002, 'Kasza testowa stara 400 g', 400, 'g');
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source)
SELECT 'old:6', id, 93106, 'Mleko UHT 3,2% Dino 1 l', 2.99, 'prawdziwa', 'antonka' FROM public.stores WHERE slug = 'dino' UNION ALL
SELECT 'old:7', id, 93107, 'Kasza testowa stara 400 g', 3.99, 'prawdziwa', 'brak' FROM public.stores WHERE slug = 'lidl';
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ('93000000-0000-4000-8000-000000000001', 'import@example.invalid', now());
INSERT INTO public.shopping_lists(id, owner_id, name) VALUES ('93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', 'Test');
INSERT INTO public.shopping_list_items(list_id, group_id, selected_product_id, quantity, unit)
SELECT '93000000-0000-4000-8000-000000000002', comparison_group_id, id, 1, 'g' FROM public.products WHERE id = 93107;
`);
const sprzatanie = sqlImportu(pozycje, { tryb: 'zapis', sprzatanie: true });
sqlFails(sprzatanie, /Sprzątanie przerwane: 1 produkt/);
sql(`DO $verify$ BEGIN
  IF (SELECT count(*) FROM public.import_runs) <> 2 OR NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:3')
    THEN RAISE EXCEPTION 'Przerwane sprzątanie coś zapisało'; END IF;
END $verify$;
DELETE FROM public.shopping_lists WHERE id = '93000000-0000-4000-8000-000000000002';`);
for (const przebieg of [3, 4]) {
  sql(sprzatanie);
  sql(`DO $verify$ BEGIN
    IF EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key IN ('old:3', 'old:7')) THEN RAISE EXCEPTION 'Nieodświeżone oferty zostały'; END IF;
    IF EXISTS (SELECT 1 FROM public.products WHERE id IN (93103, 93107)) THEN RAISE EXCEPTION 'Produkty bez ofert zostały'; END IF;
    IF EXISTS (SELECT 1 FROM public.comparison_groups g WHERE g.group_key NOT LIKE 'reviewed:%'
      AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.comparison_group_id = g.id)) THEN RAISE EXCEPTION 'Została pusta grupa'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:6' AND last_import_run_id IS NULL)
      THEN RAISE EXCEPTION 'Usunięto ofertę sieci spoza importu'; END IF;
    IF (SELECT count(*) FROM public.store_offers) <> 7 THEN RAISE EXCEPTION 'Oczekiwano 7 ofert, jest %', (SELECT count(*) FROM public.store_offers); END IF;
    IF (SELECT count(*) FROM public.import_runs) <> ${przebieg} THEN RAISE EXCEPTION 'Brak wpisu w rejestrze importów'; END IF;
  END $verify$;`);
}
console.log('Catalog import cleanup: shopping-list guard, stale offers/products/empty groups removed, other chains untouched, idempotent.');
// Tryb testowy --regularne-z-promocji: wyliczona cena regularna jest oznaczona źródłem, a zwykły import ją wycofuje.
const zWyliczona = pozycjeZObserwacji([obserwacjaTanszykoszyk({ id_zrodla: 'a', nazwa: 'Mleko UHT 3,2% Pilos 1l', gramatura: '1l',
  cena_promocyjna: '2.25', typ_promocji: '1+1 gratis', wazne_od: '2026-11-17', wazne_do: '2026-11-21', link_zrodla: '/produkt/a',
  ostatnio_widziane: '2026-11-18T18:00:00Z' }, 'lidl')], { regularneZPromocji: true }).pozycje;
sql(sqlImportu(zWyliczona, { tryb: 'zapis' }));
sql(`DO $verify$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:2' AND regular_price = 4.50 AND price_status = 'prawdziwa'
    AND price_source = 'wyliczona_z_promocji' AND (regular_price_observed_at AT TIME ZONE 'Europe/Warsaw')::date = '2026-11-18')
    THEN RAISE EXCEPTION 'Brak wyliczonej ceny regularnej'; END IF;
  IF (SELECT single_price FROM public.catalog_offers WHERE product_name = 'Mleko UHT 3,2% Pilos 1l') <> 4.50
    THEN RAISE EXCEPTION 'Wyliczona cena nie jest ceną dziś'; END IF;
  IF (SELECT count(*) FROM public.store_offers) <> 7 THEN RAISE EXCEPTION 'Tryb testowy zmienił liczbę ofert'; END IF;
END $verify$;`);
sql(importSql);
sql(`DO $verify$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_offers WHERE offer_key = 'old:2' AND regular_price IS NULL AND price_status = 'brak'
    AND price_source = 'tanszykoszyk') THEN RAISE EXCEPTION 'Zwykły import nie wycofał wyliczonej ceny'; END IF;
  IF EXISTS (SELECT 1 FROM public.store_offers WHERE price_source = 'wyliczona_z_promocji') THEN RAISE EXCEPTION 'Została wyliczona cena'; END IF;
  IF (SELECT count(*) FROM public.import_runs) <> 6 THEN RAISE EXCEPTION 'Brak wpisów w rejestrze importów'; END IF;
END $verify$;`);
console.log('Catalog import test mode: calculated regular price marked by source and reverted by a normal import.');

// Przegląd mleka: lista z bazy -> decyzje -> wygenerowany SQL wykonany w izolowanej bazie (próba, potem zapis).
sql(`
INSERT INTO public.base_products(id, category_id, name) SELECT 97001, id, 'Mleko przegląd' FROM public.categories WHERE slug = 'nabial';
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit) VALUES
  (97101, 'mp:1', 97001, 'MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l', 1000, 'ml'),
  (97102, 'mp:2', 97001, 'Mlekovita Wydojone mleko bez laktozy 2% tł. 1l', 1000, 'ml'),
  (97103, 'mp:3', 97001, 'MLEKO SPOŻYWCZE POLSKIE 2% 1l', 1000, 'ml'),
  (97104, 'mp:4', 97001, 'Mleko UHT 3,2% Testowe 1 l', 1000, 'ml'),
  (97105, 'mp:5', 97001, 'Mleko o smaku truskawkowym 1 l', 1000, 'ml');
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ('97000000-0000-4000-8000-000000000001', 'przeglad@example.invalid', now());
INSERT INTO public.shopping_lists(id, owner_id, name) VALUES ('97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', 'Mleko');
INSERT INTO public.shopping_list_items(list_id, group_id, quantity, unit)
SELECT '97000000-0000-4000-8000-000000000002', comparison_group_id, 1000, 'ml' FROM public.products WHERE id = 97101;
`);
const zapytanieListy = fs.readFileSync(path.join(root, 'scripts/mleko/mleko-do-przegladu.sql'), 'utf8')
  .replace("TO '/sql/mleko-do-przegladu.csv'", 'TO STDOUT');
const lista = parsujCsv(czytajTekst(Buffer.from(sqlOut(zapytanieListy), 'utf8')));
const naLiscie = lista.map(w => Number(w.produkt_id)).filter(id => id >= 97101 && id <= 97105).sort();
if (naLiscie.join() !== '97101,97102,97103') throw new Error(`Lista przeglądu: oczekiwano 97101-97103, jest ${naLiscie.join()}`);
const wiersz = id => lista.find(w => Number(w.produkt_id) === id);
if (wiersz(97102).laktoza !== 'bez laktozy' || wiersz(97101).tluszcz !== '3,2') throw new Error('Lista przeglądu: zła propozycja laktozy/tłuszczu');
const wypelnione = { 97101: 'UHT', 97102: 'świeże', 97103: 'pomiń' };
const decyzjePrzegladu = lista.filter(w => wypelnione[w.produkt_id]).map((w, i) => decyzja({ ...w, rodzaj: wypelnione[w.produkt_id] }, i + 2));
sql(sqlPrzegladu(decyzjePrzegladu, { tryb: 'proba', zrodlo: 'test-proba' }));
sql(`DO $verify$ BEGIN
  IF EXISTS (SELECT 1 FROM public.catalog_reviews) OR (SELECT classification_source FROM public.products WHERE id = 97101) = 'reviewed'
    THEN RAISE EXCEPTION 'Próba przeglądu mleka coś zapisała'; END IF;
END $verify$;`);
sql(sqlPrzegladu(decyzjePrzegladu, { tryb: 'zapis', zrodlo: 'test-zapis' }));
sql(`DO $verify$ DECLARE uht bigint := (SELECT id FROM public.comparison_groups WHERE group_key = 'milk:uht:3.2:z laktozą');
BEGIN
  IF (SELECT comparison_group_id FROM public.products WHERE id = 97101) IS DISTINCT FROM uht
    OR (SELECT classification_source FROM public.products WHERE id = 97101) <> 'reviewed' THEN RAISE EXCEPTION 'Mleko UHT nie trafiło do grupy'; END IF;
  IF (SELECT g.group_key FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id = 97102) <> 'milk:świeże:2:bez laktozy'
    THEN RAISE EXCEPTION 'Mleko świeże bez laktozy nie trafiło do grupy'; END IF;
  IF (SELECT g.group_key FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id = 97103) NOT LIKE 'product:%'
    OR NOT EXISTS (SELECT 1 FROM public.catalog_reviews WHERE product_id = 97103 AND decision = 'skip') THEN RAISE EXCEPTION 'Pominięte mleko zmieniło grupę'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shopping_list_items WHERE list_id = '97000000-0000-4000-8000-000000000002' AND group_id = uht)
    THEN RAISE EXCEPTION 'Pozycja listy nie przeszła do nowej grupy'; END IF;
  IF (SELECT count(*) FROM public.catalog_reviews WHERE source = 'test-zapis') <> 3 THEN RAISE EXCEPTION 'Brak wpisów w rejestrze przeglądu'; END IF;
  -- Import zmieniający nazwę nie cofa decyzji.
  UPDATE public.products SET canonical_name = 'MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l (zmiana)' WHERE id = 97101;
  IF (SELECT comparison_group_id FROM public.products WHERE id = 97101) IS DISTINCT FROM uht THEN RAISE EXCEPTION 'Zmiana nazwy cofnęła decyzję'; END IF;
END $verify$;`);
const poPrzegladzie = parsujCsv(czytajTekst(Buffer.from(sqlOut(zapytanieListy), 'utf8'))).filter(w => Number(w.produkt_id) >= 97101 && Number(w.produkt_id) <= 97105);
if (poPrzegladzie.length) throw new Error('Mleka z decyzją wróciły na listę przeglądu');
console.log('Milk review: list export, dry-run rollback, UHT/fresh/skip decisions in rule groups, list items kept, reviewed decisions survive renames.');
console.log('Catalog import: EAN/name matching, duplicate merging, replacement, untouched old offers, per-category limit, idempotent rerun and dry-run rollback passed.');
console.log('Database migration and RLS scenarios passed.');
