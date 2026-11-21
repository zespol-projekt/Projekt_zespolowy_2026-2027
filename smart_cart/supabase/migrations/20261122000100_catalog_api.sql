-- API katalogu v1 dla aplikacji (21.11.2026): drzewo kategorii, gałąź, wyszukiwanie, grupa i produkt.
-- Tylko nowe funkcje; istniejące (search_product_groups, catalog_offers, add_shopping_item, compare_basket) bez zmian.
-- Wszystkie funkcje: tylko odczyt, uprawnienia wywołującego (RLS), wymagają potwierdzonego konta (can_read_catalog).
-- Ceny: price_today = cena 1 opakowania dziś (regularna 'prawdziwa' albo promocja naliczana automatycznie, niższa);
-- unit_price_today = ta cena przeliczona na 1 kg / 1 l / 1 szt. „Od X zł” liczymy z unit_price_today, nigdy z cen
-- opakowań o różnych rozmiarach. Produkty bazowe bez podkategorii (np. piwo) nie są pokazywane.
-- Kontrakt z przykładami: docs/api-katalogu.md.

-- Etap Nabiał -> Mleko: reguły v3 i przegląd ręczny zakończone 21.11.2026 (docs/mleko.md).
UPDATE public.catalog_subcategories SET verification_status = 'reviewed' WHERE slug = 'nabial-mleko';

CREATE FUNCTION public.catalog_search_norm(t text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  -- „3,2%”, „3.2%” i „3,2 %” dają to samo; polskie znaki i wielkość liter bez znaczenia (norm_text).
  SELECT regexp_replace(public.norm_text(t), ' %', '%', 'g');
$$;

CREATE FUNCTION public.catalog_require_reader() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  -- Administrator (service_role, połączenie psql jako postgres) też może czytać, np. do raportów i przykładów kontraktu.
  IF NOT (public.can_read_catalog() OR current_user IN ('service_role', 'postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'Zaloguj się potwierdzonym kontem, aby przeglądać katalog.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Jednostka ceny jednostkowej dla jednostki produktu.
CREATE FUNCTION public.catalog_unit_label(u text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE u WHEN 'g' THEN '1 kg' WHEN 'ml' THEN '1 l' ELSE '1 szt' END;
$$;

-- Oferta w formacie API (z widoku catalog_offers, z uprawnieniami wywołującego).
CREATE FUNCTION public.catalog_offer(p_offer_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'offer_id', o.offer_id,
    'product_id', o.product_id,
    'store', jsonb_build_object('id', o.store_id, 'slug', o.store_slug, 'name', o.store_name),
    'store_product_name', o.product_name,
    'regular_price', o.regular_price,
    'regular_price_status', o.price_status,
    'regular_price_observed_at', o.regular_price_observed_at,
    'price_source', o.price_source,
    'promotion', CASE WHEN o.promo_price IS NOT NULL OR o.promo_type IS NOT NULL THEN jsonb_build_object(
      'price', o.promo_price, 'type', o.promo_type, 'condition', o.promo_condition,
      'valid_from', o.valid_from, 'valid_to', o.valid_to, 'scope', o.promo_scope, 'price_status', o.promo_price_status,
      'rule', o.promo_rule, 'evidence_url', o.promo_evidence_url,
      'applies_today', o.verified_promotion,
      'requires_card', coalesce((o.promo_rule->>'requires_card')::boolean, false),
      'requires_activation', coalesce((o.promo_rule->>'requires_activation')::boolean, false)) END,
    'price_today', o.single_price,
    'price_today_basis', CASE WHEN o.single_price IS NULL THEN NULL
      WHEN o.verified_promotion AND (o.price_status <> 'prawdziwa' OR o.regular_price IS NULL OR o.single_price < o.regular_price) THEN 'promotion'
      ELSE 'regular' END,
    'unit_price_today', CASE WHEN o.single_price IS NOT NULL AND o.quantity_value > 0
      THEN round(o.single_price / o.quantity_value * CASE WHEN o.quantity_unit IN ('g', 'ml') THEN 1000 ELSE 1 END, 2) END,
    'unit_price_per', public.catalog_unit_label(o.quantity_unit),
    'image_url', o.image_url)
  FROM public.catalog_offers o WHERE o.offer_id = p_offer_id;
$$;

-- Element listy (wynik gałęzi i wyszukiwania): grupa zamienników albo pojedynczy produkt. Liczby z wszystkich ofert.
CREATE FUNCTION public.catalog_item(p_group_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH o AS (
    SELECT c.*, CASE WHEN c.single_price IS NOT NULL AND c.quantity_value > 0
      THEN round(c.single_price / c.quantity_value * CASE WHEN c.quantity_unit IN ('g', 'ml') THEN 1000 ELSE 1 END, 2) END AS unit_price
    FROM public.catalog_offers c
    JOIN public.base_products bp ON bp.id = c.base_product_id AND bp.subcategory_id IS NOT NULL
    WHERE c.group_id = p_group_id
  ), best AS (
    SELECT * FROM o WHERE unit_price IS NOT NULL ORDER BY unit_price, single_price, offer_id LIMIT 1
  )
  SELECT jsonb_build_object(
    'kind', CASE WHEN g.group_key LIKE 'product:%' THEN 'product' ELSE 'group' END,
    'group_id', g.id,
    'product_id', CASE WHEN g.group_key LIKE 'product:%' THEN (SELECT min(product_id) FROM o) END,
    'name', g.name,
    'unit', g.unit,
    'default_quantity', CASE WHEN g.unit IN ('g', 'ml') THEN 1000 ELSE 1 END,
    'product_count', (SELECT count(DISTINCT product_id) FROM o),
    'offer_count', (SELECT count(*) FROM o),
    'store_count', (SELECT count(DISTINCT store_id) FROM o),
    'stores_with_price_today', (SELECT count(DISTINCT store_id) FROM o WHERE single_price IS NOT NULL),
    'price_from', (SELECT jsonb_build_object('unit_price', b.unit_price, 'unit_price_per', public.catalog_unit_label(b.quantity_unit),
        'package_price', b.single_price, 'package_quantity', b.quantity_value, 'package_unit', b.quantity_unit,
        'store', jsonb_build_object('id', b.store_id, 'slug', b.store_slug, 'name', b.store_name),
        'offer_id', b.offer_id) FROM best b),
    'image_url', (SELECT image_url FROM o WHERE image_url IS NOT NULL ORDER BY single_price NULLS LAST, offer_id LIMIT 1))
  FROM public.comparison_groups g WHERE g.id = p_group_id;
$$;

-- 1. Drzewo: kategorie -> podkategorie, z kolejnością, statusem weryfikacji i liczbami (produkty z ofertą, oferty).
CREATE FUNCTION public.catalog_tree() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE wynik jsonb;
BEGIN
  PERFORM public.catalog_require_reader();
  WITH liczby AS (
    SELECT bp.subcategory_id, count(DISTINCT so.product_id) AS products, count(*) AS offers
    FROM public.store_offers so JOIN public.stores s ON s.id = so.store_id AND s.is_active
    JOIN public.products p ON p.id = so.product_id JOIN public.base_products bp ON bp.id = p.base_product_id
    WHERE bp.subcategory_id IS NOT NULL GROUP BY 1
  ), podkat AS (
    SELECT sc.category_id, jsonb_agg(jsonb_build_object(
      'id', sc.id, 'slug', sc.slug, 'parent_slug', c.slug, 'name', sc.name, 'order', sc.display_order,
      'verification_status', sc.verification_status,
      'product_count', coalesce(l.products, 0), 'offer_count', coalesce(l.offers, 0),
      'has_items', coalesce(l.products, 0) > 0) ORDER BY sc.display_order, sc.name) AS dzieci,
      sum(coalesce(l.products, 0)) AS products, sum(coalesce(l.offers, 0)) AS offers
    FROM public.catalog_subcategories sc JOIN public.categories c ON c.id = sc.category_id
    LEFT JOIN liczby l ON l.subcategory_id = sc.id GROUP BY sc.category_id
  )
  SELECT jsonb_build_object('version', 1, 'categories', coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'parent_slug', NULL, 'name', c.name, 'order', c.display_order,
    'product_count', coalesce(pk.products, 0), 'offer_count', coalesce(pk.offers, 0),
    'children', coalesce(pk.dzieci, '[]'::jsonb)) ORDER BY c.display_order NULLS LAST, c.name), '[]'::jsonb))
  INTO wynik
  FROM public.categories c LEFT JOIN podkat pk ON pk.category_id = c.id
  WHERE c.slug IS NOT NULL;
  RETURN wynik;
END;
$$;

-- 2. Gałąź (podkategoria): grupy zamienników i pojedyncze produkty, z paginacją.
CREATE FUNCTION public.catalog_branch(p_subcategory text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE sc record; lim integer := greatest(1, least(coalesce(p_limit, 30), 100)); off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint; items jsonb;
BEGIN
  PERFORM public.catalog_require_reader();
  SELECT s.id, s.slug, s.name, s.verification_status, c.slug AS category_slug, c.name AS category_name INTO sc
  FROM public.catalog_subcategories s JOIN public.categories c ON c.id = s.category_id WHERE s.slug = p_subcategory;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie ma takiej podkategorii.' USING ERRCODE = 'PT404'; END IF;
  WITH grupy AS (
    SELECT g.id, g.name, g.group_key FROM public.comparison_groups g
    WHERE EXISTS (SELECT 1 FROM public.products p JOIN public.base_products bp ON bp.id = p.base_product_id
      JOIN public.store_offers so ON so.product_id = p.id JOIN public.stores st ON st.id = so.store_id AND st.is_active
      WHERE p.comparison_group_id = g.id AND bp.subcategory_id = sc.id)
  )
  SELECT (SELECT count(*) FROM grupy),
    (SELECT coalesce(jsonb_agg(public.catalog_item(x.id) ORDER BY x.produkt, x.name, x.id), '[]'::jsonb)
     FROM (SELECT id, name, group_key LIKE 'product:%' AS produkt FROM grupy ORDER BY 3, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1,
    'subcategory', jsonb_build_object('id', sc.id, 'slug', sc.slug, 'name', sc.name, 'verification_status', sc.verification_status,
      'category', jsonb_build_object('slug', sc.category_slug, 'name', sc.category_name)),
    'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

-- 3. Wyszukiwanie globalne: wszystkie słowa zapytania w nazwie grupy, produktów lub produktu bazowego.
CREATE FUNCTION public.catalog_search(p_query text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE q text := public.catalog_search_norm(left(coalesce(p_query, ''), 200)); toks text[];
  lim integer := greatest(1, least(coalesce(p_limit, 30), 100)); off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint; items jsonb;
BEGIN
  PERFORM public.catalog_require_reader();
  toks := array_remove(string_to_array(q, ' '), '');
  IF coalesce(array_length(toks, 1), 0) = 0 THEN
    RETURN jsonb_build_object('version', 1, 'query', q, 'total', 0, 'limit', lim, 'offset', off, 'items', '[]'::jsonb);
  END IF;
  WITH kandydaci AS (
    SELECT g.id, g.name, g.group_key, public.catalog_search_norm(g.name) AS gn,
      public.catalog_search_norm(string_agg(p.canonical_name || ' ' || bp.name, ' ')) AS txt
    FROM public.comparison_groups g
    JOIN public.products p ON p.comparison_group_id = g.id
    JOIN public.base_products bp ON bp.id = p.base_product_id AND bp.subcategory_id IS NOT NULL
    WHERE EXISTS (SELECT 1 FROM public.store_offers so JOIN public.stores st ON st.id = so.store_id AND st.is_active WHERE so.product_id = p.id)
    GROUP BY g.id
  ), trafienia AS (
    SELECT k.id, k.name, (CASE WHEN k.gn = q THEN 200 WHEN k.gn LIKE q || '%' THEN 150
        WHEN NOT EXISTS (SELECT 1 FROM unnest(toks) t WHERE position(t IN k.gn) = 0) THEN 120 ELSE 60 END
      + CASE WHEN k.group_key LIKE 'product:%' THEN 0 ELSE 40 END) AS score
    FROM kandydaci k
    WHERE NOT EXISTS (SELECT 1 FROM unnest(toks) t WHERE position(t IN (k.gn || ' ' || k.txt)) = 0)
  )
  SELECT (SELECT count(*) FROM trafienia),
    (SELECT coalesce(jsonb_agg(public.catalog_item(x.id) ORDER BY x.score DESC, x.name, x.id), '[]'::jsonb)
     FROM (SELECT * FROM trafienia ORDER BY score DESC, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1, 'query', q, 'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

-- 4. Grupa: wszystkie produkty grupy z ofertami sieci (do ekranu porównania i wyboru produktu).
CREATE FUNCTION public.catalog_group(p_group_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE item jsonb; produkty jsonb; sciezka jsonb;
BEGIN
  PERFORM public.catalog_require_reader();
  item := public.catalog_item(p_group_id);
  IF item IS NULL OR (item->>'offer_count')::int = 0 THEN RAISE EXCEPTION 'Nie ma takiej grupy.' USING ERRCODE = 'PT404'; END IF;
  SELECT jsonb_build_object('category', jsonb_build_object('slug', c.slug, 'name', c.name),
    'subcategory', jsonb_build_object('slug', s.slug, 'name', s.name, 'verification_status', s.verification_status))
  INTO sciezka
  FROM public.products p JOIN public.base_products bp ON bp.id = p.base_product_id
  JOIN public.catalog_subcategories s ON s.id = bp.subcategory_id JOIN public.categories c ON c.id = s.category_id
  WHERE p.comparison_group_id = p_group_id GROUP BY c.slug, c.name, s.slug, s.name, s.verification_status
  ORDER BY count(*) DESC, s.slug LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id, 'name', p.canonical_name, 'ean', p.ean,
    'package', jsonb_build_object('quantity', p.quantity_value, 'unit', p.quantity_unit, 'label', p.gramatura_norm),
    'sale_mode', p.sale_mode, 'image_url', p.image_url,
    'offers', (SELECT coalesce(jsonb_agg(public.catalog_offer(o.offer_id) ORDER BY o.single_price NULLS LAST, o.store_id), '[]'::jsonb)
               FROM public.catalog_offers o WHERE o.product_id = p.id))
    ORDER BY (SELECT min(o.single_price / nullif(p.quantity_value, 0)) FROM public.catalog_offers o WHERE o.product_id = p.id) NULLS LAST, p.canonical_name, p.id), '[]'::jsonb)
  INTO produkty
  FROM public.products p JOIN public.base_products bp ON bp.id = p.base_product_id AND bp.subcategory_id IS NOT NULL
  WHERE p.comparison_group_id = p_group_id AND EXISTS (SELECT 1 FROM public.catalog_offers o WHERE o.product_id = p.id);
  RETURN jsonb_build_object('version', 1, 'group', item || jsonb_build_object('path', sciezka), 'products', produkty);
END;
$$;

-- 5. Produkt: dane, grupa, ścieżka, oferty sieci i ostatnie zmiany cen.
CREATE FUNCTION public.catalog_product(p_product_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE p record; oferty jsonb;
BEGIN
  PERFORM public.catalog_require_reader();
  SELECT pr.*, g.name AS group_name, g.group_key, g.unit AS group_unit,
    c.slug AS category_slug, c.name AS category_name, s.slug AS sub_slug, s.name AS sub_name, s.verification_status
  INTO p FROM public.products pr JOIN public.comparison_groups g ON g.id = pr.comparison_group_id
  JOIN public.base_products bp ON bp.id = pr.base_product_id
  JOIN public.catalog_subcategories s ON s.id = bp.subcategory_id JOIN public.categories c ON c.id = s.category_id
  WHERE pr.id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie ma takiego produktu.' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(jsonb_agg(public.catalog_offer(o.offer_id) || jsonb_build_object('history',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('regular_price', h.regular_price, 'promo_price', h.promo_price,
         'price_source', h.price_source, 'recorded_at', h.recorded_at) ORDER BY h.recorded_at DESC), '[]'::jsonb)
       FROM (SELECT * FROM public.price_history ph WHERE ph.store_offer_id = o.offer_id ORDER BY ph.recorded_at DESC LIMIT 10) h))
    ORDER BY o.single_price NULLS LAST, o.store_id), '[]'::jsonb)
  INTO oferty FROM public.catalog_offers o WHERE o.product_id = p_product_id;
  RETURN jsonb_build_object('version', 1, 'product', jsonb_build_object(
    'product_id', p.id, 'name', p.canonical_name, 'ean', p.ean,
    'package', jsonb_build_object('quantity', p.quantity_value, 'unit', p.quantity_unit, 'label', p.gramatura_norm),
    'sale_mode', p.sale_mode, 'image_url', p.image_url,
    'group', jsonb_build_object('group_id', p.comparison_group_id, 'name', p.group_name, 'unit', p.group_unit,
      'kind', CASE WHEN p.group_key LIKE 'product:%' THEN 'product' ELSE 'group' END),
    'path', jsonb_build_object('category', jsonb_build_object('slug', p.category_slug, 'name', p.category_name),
      'subcategory', jsonb_build_object('slug', p.sub_slug, 'name', p.sub_name, 'verification_status', p.verification_status))),
    'offers', oferty);
END;
$$;

DO $grants$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['catalog_search_norm(text)', 'catalog_require_reader()', 'catalog_unit_label(text)', 'catalog_offer(bigint)',
    'catalog_item(bigint)', 'catalog_tree()', 'catalog_branch(text, integer, integer)', 'catalog_search(text, integer, integer)',
    'catalog_group(bigint)', 'catalog_product(bigint)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $grants$;

NOTIFY pgrst, 'reload schema';
