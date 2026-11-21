-- Reguły mleka v3: grupy, skróty, marki, wykluczenia, ponowna klasyfikacja z ochroną list. Dane są wycofywane.
BEGIN;
INSERT INTO public.base_products(id, category_id, name) SELECT 96001, id, 'Mleko testowe' FROM public.categories WHERE slug = 'nabial';
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit) VALUES
  (96101, 't:1', 96001, 'MLEKO UHT BEZ LAKT. 3,2% MLECZ.DOL. 1 l', 1000, 'ml'),
  (96102, 't:2', 96001, 'Łaciate Mleko UHT 3,2% bez laktozy 1 l', 1000, 'ml'),
  (96103, 't:3', 96001, 'MLEKO UHT 3,2% MAZURSKI SMAK 1l', 1000, 'ml'),
  (96104, 't:4', 96001, 'Mlekovita Mleko UHT 3,2% 1 l', 1000, 'ml'),
  (96105, 't:5', 96001, 'Łaciate Mleko UHT 3,2% o smaku truskawkowym 200 ml', 200, 'ml'),
  (96106, 't:6', 96001, 'MLEKO ZAGĘSZCZONE UHT 7,5% 500 ml', 500, 'ml'),
  (96107, 't:7', 96001, 'Mleko UHT 2% 1 l', 1000, 'ml'),
  (96108, 't:8', 96001, 'Mleko świeże 3,2% 1 l', 1000, 'ml'),
  (96109, 't:9', 96001, 'MLEKO SPOŻYWCZE BIO UHT 2% 1l', 1000, 'ml'),
  (96110, 't:10', 96001, 'Mleko kozie UHT 2,8% 0,5 l', 500, 'ml'),
  (96111, 't:11', 96001, 'NAPÓJ ROŚLINNY NIE-MLEKO UHT 2% 1l', 1000, 'ml'),
  (96112, 't:12', 96001, 'MLEKO UHT BARISTA 3,2% 1l', 1000, 'ml'),
  (96113, 't:13', 96001, 'MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l', 1000, 'ml'),
  (96114, 't:14', 96001, 'Mleko UHT 3,2% 1 l w proszku', 1000, 'ml'),
  (96115, 't:15', 96001, 'Mleko UHT 3,2% 6x500 ml', 3000, 'ml');

DO $$
DECLARE klucz text;
BEGIN
  FOR klucz IN SELECT format('%s=%s', p.id, g.group_key) FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id
    WHERE p.id BETWEEN 96101 AND 96115 ORDER BY p.id LOOP RAISE NOTICE '%', klucz; END LOOP;
  IF (SELECT array_agg(g.group_key ORDER BY p.id) FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id
      WHERE p.id IN (96101, 96102, 96103, 96104, 96107, 96108, 96109, 96110, 96115)) <> ARRAY[
      'milk:uht:3.2:bez laktozy', 'milk:uht:3.2:bez laktozy',           -- skrót BEZ LAKT. = pełny zapis, różne marki razem
      'milk:uht:3.2:z laktozą', 'milk:uht:3.2:z laktozą',               -- Mazurski Smak to marka
      'milk:uht:2:z laktozą', 'milk:świeże:3.2:z laktozą',              -- inny tłuszcz i świeże osobno
      'milk:uht:2:z laktozą:organic', 'milk:uht:2.8:z laktozą:goat',    -- ekologiczne i kozie osobno
      'milk:uht:3.2:z laktozą'] THEN                                    -- wielopak w tej samej grupie (cena za ml)
    RAISE EXCEPTION 'Złe grupy mleka: %', (SELECT array_agg(g.group_key ORDER BY p.id) FROM public.products p
      JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id IN (96101, 96102, 96103, 96104, 96107, 96108, 96109, 96110, 96115));
  END IF;
  -- Smakowe, zagęszczone, roślinne, barista, w proszku i bez rodzaju (UHT/świeże) zostają osobno.
  IF EXISTS (SELECT 1 FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id
      WHERE p.id IN (96105, 96106, 96111, 96112, 96113, 96114) AND g.group_key NOT LIKE 'product:%') THEN
    RAISE EXCEPTION 'Wariant/niepewne mleko trafiło do wspólnej grupy'; END IF;
  IF (SELECT name FROM public.comparison_groups WHERE group_key = 'milk:uht:3.2:bez laktozy') <> 'Mleko UHT 3,2% · bez laktozy' THEN
    RAISE EXCEPTION 'Zła nazwa grupy'; END IF;
  IF public.milk_group('świeże', 2.0, 'z laktozą', 'x') <> ARRAY['milk:świeże:2:z laktozą', 'Mleko świeże 2% · z laktozą']
    OR public.milk_group('UHT', 1.50, 'bez laktozy', 'x')::text <> '{"milk:uht:1.5:bez laktozy","Mleko UHT 1,5% · bez laktozy"}'
    OR public.milk_group('UHT', 3.2, 'nie wiem', 'x') IS NOT NULL OR public.milk_group('pasteryzowane', 3.2, 'z laktozą', 'x') IS NOT NULL THEN
    RAISE EXCEPTION 'milk_group zwraca złe klucze'; END IF;
END $$;

-- Decyzja ręczna przetrwa zmianę nazwy (import) - reguła jej nie nadpisuje.
UPDATE public.products SET comparison_group_id = (SELECT id FROM public.comparison_groups WHERE group_key = 'milk:uht:3.2:z laktozą'),
  classification_source = 'reviewed' WHERE id = 96113;
UPDATE public.products SET canonical_name = 'MLEKO ŁOWICKIE 3,2% EKO KARTON 1 l (nowa nazwa)' WHERE id = 96113;
DO $$ BEGIN
  IF (SELECT g.group_key FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id = 96113) <> 'milk:uht:3.2:z laktozą'
    THEN RAISE EXCEPTION 'Reguła nadpisała decyzję ręczną'; END IF;
END $$;

-- Ponowna klasyfikacja „na istniejących danych”: produkt w starej grupie produktowej, używanej na liście zakupów.
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES ('96000000-0000-4000-8000-000000000001', 'mleko@example.invalid', now(), false);
INSERT INTO public.shopping_lists(id, owner_id, name) VALUES ('96000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001', 'Test');
INSERT INTO public.comparison_groups(group_key, base_product_id, name, normalized_name, unit) VALUES
  ('product:96101', 96001, 'Stara grupa', 'stara grupa', 'ml'), ('product:96999', 96001, 'Pusta', 'pusta', 'ml');
UPDATE public.products SET comparison_group_id = (SELECT id FROM public.comparison_groups WHERE group_key = 'product:96101'),
  classification_source = 'name_rule_v2' WHERE id = 96101;
INSERT INTO public.shopping_list_items(list_id, group_id, quantity, unit)
SELECT '96000000-0000-4000-8000-000000000002', id, 2, 'ml' FROM public.comparison_groups WHERE group_key = 'product:96101';
INSERT INTO public.favorite_groups(owner_id, group_id) SELECT '96000000-0000-4000-8000-000000000001', id FROM public.comparison_groups WHERE group_key = 'product:96101';
-- Druga stara grupa produktowa bez odwołań (produkt 96104 był w niej przed regułami v3).
UPDATE public.products SET comparison_group_id = (SELECT id FROM public.comparison_groups WHERE group_key = 'product:96999'),
  classification_source = 'name_rule_v2' WHERE id = 96104;

DO $$ DECLARE w jsonb := public.reclassify_milk('test reguł mleka'); nowa bigint;
BEGIN
  nowa := (SELECT id FROM public.comparison_groups WHERE group_key = 'milk:uht:3.2:bez laktozy');
  IF (SELECT comparison_group_id FROM public.products WHERE id = 96101) <> nowa THEN RAISE EXCEPTION 'Produkt nie trafił do nowej grupy'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shopping_list_items WHERE group_id = nowa) THEN RAISE EXCEPTION 'Pozycja listy została porzucona'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.favorite_groups WHERE group_id = nowa) THEN RAISE EXCEPTION 'Ulubione zostały porzucone'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comparison_group_redirects r JOIN public.comparison_groups g ON g.id = r.new_group_id
      WHERE g.group_key = 'milk:uht:3.2:bez laktozy') THEN RAISE EXCEPTION 'Brak przekierowania starej grupy'; END IF;
  IF EXISTS (SELECT 1 FROM public.comparison_groups WHERE group_key = 'product:96999') THEN RAISE EXCEPTION 'Została pusta grupa bez odwołań'; END IF;
  IF (SELECT g.group_key FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id = 96113) <> 'milk:uht:3.2:z laktozą'
    THEN RAISE EXCEPTION 'Ponowna klasyfikacja ruszyła decyzję ręczną'; END IF;
  IF (w->>'merged_groups')::int < 1 OR (w->>'deleted_empty_groups')::int < 1 THEN RAISE EXCEPTION 'Zły raport: %', w; END IF;
END $$;

-- Uprawnienia: rejestr przeglądu i funkcje administracyjne nie są dostępne dla kont.
SELECT set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.catalog_reviews; RAISE EXCEPTION 'Konto czyta rejestr przeglądu';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.reclassify_milk('x'); RAISE EXCEPTION 'Konto uruchamia klasyfikację';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Milk rules: BEZ LAKT. abbreviation, brand vs flavour, fat/UHT/fresh/organic/goat separation, exclusions, reviewed decisions kept, reclassification keeps lists/favorites passed.' AS result;
