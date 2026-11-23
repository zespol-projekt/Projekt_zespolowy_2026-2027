-- Wyszukiwanie katalogu (22.11.2026): słowa w jednym produkcie, bez produktu bazowego w grupach zamienników,
-- całe wyrazy (ostatnie słowo jako początek wyrazu); poprawka produktów bazowych mleka; price_source w Koszyku.
BEGIN;
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES
  ('98500000-0000-4000-8000-000000000001', 'szukaj@example.invalid', now(), false);
INSERT INTO public.stores(slug, name) VALUES ('biedronka', 'Biedronka') ON CONFLICT (slug) DO NOTHING;
-- Produkty bazowe mleka o nazwach ze słownika (jeśli migracje ich nie mają, tworzymy w podkategorii Mleko).
INSERT INTO public.base_products(id, category_id, subcategory_id, name)
SELECT v.id, s.category_id, s.id, v.name FROM public.catalog_subcategories s,
  (VALUES (98501, 'Mleko UHT 3,2%'), (98502, 'Mleko bez laktozy'), (98504, 'Mleko 1,5% - 2,0%')) v(id, name)
WHERE s.slug = 'nabial-mleko' ON CONFLICT (name) DO NOTHING;
INSERT INTO public.base_products(id, category_id, subcategory_id, name)
SELECT 98503, s.category_id, s.id, 'Ser żółty Szukaj' FROM public.catalog_subcategories s WHERE s.slug = 'nabial-sery';
CREATE TEMP TABLE bazy ON COMMIT DROP AS
SELECT (SELECT id FROM public.base_products WHERE name = 'Mleko UHT 3,2%') AS uht32,
       (SELECT id FROM public.base_products WHERE name = 'Mleko bez laktozy') AS bez,
       (SELECT id FROM public.base_products WHERE name = 'Mleko 1,5% - 2,0%') AS m15;
GRANT SELECT ON bazy TO authenticated;
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit, sale_mode)
SELECT v.id, 'szukaj:' || v.id, v.base, v.name, v.q, v.u, 'package' FROM bazy b, LATERAL (VALUES
  -- Jak produkt 307 na wspólnej bazie: mleko świeże z laktozą z błędnym produktem bazowym „Mleko bez laktozy”.
  (98601, b.bez, 'Mleko świeże 3,2% Dolina 1 l', 1000::numeric, 'ml'),
  (98602, b.uht32, 'Piątnica Mleko świeże 3,2% 1 l', 1000, 'ml'),
  -- Mleko bez laktozy z produktem bazowym bez tej cechy.
  (98603, b.uht32, 'Łaciate Mleko UHT bez laktozy 3,2% 1 l', 1000, 'ml'),
  (98606, b.bez, 'Mleko świeże 2% Wiejskie 1 l', 1000, 'ml'),
  -- Pojedyncze produkty (bez grupy zamienników): produkt bazowy nadal przeszukiwany.
  (98604, 98503, 'Gouda plastry 150 g', 150, 'g'),
  (98605, 98503, 'Gouda bezglutenowa 150 g', 150, 'g')) v(id, base, name, q, u);
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source, regular_price_observed_at)
SELECT 'szukaj:o' || p.id, (SELECT id FROM public.stores WHERE slug = 'biedronka'), p.id, p.canonical_name, 3.00, 'prawdziwa',
  CASE WHEN p.id = 98603 THEN 'kodyzbiedry' ELSE 'tanszykoszyk' END, now()
FROM public.products p WHERE p.id BETWEEN 98601 AND 98606;

DO $$ DECLARE g text; BEGIN
  SELECT name INTO g FROM public.comparison_groups WHERE id = (SELECT comparison_group_id FROM public.products WHERE id = 98601);
  IF g <> 'Mleko świeże 3,2% · z laktozą' THEN RAISE EXCEPTION 'Zła grupa fixture: %', g; END IF;
  IF (SELECT search_text FROM public.products WHERE id = 98601) <> 'mleko swieze 3,2% dolina 1 l'
    THEN RAISE EXCEPTION 'Tekst wyszukiwania zawiera produkt bazowy: %', (SELECT search_text FROM public.products WHERE id = 98601); END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"98500000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE s jsonb; nazwy text[];
BEGIN
  -- Zgłoszenie Radka: „bez laktozy” nie zwraca grupy z laktozą (produkt bazowy „Mleko bez laktozy” nie jest przeszukiwany).
  s := public.catalog_search('mleko 3,2% bez laktozy', 30, 0);
  SELECT array_agg(i->>'name' ORDER BY i->>'name') INTO nazwy FROM jsonb_array_elements(s->'items') i;
  IF nazwy IS DISTINCT FROM ARRAY['Mleko UHT 3,2% · bez laktozy'] THEN RAISE EXCEPTION 'Złe wyniki „bez laktozy”: %', nazwy; END IF;
  -- „uht” nie trafia w mleko świeże z produktem bazowym „Mleko UHT 3,2%”.
  s := public.catalog_search('mleko uht 3,2%', 30, 0);
  SELECT array_agg(i->>'name' ORDER BY i->>'name') INTO nazwy FROM jsonb_array_elements(s->'items') i;
  IF nazwy IS DISTINCT FROM ARRAY['Mleko UHT 3,2% · bez laktozy'] THEN RAISE EXCEPTION 'Złe wyniki „uht”: %', nazwy; END IF;
  -- Słowa z dwóch różnych produktów grupy nie są łączone.
  IF (public.catalog_search('dolina piatnica', 30, 0)->>'total')::int <> 0 THEN RAISE EXCEPTION 'Słowa z różnych produktów połączone'; END IF;
  IF (public.catalog_search('piatnica swieze', 30, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'Brak trafienia w jednym produkcie'; END IF;
  -- Nazwa grupy łączy się z nazwą produktu: „z laktozą” z grupy, „Piątnica” z produktu.
  IF (public.catalog_search('mleko z laktoza piatnica', 30, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'Nazwa grupy nie łączy się z produktem'; END IF;
  -- Pojedyncze produkty: produkt bazowy przeszukiwany („ser” jest tylko w produkcie bazowym).
  IF (public.catalog_search('ser gouda', 30, 0)->>'total')::int <> 2 THEN RAISE EXCEPTION 'Produkt bazowy pojedynczego produktu nie jest przeszukiwany'; END IF;
  -- Całe wyrazy, ostatnie słowo jako początek wyrazu.
  IF (public.catalog_search('bez gouda', 30, 0)->>'total')::int <> 0 THEN RAISE EXCEPTION '„bez” trafia w środek wyrazu'; END IF;
  IF (public.catalog_search('gouda bez', 30, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'Ostatnie słowo nie działa jako początek wyrazu'; END IF;
  IF (public.catalog_search('laci', 30, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'Początek wyrazu nie działa'; END IF;
  IF (public.catalog_search('mlek uht', 30, 0)->>'total')::int <> 0 THEN RAISE EXCEPTION 'Niedokończone słowo w środku zapytania trafia'; END IF;
END $$;
RESET ROLE;

-- Poprawka produktów bazowych mleka (funkcja administracyjna): 98601 i 98606 bez „bez laktozy”, 98603 z „bez laktozy”.
DO $$ DECLARE n integer; g bigint := (SELECT comparison_group_id FROM public.products WHERE id = 98601); BEGIN
  n := public.align_milk_base_products();
  IF n <> 3 THEN RAISE EXCEPTION 'Poprawiono % produktów zamiast 3', n; END IF;
  IF (SELECT base_product_id FROM public.products WHERE id = 98601) <> (SELECT uht32 FROM bazy)
    OR (SELECT base_product_id FROM public.products WHERE id = 98606) <> (SELECT m15 FROM bazy)
    OR (SELECT base_product_id FROM public.products WHERE id = 98603) <> (SELECT bez FROM bazy) THEN RAISE EXCEPTION 'Złe produkty bazowe po poprawce'; END IF;
  IF (SELECT comparison_group_id FROM public.products WHERE id = 98601) <> g THEN RAISE EXCEPTION 'Poprawka zmieniła grupę'; END IF;
  IF public.align_milk_base_products() <> 0 THEN RAISE EXCEPTION 'Poprawka nie jest idempotentna'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.align_milk_base_products(); RAISE EXCEPTION 'Użytkownik uruchomił poprawkę danych';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Koszyk: każdy wybór ma price_source.
DO $$ DECLARE c jsonb; pick jsonb; BEGIN
  c := public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'a', 'group_id',
    (SELECT comparison_group_id FROM public.products WHERE id = 98603), 'quantity', 2000, 'unit', 'ml')));
  SELECT pk INTO pick FROM jsonb_array_elements(c->'stores') st, jsonb_array_elements(st->'items') it, jsonb_array_elements(it->'picks') pk LIMIT 1;
  IF pick IS NULL OR pick->>'price_source' <> 'kodyzbiedry' OR NOT (pick ? 'observed_at') THEN RAISE EXCEPTION 'Brak price_source w wyborze: % / %', pick, c; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Catalog search: words within one product, no base product in substitute groups, whole words with prefix for the last word, milk base-product alignment, price_source in basket picks passed.' AS result;
