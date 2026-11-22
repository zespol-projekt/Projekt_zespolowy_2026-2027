-- API katalogu v1: drzewo, gałąź, wyszukiwanie, grupa, produkt, ceny jednostkowe, paginacja, błędy, uprawnienia.
BEGIN;
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES
  ('98000000-0000-4000-8000-000000000001', 'api@example.invalid', now(), false),
  ('98000000-0000-4000-8000-000000000002', 'api-niepotwierdzony@example.invalid', NULL, false);
INSERT INTO public.stores(slug, name) VALUES ('biedronka', 'Biedronka'), ('lidl', 'Lidl') ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.base_products(id, category_id, subcategory_id, name)
SELECT 98001, s.category_id, s.id, 'Mleko API' FROM public.catalog_subcategories s WHERE s.slug = 'nabial-mleko';
INSERT INTO public.base_products(id, category_id, name) SELECT 98002, id, 'Piwo API' FROM public.categories WHERE slug = 'napoje';
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit, ean) VALUES
  (98101, 'api:1', 98001, 'Łaciate Mleko UHT 3,2% 1 l', 1000, 'ml', '5900000098101'),
  (98102, 'api:2', 98001, 'Mlekovita Mleko UHT 3,2% 0,5 l', 500, 'ml', NULL),
  (98103, 'api:3', 98001, 'Mleko UHT 2% Testowe 1 l', 1000, 'ml', NULL),
  (98104, 'api:4', 98001, 'Mleko zagęszczone niesłodzone 500 g', 500, 'g', NULL),
  (98105, 'api:5', 98002, 'Piwo jasne API 0,5 l', 500, 'ml', NULL);
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source, regular_price_observed_at)
SELECT k, (SELECT id FROM public.stores WHERE slug = s), pid, n, rp, st, 'test', now() FROM (VALUES
  ('api:o1', 'biedronka', 98101, 'MLEKO ŁACIATE UHT 3,2% 1L', 3.50, 'prawdziwa'),
  ('api:o2', 'lidl', 98101, 'Łaciate Mleko UHT 3,2% 1 l', 3.80, 'prawdziwa'),
  ('api:o3', 'biedronka', 98102, 'MLEKOVITA UHT 3,2% 0,5L', 1.60, 'prawdziwa'),
  ('api:o4', 'lidl', 98103, 'Mleko UHT 2% Testowe 1 l', NULL, 'brak'),
  ('api:o5', 'biedronka', 98104, 'MLEKO ZAGĘSZCZONE 500 g', 5.99, 'prawdziwa'),
  ('api:o6', 'biedronka', 98105, 'PIWO JASNE 0,5L', 2.99, 'prawdziwa')) v(k, s, pid, n, rp, st);
-- Promocja naliczana dziś w Lidlu (niższa od regularnej) i zmiana ceny dla historii.
UPDATE public.store_offers SET promo_price = 2.99, promo_type = 'obniżka', valid_from = current_date - 1, valid_to = current_date + 2,
  promo_scope = 'nationwide', promo_price_status = 'prawdziwa', promo_evidence_url = 'https://example.invalid/lidl', promo_rule = '{"kind":"unit"}'
WHERE offer_key = 'api:o2';
UPDATE public.store_offers SET regular_price = 3.40 WHERE offer_key = 'api:o1';

SELECT set_config('request.jwt.claims', '{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE t jsonb := public.catalog_tree(); nabial jsonb; mleko jsonb; b jsonb; s1 jsonb; s2 jsonb; g jsonb; p jsonb; grupa bigint; uht jsonb;
BEGIN
  -- Drzewo: kolejność, dzieci, status, liczby bez piwa.
  IF t->'categories'->0->>'slug' <> 'warzywa-i-owoce' OR jsonb_array_length(t->'categories') <> 10 THEN RAISE EXCEPTION 'Zła kolejność kategorii: %', t->'categories'->0; END IF;
  SELECT c INTO nabial FROM jsonb_array_elements(t->'categories') c WHERE c->>'slug' = 'nabial';
  SELECT c INTO mleko FROM jsonb_array_elements(nabial->'children') c WHERE c->>'slug' = 'nabial-mleko';
  IF mleko->>'verification_status' <> 'reviewed' OR (mleko->>'product_count')::int <> 4 OR (mleko->>'offer_count')::int <> 5
    OR mleko->>'parent_slug' <> 'nabial' OR NOT (mleko->>'has_items')::boolean THEN RAISE EXCEPTION 'Zły węzeł Mleko: %', mleko; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(t->'categories') c WHERE c->>'slug' = 'napoje' AND (c->>'product_count')::int > 0)
    THEN RAISE EXCEPTION 'Piwo (bez podkategorii) liczone w drzewie'; END IF;

  -- Gałąź: grupy przed pojedynczymi produktami; liczby; „od X zł” z ceny za litr, nie za opakowanie.
  b := public.catalog_branch('nabial-mleko', 30, 0);
  IF (b->>'total')::int <> 3 OR b->'items'->0->>'kind' <> 'group' OR b->'items'->2->>'kind' <> 'product' THEN RAISE EXCEPTION 'Zła gałąź: %', b; END IF;
  SELECT i INTO uht FROM jsonb_array_elements(b->'items') i WHERE i->>'name' = 'Mleko UHT 3,2% · z laktozą';
  IF (uht->>'product_count')::int <> 2 OR (uht->>'offer_count')::int <> 3 OR (uht->>'store_count')::int <> 2 OR (uht->>'stores_with_price_today')::int <> 2
    THEN RAISE EXCEPTION 'Złe liczby grupy: %', uht; END IF;
  IF (uht->'price_from'->>'unit_price')::numeric <> 2.99 OR uht->'price_from'->>'unit_price_per' <> '1 l' OR uht->'price_from'->'store'->>'slug' <> 'lidl'
    THEN RAISE EXCEPTION 'Zła cena „od”: %', uht->'price_from'; END IF;
  IF (SELECT i->>'product_id' FROM jsonb_array_elements(b->'items') i WHERE i->>'kind' = 'product')::bigint <> 98104 THEN RAISE EXCEPTION 'Brak product_id produktu'; END IF;
  -- Paginacja: total niezależny od strony; strona poza końcem pusta.
  b := public.catalog_branch('nabial-mleko', 1, 1);
  IF (b->>'total')::int <> 3 OR jsonb_array_length(b->'items') <> 1 OR (b->>'limit')::int <> 1 OR (b->>'offset')::int <> 1 THEN RAISE EXCEPTION 'Zła paginacja: %', b; END IF;
  IF jsonb_array_length(public.catalog_branch('nabial-mleko', 10, 50)->'items') <> 0 THEN RAISE EXCEPTION 'Strona poza końcem nie jest pusta'; END IF;
  IF (public.catalog_branch('nabial-sery', 10, 0)->>'total')::int <> 0 THEN RAISE EXCEPTION 'Pusta gałąź nie jest pusta'; END IF;

  -- Wyszukiwanie: zapisy 3,2% / 3.2 % / polskie znaki dają to samo; piwo ukryte; puste zapytanie.
  s1 := public.catalog_search('mleko 3,2%', 10, 0); s2 := public.catalog_search('MLEKO 3.2 %', 10, 0);
  IF (s1->>'total')::int <> 1 OR s1->'items'->0->>'name' <> 'Mleko UHT 3,2% · z laktozą' OR s1->'items' <> s2->'items' THEN RAISE EXCEPTION 'Złe wyszukiwanie 3,2%%: % / %', s1, s2; END IF;
  IF (public.catalog_search('laciate', 10, 0)->>'total')::int <> 1 OR (public.catalog_search('ŁACIATE', 10, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'Polskie znaki'; END IF;
  IF (public.catalog_search('mleko', 10, 0)->>'total')::int <> 3 OR public.catalog_search('mleko', 10, 0)->'items'->2->>'kind' <> 'product' THEN RAISE EXCEPTION 'Zła kolejność wyników'; END IF;
  IF (public.catalog_search('piwo', 10, 0)->>'total')::int <> 0 THEN RAISE EXCEPTION 'Piwo w wynikach'; END IF;
  IF (public.catalog_search('   ', 10, 0)->>'total')::int <> 0 OR jsonb_array_length(public.catalog_search('xyz brak', 10, 0)->'items') <> 0 THEN RAISE EXCEPTION 'Puste zapytanie'; END IF;

  -- Grupa: produkty z ofertami, oferta z promocją naliczaną dziś i oferta bez ceny.
  grupa := (uht->>'group_id')::bigint;
  g := public.catalog_group(grupa);
  IF jsonb_array_length(g->'products') <> 2 OR g->'group'->'path'->'subcategory'->>'slug' <> 'nabial-mleko' THEN RAISE EXCEPTION 'Zła grupa: %', g; END IF;
  SELECT o INTO p FROM jsonb_array_elements(g->'products') pr, jsonb_array_elements(pr->'offers') o WHERE o->'store'->>'slug' = 'lidl';
  IF (p->>'price_today')::numeric <> 2.99 OR p->>'price_today_basis' <> 'promotion' OR NOT (p->'promotion'->>'applies_today')::boolean
    OR (p->>'regular_price')::numeric <> 3.80 THEN RAISE EXCEPTION 'Zła oferta z promocją: %', p; END IF;
  p := public.catalog_group((SELECT comparison_group_id FROM public.products WHERE id = 98103))->'products'->0->'offers'->0;
  IF p->>'price_today' IS NOT NULL OR p->>'price_today_basis' IS NOT NULL OR p->>'regular_price_status' <> 'brak' OR p->'promotion' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'Zła oferta bez ceny: %', p; END IF;

  -- Produkt: dane, grupa, ścieżka, historia cen.
  p := public.catalog_product(98101);
  IF p->'product'->>'ean' <> '5900000098101' OR p->'product'->'group'->>'kind' <> 'group' OR jsonb_array_length(p->'offers') <> 2
    OR p->'product'->'path'->'category'->>'slug' <> 'nabial' OR (p->'product'->'package'->>'quantity')::numeric <> 1000 THEN RAISE EXCEPTION 'Zły produkt: %', p; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'offers') o, jsonb_array_elements(o->'history') h WHERE o->'store'->>'slug' = 'biedronka')
    THEN RAISE EXCEPTION 'Brak historii cen'; END IF;
  -- 404: nieistniejący produkt, piwo (bez podkategorii), zła podkategoria, grupa bez ofert.
  BEGIN PERFORM public.catalog_product(99999999); RAISE EXCEPTION 'Brak 404 produktu'; EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
  BEGIN PERFORM public.catalog_product(98105); RAISE EXCEPTION 'Piwo widoczne'; EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
  BEGIN PERFORM public.catalog_branch('nie-ma-takiej', 10, 0); RAISE EXCEPTION 'Brak 404 podkategorii'; EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
  BEGIN PERFORM public.catalog_group(99999999); RAISE EXCEPTION 'Brak 404 grupy'; EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
  -- Zgodność: grupa z wyniku działa w dotychczasowym search_product_groups/catalog_offers.
  IF NOT EXISTS (SELECT 1 FROM public.catalog_offers WHERE group_id = grupa) THEN RAISE EXCEPTION 'Brak zgodności z catalog_offers'; END IF;
END $$;
RESET ROLE;

-- Niepotwierdzone konto: błąd uprawnień (42501). Gość: brak prawa wykonania.
SELECT set_config('request.jwt.claims', '{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.catalog_search('mleko', 10, 0); RAISE EXCEPTION 'Niepotwierdzone konto wyszukuje';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.catalog_tree(); RAISE EXCEPTION 'Niepotwierdzone konto widzi drzewo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.catalog_tree(); RAISE EXCEPTION 'Gość widzi drzewo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Catalog API: tree order/counts, branch groups-first with per-litre "from" price, pagination, search spelling variants, hidden beer, group/product offers with promotion and missing price, history, 404s, permissions passed.' AS result;
