-- Disposable local database only. Drzewo katalogu, przekierowania grup i uprawnienia. Wszystko wycofywane.
BEGIN;
DO $$ BEGIN
  IF (SELECT string_agg(name, '|' ORDER BY display_order) FROM public.categories WHERE slug IS NOT NULL)
     <> 'Warzywa i Owoce|Pieczywo|Nabiał|Mięso i Ryby|Mrożonki i Gotowe|Sypkie i Makarony|Tłuszcze i Przetwory|Przyprawy i Pieczenie|Napoje|Słodycze i Przekąski'
  THEN RAISE EXCEPTION 'Kolejność kategorii niezgodna z ustaleniem'; END IF;
  IF (SELECT count(*) FROM public.catalog_subcategories) <> 50 THEN RAISE EXCEPTION 'Oczekiwano 50 podkategorii (bez piwa)'; END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_subcategories WHERE slug = 'napoje-piwo') THEN RAISE EXCEPTION 'Piwo nadal w drzewie'; END IF;
  IF (SELECT count(*) FROM public.base_products WHERE name LIKE 'Pozostał%' AND subcategory_id IS NOT NULL) <> 40 THEN
    RAISE EXCEPTION 'Nowe produkty bazowe bez podkategorii'; END IF;
  IF (SELECT verification_status FROM public.catalog_subcategories WHERE slug = 'nabial-mleko') <> 'in_progress' THEN
    RAISE EXCEPTION 'Mleko powinno mieć status in_progress'; END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_subcategories s JOIN public.categories c ON c.id = s.category_id
             GROUP BY s.category_id HAVING count(*) <> max(s.display_order)) THEN
    RAISE EXCEPTION 'Kolejność podkategorii ma luki'; END IF;
END $$;

-- Produkt bazowy nie może wskazać podkategorii innej kategorii.
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES
  ('44444444-4444-4444-8444-444444444444', 'tree-a@example.invalid', now(), false),
  ('55555555-5555-4555-8555-555555555555', 'tree-b@example.invalid', now(), false);
INSERT INTO public.base_products(id, category_id, name)
SELECT 92001, id, 'Test drzewa' FROM public.categories WHERE slug = 'pieczywo';
DO $$ BEGIN
  BEGIN
    UPDATE public.base_products SET subcategory_id = (SELECT id FROM public.catalog_subcategories WHERE slug = 'nabial-mleko') WHERE id = 92001;
    RAISE EXCEPTION 'Podkategoria z innej kategorii przyjęta';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
UPDATE public.base_products SET subcategory_id = (SELECT id FROM public.catalog_subcategories WHERE slug = 'pieczywo-chleb') WHERE id = 92001;

-- Scalanie grup: produkty, pozycje list (przeniesienie i połączenie ilości) oraz ulubione.
INSERT INTO public.comparison_groups(id, group_key, base_product_id, name, normalized_name, unit) VALUES
  (92101, 'reviewed:tree:old', 92001, 'Stara grupa', 'stara grupa', 'ml'),
  (92102, 'reviewed:tree:new', 92001, 'Nowa grupa', 'nowa grupa', 'ml'),
  (92103, 'reviewed:tree:grams', 92001, 'Grupa w gramach', 'grupa w gramach', 'g'),
  (92104, 'reviewed:tree:other', 92001, 'Inna grupa', 'inna grupa', 'ml');
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit) VALUES
  (92201, 'tree:old', 92001, 'Produkt starej grupy 1l', 1000, 'ml'),
  (92202, 'tree:new', 92001, 'Produkt nowej grupy 1l', 1000, 'ml');
UPDATE public.products SET comparison_group_id = 92101, classification_source = 'reviewed' WHERE id = 92201;
UPDATE public.products SET comparison_group_id = 92102, classification_source = 'reviewed' WHERE id = 92202;
INSERT INTO public.shopping_lists(id, owner_id, name) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'Obie grupy'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555', 'Tylko stara');
INSERT INTO public.shopping_list_items(list_id, group_id, quantity, unit, selected_product_id) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 92101, 500, 'ml', 92201),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 92102, 1000, 'ml', NULL),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 92101, 750, 'ml', 92201);
INSERT INTO public.favorite_groups(owner_id, group_id) VALUES
  ('44444444-4444-4444-8444-444444444444', 92101), ('44444444-4444-4444-8444-444444444444', 92102),
  ('55555555-5555-4555-8555-555555555555', 92101);
DO $$ DECLARE r jsonb; BEGIN
  BEGIN PERFORM public.merge_comparison_group(92101, 92103, 'test'); RAISE EXCEPTION 'Scalono różne jednostki';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.merge_comparison_group(92101, 92102, 'Ten sam rodzaj produktu');
  IF r <> '{"products": 1, "moved_items": 1, "merged_items": 1, "favorites": 2}'::jsonb THEN RAISE EXCEPTION 'Wynik scalenia: %', r; END IF;
  IF (SELECT quantity FROM public.shopping_list_items WHERE list_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND group_id = 92102) <> 1500 THEN
    RAISE EXCEPTION 'Ilości nie zostały połączone'; END IF;
  IF EXISTS (SELECT 1 FROM public.shopping_list_items WHERE group_id = 92101) OR EXISTS (SELECT 1 FROM public.favorite_groups WHERE group_id = 92101) THEN
    RAISE EXCEPTION 'Zostały odwołania do starej grupy'; END IF;
  IF (SELECT selected_product_id FROM public.shopping_list_items WHERE list_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 92201 THEN
    RAISE EXCEPTION 'Utracono wybrany produkt'; END IF;
  IF (SELECT count(*) FROM public.favorite_groups WHERE group_id = 92102) <> 2 THEN RAISE EXCEPTION 'Ulubione nie zostały przeniesione'; END IF;
  IF (SELECT new_group_id FROM public.comparison_group_redirects WHERE old_group_id = 92101) <> 92102 THEN RAISE EXCEPTION 'Brak przekierowania'; END IF;
  BEGIN PERFORM public.merge_comparison_group(92104, 92101, 'test'); RAISE EXCEPTION 'Przekierowano na przekierowaną grupę';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- Uprawnienia: potwierdzone konto czyta drzewo; nie widzi przekierowań ani importów i nie scala grup.
SELECT set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.catalog_subcategories) <> 50 THEN RAISE EXCEPTION 'Potwierdzone konto nie widzi podkategorii'; END IF;
  BEGIN PERFORM 1 FROM public.comparison_group_redirects; RAISE EXCEPTION 'Przekierowania widoczne dla konta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.import_runs; RAISE EXCEPTION 'Rejestr importów widoczny dla konta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.merge_comparison_group(92102, 92101, 'x'); RAISE EXCEPTION 'Konto może scalać grupy';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.catalog_subcategories(category_id, slug, name, display_order) VALUES (1, 'x', 'X', 99);
    RAISE EXCEPTION 'Konto może zapisywać podkategorie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.catalog_subcategories; RAISE EXCEPTION 'Gość widzi podkategorie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Catalog tree checks: category order, subcategories, cross-category guard, group merge with lists/favorites, permissions passed.' AS result;
