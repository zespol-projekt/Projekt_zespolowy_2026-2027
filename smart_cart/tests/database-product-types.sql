-- Rodzaje produktów (24.11.2026): przypisanie regułą i decyzją, typowe opakowanie, cena podejrzana, ekran rodzaju,
-- wyszukiwanie i gałąź z rodzajami, porównanie koszyka (najtańszy w sieci, wybór klienta, ten sam produkt w innej
-- sieci, sztuki = typowe opakowanie), „Pokaż więcej”, pozycje listy i ulubione.
BEGIN;
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES
  ('99100000-0000-4000-8000-000000000001', 'rodzaje@example.invalid', now(), false);
INSERT INTO public.stores(slug, name) VALUES ('biedronka', 'Biedronka'), ('lidl', 'Lidl'), ('carrefour', 'Carrefour')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.base_products(id, category_id, subcategory_id, name)
SELECT 99001, s.category_id, s.id, 'Pomidory Test' FROM public.catalog_subcategories s WHERE s.slug = 'tluszcze-i-przetwory-przetwory-pomidorowe';
INSERT INTO public.product_types(slug, name, subcategory_id, unit)
SELECT 'test-pomidory-krojone', 'Pomidory krojone Test', s.id, 'g' FROM public.catalog_subcategories s WHERE s.slug = 'tluszcze-i-przetwory-przetwory-pomidorowe';
INSERT INTO public.product_type_rules(product_type_id, priority, base_product_names, include_pattern, exclude_pattern)
SELECT id, 5, ARRAY['Pomidory Test'], 'kroj', '\ysos' FROM public.product_types WHERE slug = 'test-pomidory-krojone';

-- Produkty dodane po regule dostają rodzaj od razu (wyzwalacz przy imporcie).
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit, sale_mode)
SELECT v.id, 'rodzaje:' || v.id, 99001, v.name, v.q, v.u, 'package' FROM (VALUES
  (99101, 'Pomidory krojone Alfa 400 g', 400::numeric, 'g'),   -- w Biedronce i Lidlu (ten sam produkt)
  (99102, 'Pomidory krojone Beta 400 g', 400, 'g'),            -- Lidl, najtańszy
  (99103, 'Pomidory krojone Gamma 240 g', 240, 'g'),           -- Carrefour, mniejsze opakowanie
  (99104, 'Sos pomidorowy krojone 400 g', 400, 'g'),           -- wykluczony regułą
  (99105, 'Pomidory krojone Delta 400 ml', 400, 'ml'),         -- inna jednostka
  (99106, 'Pomidory krojone Tanie 400 g', 400, 'g')            -- cena podejrzanie niska
) v(id, name, q, u);
INSERT INTO public.store_offers(offer_key, store_id, product_id, store_product_name, regular_price, price_status, price_source, regular_price_observed_at)
SELECT 'rodzaje:o' || v.p || ':' || v.s, (SELECT id FROM public.stores WHERE slug = v.s), v.p,
  (SELECT canonical_name FROM public.products WHERE id = v.p), v.c, 'prawdziwa', 'tanszykoszyk', now()
FROM (VALUES (99101, 'biedronka', 2.99), (99101, 'lidl', 3.49), (99102, 'lidl', 2.79), (99103, 'carrefour', 1.99),
  (99106, 'biedronka', 0.50), (99104, 'biedronka', 2.50), (99105, 'biedronka', 2.50)) v(p, s, c);

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.product_types WHERE slug = 'test-pomidory-krojone') AS typ,
  (SELECT id FROM public.stores WHERE slug = 'biedronka') AS bied, (SELECT id FROM public.stores WHERE slug = 'lidl') AS lidl,
  (SELECT id FROM public.stores WHERE slug = 'carrefour') AS carr;
GRANT SELECT ON t TO authenticated;

DO $$ DECLARE r jsonb; BEGIN
  IF (SELECT array_agg(id ORDER BY id) FROM public.products WHERE product_type_id = (SELECT typ FROM t)) IS DISTINCT FROM ARRAY[99101, 99102, 99103, 99106]::bigint[]
    THEN RAISE EXCEPTION 'Złe przypisanie regułą: %', (SELECT array_agg(id ORDER BY id) FROM public.products WHERE product_type_id = (SELECT typ FROM t)); END IF;
  IF (SELECT product_type_source FROM public.products WHERE id = 99101) <> 'rule' THEN RAISE EXCEPTION 'Brak źródła rule'; END IF;
  -- Decyzja ręczna ma pierwszeństwo przed regułą i przetrwa zmianę nazwy.
  INSERT INTO public.product_type_reviews(product_id, product_type_id, source) VALUES (99104, (SELECT typ FROM t), 'test'),
    (99106, NULL, 'test: bez rodzaju');
  r := public.refresh_product_types();
  IF (SELECT product_type_id FROM public.products WHERE id = 99104) IS DISTINCT FROM (SELECT typ FROM t)
    OR (SELECT product_type_source FROM public.products WHERE id = 99104) <> 'review' THEN RAISE EXCEPTION 'Decyzja nie zadziałała'; END IF;
  IF (SELECT product_type_id FROM public.products WHERE id = 99106) IS NOT NULL THEN RAISE EXCEPTION 'Decyzja „bez rodzaju” nie zadziałała'; END IF;
  UPDATE public.products SET canonical_name = 'Sos pomidorowy krojone 400 g nowy' WHERE id = 99104;
  IF (SELECT product_type_id FROM public.products WHERE id = 99104) IS DISTINCT FROM (SELECT typ FROM t) THEN RAISE EXCEPTION 'Decyzja zginęła po zmianie nazwy'; END IF;
  -- Powrót do stanu z reguł (dalej testujemy cenę podejrzaną na 99106).
  DELETE FROM public.product_type_reviews WHERE product_id IN (99104, 99106);
  r := public.refresh_product_types();
  IF (r->>'changed_products')::int <> 2 THEN RAISE EXCEPTION 'refresh: %', r; END IF;
  IF public.refresh_product_types()->>'changed_products' <> '0' THEN RAISE EXCEPTION 'refresh nie jest idempotentny'; END IF;
  IF (SELECT typical_package FROM public.product_types WHERE id = (SELECT typ FROM t)) <> 400 THEN RAISE EXCEPTION 'Złe typowe opakowanie'; END IF;
  -- Odświeżenie (reguła po regule) daje to samo co trigger (produkt po produkcie) - w tym dla reguł z migracji.
  IF EXISTS (SELECT 1 FROM public.products p
             WHERE NOT EXISTS (SELECT 1 FROM public.product_type_reviews rv WHERE rv.product_id = p.id)
               AND p.product_type_id IS DISTINCT FROM public.product_type_match(p.canonical_name, p.base_product_id, p.quantity_unit, p.quantity_value))
    THEN RAISE EXCEPTION 'refresh_product_types różni się od product_type_match'; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"99100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE x jsonb; s jsonb; i jsonb; ids bigint[]; typ bigint := (SELECT typ FROM t); lista uuid; poz uuid;
  bied integer := (SELECT bied FROM t); lidl integer := (SELECT lidl FROM t); carr integer := (SELECT carr FROM t);
BEGIN
  -- Ekran rodzaju: od najtańszego za kg; podejrzana cena (0,50 zł / 400 g przy medianie 7,48 zł/kg) na końcu.
  x := public.catalog_type(typ);
  SELECT array_agg((p->>'product_id')::bigint ORDER BY nr) INTO ids FROM jsonb_array_elements(x->'products') WITH ORDINALITY a(p, nr);
  IF ids IS DISTINCT FROM ARRAY[99102, 99101, 99103, 99106]::bigint[] THEN RAISE EXCEPTION 'Zła kolejność ekranu rodzaju: %', ids; END IF;
  IF (x->'type'->>'median_unit_price')::numeric <> 7.48 THEN RAISE EXCEPTION 'Zła mediana: %', x->'type'->>'median_unit_price'; END IF;
  IF NOT (x->'products'->3->'offers'->0->>'suspicious')::boolean OR (x->'products'->0->'offers'->0->>'suspicious')::boolean THEN
    RAISE EXCEPTION 'Zła flaga ceny podejrzanej'; END IF;
  IF (x->'type'->'price_from'->>'unit_price')::numeric <> 6.98 THEN RAISE EXCEPTION 'Cena podejrzana w „od X zł”: %', x->'type'->'price_from'; END IF;
  IF (public.catalog_type(typ, lidl)->>'total')::int <> 2 THEN RAISE EXCEPTION 'Filtr sieci nie działa'; END IF;
  -- Wyszukiwanie: z rodzajami najpierw rodzaj, a grupy z samymi produktami w rodzajach znikają; bez parametru jak dotąd.
  x := public.catalog_search('pomidory krojone', 30, 0, true);
  IF x->'items'->0->>'kind' <> 'type' OR (x->'items'->0->>'type_id')::bigint <> typ THEN RAISE EXCEPTION 'Rodzaj nie jest pierwszy: %', x->'items'->0; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE e->>'kind' <> 'type' AND e->>'name' ILIKE '%Beta%') THEN
    RAISE EXCEPTION 'Produkt z rodzaju pokazany osobno'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE e->>'name' ILIKE '%Delta%') THEN
    RAISE EXCEPTION 'Produkt bez rodzaju zniknął z wyników'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.catalog_search('pomidory krojone', 30, 0)->'items') e WHERE e->>'kind' = 'type') THEN
    RAISE EXCEPTION 'Rodzaje bez p_with_types'; END IF;
  x := public.catalog_branch('tluszcze-i-przetwory-przetwory-pomidorowe', 100, 0, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE (e->>'type_id')::bigint = typ) THEN RAISE EXCEPTION 'Brak rodzaju w gałęzi'; END IF;
  IF x->'items'->0->>'kind' <> 'type' THEN RAISE EXCEPTION 'Rodzaje nie są na początku gałęzi'; END IF;

  -- Koszyk: 800 g. Biedronka: Alfa 2×400 g (podejrzane Tanie nie wygrywa), Lidl: Beta, Carrefour: Gamma 4×240 g.
  x := public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'p', 'type_id', typ, 'quantity', 800, 'unit', 'g')));
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = bied;
  IF (i->'pick'->>'product_id')::bigint <> 99101 OR i->>'choice' <> 'cheapest' OR (i->>'total_price')::numeric <> 5.98
    OR (i->>'alternatives_count')::int <> 1 OR NOT (i->'alternatives'->0->>'suspicious')::boolean THEN RAISE EXCEPTION 'Biedronka: %', i; END IF;
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = lidl;
  IF (i->'pick'->>'product_id')::bigint <> 99102 OR (i->>'total_price')::numeric <> 5.58 THEN RAISE EXCEPTION 'Lidl: %', i; END IF;
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = carr;
  IF (i->'pick'->>'package_count')::int <> 4 OR (i->>'total_price')::numeric <> 7.96 THEN RAISE EXCEPTION 'Carrefour: %', i; END IF;
  -- Wybór Alfy w Lidlu: w Lidlu „selected”, w Biedronce ten sam produkt („same_product”), w Carrefourze dalej najtańszy.
  x := public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'p', 'type_id', typ, 'quantity', 2, 'unit', 'szt',
    'store_choices', jsonb_build_object(lidl::text, 99101))));
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = lidl;
  IF (i->'pick'->>'product_id')::bigint <> 99101 OR i->>'choice' <> 'selected' OR (i->'requested'->>'needed')::numeric <> 800
    THEN RAISE EXCEPTION 'Wybór w Lidlu / sztuki: %', i; END IF;
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = bied;
  IF i->>'choice' <> 'same_product' THEN RAISE EXCEPTION 'Ten sam produkt w Biedronce: %', i; END IF;
  SELECT e->'items'->0 INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = carr;
  IF i->>'choice' <> 'cheapest' THEN RAISE EXCEPTION 'Carrefour po wyborze: %', i; END IF;
  -- Pozycje grup działają jak dotąd obok pozycji-rodzajów.
  x := public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'p', 'type_id', typ, 'quantity', 400, 'unit', 'g'),
    jsonb_build_object('id', 'g', 'group_id', (SELECT comparison_group_id FROM public.products WHERE id = 99105), 'quantity', 400, 'unit', 'ml')));
  IF jsonb_array_length(x->'stores'->0->'items') <> 2 THEN RAISE EXCEPTION 'Pozycja grupy obok rodzaju'; END IF;
  BEGIN
    PERFORM public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'p', 'type_id', typ, 'quantity', 400, 'unit', 'ml')));
    RAISE EXCEPTION 'Zła jednostka przyjęta';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- „Pokaż więcej”.
  x := public.basket_type_options(typ, bied, 800, 'g', 1, 1);
  IF (x->>'total')::int <> 2 OR (x->'options'->0->>'product_id')::bigint <> 99106 THEN RAISE EXCEPTION 'Pokaż więcej: %', x; END IF;

  -- Lista: pozycja-rodzaj, sumowanie, wybór produktu w sieci, walidacja.
  INSERT INTO public.shopping_lists(name) VALUES ('Rodzaje') RETURNING id INTO lista;
  SELECT id INTO poz FROM public.add_shopping_type_item(lista, typ, 400, 'g');
  PERFORM public.add_shopping_type_item(lista, typ, 400, 'g');
  IF (SELECT quantity FROM public.shopping_list_items WHERE id = poz) <> 800 THEN RAISE EXCEPTION 'Ilości się nie sumują'; END IF;
  PERFORM public.set_item_store_choice(poz, lidl, 99101);
  IF (SELECT store_choices FROM public.shopping_list_items WHERE id = poz) <> jsonb_build_object(lidl::text, 99101) THEN RAISE EXCEPTION 'Wybór nie zapisany'; END IF;
  BEGIN
    PERFORM public.set_item_store_choice(poz, carr, 99101);   -- Alfy nie ma w Carrefourze
    RAISE EXCEPTION 'Przyjęto produkt spoza sieci';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM public.set_item_store_choice(poz, lidl, NULL);
  IF (SELECT store_choices FROM public.shopping_list_items WHERE id = poz) <> '{}'::jsonb THEN RAISE EXCEPTION 'Wybór nie usunięty'; END IF;
  BEGIN
    PERFORM public.add_shopping_type_item(lista, typ, 1, 'ml');
    RAISE EXCEPTION 'Zła jednostka na liście przyjęta';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- Ulubione rodzaje.
  INSERT INTO public.favorite_types(product_type_id) VALUES (typ);
  IF (SELECT count(*) FROM public.favorite_types) <> 1 THEN RAISE EXCEPTION 'Ulubione rodzaje'; END IF;
END $$;
RESET ROLE;

-- Smaki (podrodzaje): „Alfa” jako smak rodzaju; rodzaj nadrzędny obejmuje produkty smaku.
INSERT INTO public.product_types(slug, name, subcategory_id, unit, parent_id)
SELECT 'test-pomidory-krojone-alfa', 'Pomidory krojone Test Alfa', subcategory_id, unit, id FROM public.product_types WHERE slug = 'test-pomidory-krojone';
INSERT INTO public.product_type_rules(product_type_id, priority, base_product_names, include_pattern)
SELECT id, 4, ARRAY['Pomidory Test'], 'kroj.*alfa' FROM public.product_types WHERE slug = 'test-pomidory-krojone-alfa';
DO $$ DECLARE alfa bigint := (SELECT id FROM public.product_types WHERE slug = 'test-pomidory-krojone-alfa'); BEGIN
  PERFORM public.refresh_product_types();
  IF (SELECT product_type_id FROM public.products WHERE id = 99101) IS DISTINCT FROM alfa THEN RAISE EXCEPTION 'Smak nie przypisany'; END IF;
  IF (SELECT typical_package FROM public.product_types WHERE id = (SELECT typ FROM t)) <> 400 THEN RAISE EXCEPTION 'Typowe opakowanie rodziny'; END IF;
  BEGIN
    INSERT INTO public.product_types(slug, name, subcategory_id, unit, parent_id)
    SELECT 'test-wnuk', 'Wnuk', subcategory_id, unit, id FROM public.product_types WHERE id = alfa;
    RAISE EXCEPTION 'Przyjęto podrodzaj podrodzaju';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    INSERT INTO public.product_types(slug, name, subcategory_id, unit, parent_id)
    SELECT 'test-inna-jednostka', 'Inna jednostka', subcategory_id, 'ml', (SELECT typ FROM t) FROM public.product_types WHERE id = alfa;
    RAISE EXCEPTION 'Przyjęto podrodzaj z inną jednostką';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE x jsonb; i jsonb; typ bigint := (SELECT typ FROM t); alfa bigint := (SELECT id FROM public.product_types WHERE slug = 'test-pomidory-krojone-alfa');
  bied integer := (SELECT bied FROM t); lidl integer := (SELECT lidl FROM t); carr integer := (SELECT carr FROM t); lista uuid; poz uuid;
BEGIN
  x := public.catalog_type(typ);
  IF (x->>'total')::int <> 4 OR jsonb_array_length(x->'subtypes') <> 1 OR (x->'subtypes'->0->>'type_id')::bigint <> alfa
    OR (x->'type'->>'subtype_count')::int <> 1 THEN RAISE EXCEPTION 'Rodzaj nadrzędny bez produktów smaku: %', x; END IF;
  x := public.catalog_type(alfa);
  IF (x->>'total')::int <> 1 OR (x->'type'->'parent'->>'type_id')::bigint <> typ OR jsonb_array_length(x->'subtypes') <> 0 THEN RAISE EXCEPTION 'Ekran smaku: %', x; END IF;
  IF jsonb_array_length(public.catalog_type(typ, carr)->'subtypes') <> 0 THEN RAISE EXCEPTION 'Smak bez ofert w sieci pokazany'; END IF;
  -- gałąź: popularny smak (oferty w >= 2 sieciach: Biedronka, Lidl) stoi zaraz za swoim rodzajem nadrzędnym
  x := public.catalog_branch('tluszcze-i-przetwory-przetwory-pomidorowe', 100, 0, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') WITH ORDINALITY a(e, i)
                 JOIN jsonb_array_elements(x->'items') WITH ORDINALITY b(e, i) ON b.i = a.i + 1
                 WHERE (a.e->>'type_id')::bigint = typ AND (b.e->>'type_id')::bigint = alfa) THEN RAISE EXCEPTION 'Smak nie stoi za rodzajem w gałęzi'; END IF;
  x := public.catalog_search('pomidory krojone test', 30, 0, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') WITH ORDINALITY a(e, i)
                 JOIN jsonb_array_elements(x->'items') WITH ORDINALITY b(e, i) ON b.i = a.i + 1
                 WHERE (a.e->>'type_id')::bigint = typ AND (b.e->>'type_id')::bigint = alfa) THEN RAISE EXCEPTION 'Smak nie stoi za rodzajem w wyszukiwaniu'; END IF;
  x := public.catalog_search('pomidory krojone alfa', 30, 0, true);
  IF (x->'items'->0->>'type_id')::bigint <> alfa THEN RAISE EXCEPTION 'Smak nie jest pierwszy w wyszukiwaniu: %', x->'items'->0; END IF;
  -- rodzaj nadrzędny nie pasuje nazwą („alfa”), a „Alfa” to 1 z 4 jego produktów: od 000500 nie jest pokazywany
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE (e->>'type_id')::bigint = typ) THEN RAISE EXCEPTION 'Rodzaj nadrzędny przez jeden produkt smaku'; END IF;
  -- Porównanie: rodzaj nadrzędny jak przed podziałem (Biedronka: Alfa), smak tylko z produktami smaku.
  x := public.compare_basket(jsonb_build_array(jsonb_build_object('id', 'p', 'type_id', typ, 'quantity', 800, 'unit', 'g'),
    jsonb_build_object('id', 'a', 'type_id', alfa, 'quantity', 400, 'unit', 'g')));
  SELECT e INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = bied;
  IF (i->'items'->0->'pick'->>'product_id')::bigint <> 99101 OR (i->'items'->1->'pick'->>'product_id')::bigint <> 99101 THEN RAISE EXCEPTION 'Biedronka (rodzina): %', i; END IF;
  SELECT e INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = lidl;
  IF (i->'items'->0->'pick'->>'product_id')::bigint <> 99102 OR (i->'items'->1->'pick'->>'product_id')::bigint <> 99101 THEN RAISE EXCEPTION 'Lidl (rodzina): %', i; END IF;
  SELECT e INTO i FROM jsonb_array_elements(x->'stores') e WHERE (e->>'store_id')::int = carr;
  IF i->'items'->1->'pick' IS NOT NULL AND i->'items'->1->'pick' <> 'null'::jsonb THEN RAISE EXCEPTION 'Carrefour ma smak Alfa: %', i->'items'->1; END IF;
  -- Lista: w rodzaju nadrzędnym można wybrać produkt smaku.
  INSERT INTO public.shopping_lists(name) VALUES ('Smaki') RETURNING id INTO lista;
  SELECT id INTO poz FROM public.add_shopping_type_item(lista, typ, 400, 'g');
  PERFORM public.set_item_store_choice(poz, lidl, 99101);
END $$;
RESET ROLE;

-- Wyszukiwanie (migracja 000500): liczby dziesiętne sklejone, dopasowanie nazw całymi słowami.
DO $$ BEGIN
  IF public.catalog_search_glue('mleko uht 3 2% 1 l') <> 'mleko uht 3,2% 1 l' OR public.catalog_search_glue('mleko 1 5 2%') <> 'mleko 1,5 2%'
    OR public.catalog_search_glue('woda 0 5 l') <> 'woda 0,5 l' OR public.catalog_search_glue('mleko 2%') <> 'mleko 2%' THEN
    RAISE EXCEPTION 'Sklejanie liczb'; END IF;
  IF public.catalog_search_match('mleko uht 3,2%', ARRAY['mleko', '2%']) OR NOT public.catalog_search_match('mleko uht 1,5 2%', ARRAY['mleko', '2%']) THEN
    RAISE EXCEPTION '2%% pasuje do 3,2%%'; END IF;
  IF NOT public.catalog_search_name_match('pomidory krojone w puszce', ARRAY['pomidor'])
    OR NOT public.catalog_search_name_match('kielbasa slaska', ARRAY['kielb'])
    OR public.catalog_search_name_match('ciastka z kawalkami czekolady', ARRAY['kawa'])
    OR public.catalog_search_name_match('chipsy serowe', ARRAY['ser'])
    OR NOT public.catalog_search_name_match('ser gouda', ARRAY['ser']) THEN RAISE EXCEPTION 'Dopasowanie nazw'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE x jsonb; typ bigint := (SELECT typ FROM t); BEGIN
  -- „Pomidory krojone Test” (nazwa) jest w wynikach, ilość w zapytaniu nie wyłącza rodzaju
  x := public.catalog_search('pomidory 400 g', 30, 0, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE (e->>'type_id')::bigint = typ) THEN RAISE EXCEPTION 'Ilość wyłączyła rodzaj: %', x; END IF;
  -- produkt „Alfa” pasuje, ale to 1 z 4 produktów rodzaju i nazwa rodzaju nie pasuje: rodzaj nadrzędny nie jest pokazany
  x := public.catalog_search('alfa', 30, 0, true);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x->'items') e WHERE (e->>'type_id')::bigint = typ) THEN RAISE EXCEPTION 'Rodzaj przez jeden produkt: %', x; END IF;
END $$;
RESET ROLE;

-- Migracje 000700 i 000800: prosta odmiana słów, trafienie główne, korekty przypisań i nowe nazwy rodzajów.
DO $$ BEGIN
  IF NOT public.catalog_search_name_match('ice tea cytrynowa', ARRAY['cytryna'])
    OR NOT public.catalog_search_name_match('sok jablkowy 100%', ARRAY['jablka'])
    OR NOT public.catalog_search_name_match('mus owocowy bananowy', ARRAY['banany'])
    OR public.catalog_search_name_match('ciastka z kawalkami czekolady', ARRAY['kawa'])
    OR public.catalog_search_name_match('mlekovita ser gouda', ARRAY['mleko'])
    OR public.catalog_search_name_match('mleko uht', ARRAY['mlek', 'uht']) THEN RAISE EXCEPTION 'Odmiana słów'; END IF;
  IF public.catalog_search_stems(ARRAY['cytryna', 'kawa', 'pomidory']) <> ARRAY['cytryn', 'kawa', 'pomidor'] THEN RAISE EXCEPTION 'Rdzenie słów'; END IF;
  IF NOT public.catalog_search_primary('pomidory krojone w puszce', ARRAY['pomidor'])
    OR NOT public.catalog_search_primary('filet z piersi kurczaka', ARRAY['kurczak'])
    OR public.catalog_search_primary('golabki w sosie pomidorowym', ARRAY['pomidor'])
    OR public.catalog_search_primary('pesto czerwone z suszonymi pomidorami', ARRAY['pomidor'])
    OR public.catalog_search_primary('mus owocowy truskawkowy', ARRAY['truskawki'])
    OR public.catalog_search_primary('pierogi z serem', ARRAY['ser'])
    OR NOT public.catalog_search_primary('jogurt truskawkowy', ARRAY['jogurt', 'truskawkowy']) THEN RAISE EXCEPTION 'Trafienie główne'; END IF;
  IF (SELECT count(*) FROM public.product_type_rules WHERE note = 'korekta' AND priority < 0) < 50 THEN RAISE EXCEPTION 'Brak korekt'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_types WHERE slug = 'napoj-mleczny-smakowy' AND name = 'Mleko smakowe (napój mleczny)') THEN
    RAISE EXCEPTION 'Nowa nazwa rodzaju'; END IF;
END $$;

-- Pilot z migracji: rodzaje i reguły są wczytane.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.product_types WHERE slug <> 'test-pomidory-krojone') < 80 THEN RAISE EXCEPTION 'Brak rodzajów pilota'; END IF;
END $$;
ROLLBACK;
SELECT 'Product types: rule/review assignment, typical package, suspicious prices, type screen, search/branch, basket choices, more options, lists and favorites passed.' AS result;
