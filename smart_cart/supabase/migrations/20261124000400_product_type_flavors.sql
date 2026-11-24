-- Smaki (24.11.2026): podrodzaje rodzajów, np. „Chipsy ziemniaczane” -> „Chipsy ziemniaczane paprykowe”.
-- Klient dodaje do listy rodzaj nadrzędny (dowolny smak, jak dotąd) albo konkretny smak. Rodzaj nadrzędny obejmuje
-- produkty wszystkich swoich smaków; produkty „mix” / „różne rodzaje” należą tylko do niego.
-- Smaki wygenerowane skryptem Dane_sklepy_current/rodzaje_produktow/generuj_smaki.py (smaki.py): 152 podrodzajów
-- w 33 rodzajach. Reguła smaku = reguła rodzaju nadrzędnego + wzorzec smaku, ustawiona tuż przed nią.

-- Przeliczenie rodzajów trwa na wspólnej bazie dłużej niż jej domyślny limit czasu polecenia (db push zgłosił „statement timeout”).
SET statement_timeout = '15min';

-- 1. Podrodzaje: rodzaj nadrzędny („dowolny smak”) obejmuje swoje produkty i produkty podrodzajów. Jeden poziom.
ALTER TABLE public.product_types ADD COLUMN parent_id bigint REFERENCES public.product_types(id) ON DELETE RESTRICT;
CREATE INDEX product_types_parent ON public.product_types(parent_id) WHERE parent_id IS NOT NULL;

CREATE FUNCTION public.product_types_parent_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE r record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO r FROM public.product_types WHERE id = NEW.parent_id;
    IF r.parent_id IS NOT NULL OR r.id = NEW.id THEN
      RAISE EXCEPTION 'Rodzaj nadrzędny nie może być podrodzajem.' USING ERRCODE = '22023'; END IF;
    IF r.subcategory_id <> NEW.subcategory_id OR r.unit <> NEW.unit OR r.g_ml_equal <> NEW.g_ml_equal THEN
      RAISE EXCEPTION 'Podrodzaj musi mieć podkategorię i jednostkę rodzaju nadrzędnego.' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.product_types WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'Rodzaj z podrodzajami nie może być podrodzajem.' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_types_parent_check BEFORE INSERT OR UPDATE OF parent_id, subcategory_id, unit, g_ml_equal ON public.product_types
  FOR EACH ROW EXECUTE FUNCTION public.product_types_parent_check();

-- Rodzaj i jego podrodzaje (produkty rodzaju nadrzędnego = jego własne + wszystkich smaków).
CREATE FUNCTION public.product_type_family(p_type_id bigint) RETURNS bigint[]
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(id), '{}') FROM public.product_types WHERE id = p_type_id OR parent_id = p_type_id;
$$;

-- 2. Ceny: mediana z całej rodziny rodzaju nadrzędnego (smak nie zmienia ceny za kg, a próbka jest większa).
CREATE OR REPLACE FUNCTION public.product_type_median(p_type_id bigint) RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN count(*) >= 5 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY u)::numeric END
  FROM (SELECT public.unit_price(c.single_price, c.quantity_value, c.quantity_unit) AS u
        FROM public.catalog_offers c JOIN public.products p ON p.id = c.product_id
        WHERE p.product_type_id = ANY (public.product_type_family(
                (SELECT coalesce(t.parent_id, t.id) FROM public.product_types t WHERE t.id = p_type_id)))
          AND c.single_price IS NOT NULL AND c.quantity_value > 0) x;
$$;
-- 3. Porównanie: produkty rodzaju nadrzędnego = jego własne + wszystkich podrodzajów.
CREATE OR REPLACE FUNCTION public.product_type_store_options(p_type_id bigint, p_store_id integer, p_needed numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE o record; t record; med numeric; fam bigint[] := public.product_type_family(p_type_id); n integer; n_min integer; n_max integer; ile numeric;
  pr jsonb; najl jsonb; wynik jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO t FROM public.product_types WHERE id = p_type_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  med := public.product_type_median(p_type_id);
  FOR o IN SELECT c.*, to_jsonb(c) AS dane FROM public.catalog_offers c JOIN public.products p ON p.id = c.product_id
    WHERE p.product_type_id = ANY (fam) AND c.store_id = p_store_id AND c.quantity_value > 0
      AND c.sale_mode IN ('package', 'bulk') ORDER BY c.offer_id
  LOOP
    najl := NULL;
    IF o.sale_mode = 'bulk' THEN
      pr := public.purchase_price(o.dane, p_needed / o.quantity_value);
      IF pr->>'cost' IS NOT NULL THEN
        najl := pr || jsonb_build_object('package_count', NULL, 'quantity', p_needed);
      END IF;
    ELSE
      n_min := ceil(p_needed / o.quantity_value)::integer;
      CONTINUE WHEN n_min > 1000;
      n_max := n_min;
      -- promocja „przy zakupie N” / zestaw: sprawdź też zakup do progu promocji, jeśli wyjdzie taniej
      IF o.verified_promotion THEN
        n_max := greatest(n_max, coalesce((o.promo_rule->>'min_quantity')::integer, 1));
        IF o.promo_rule->>'kind' = 'bundle' THEN
          n_max := ceil(n_max::numeric / (o.promo_rule->>'bundle_size')::integer)::integer * (o.promo_rule->>'bundle_size')::integer;
        END IF;
        n_max := least(n_max, 1000);
      END IF;
      FOR n IN n_min..n_max LOOP
        pr := public.purchase_price(o.dane, n);
        CONTINUE WHEN pr->>'cost' IS NULL;
        IF najl IS NULL OR (pr->>'cost')::numeric < (najl->>'cost')::numeric THEN
          najl := pr || jsonb_build_object('package_count', n, 'quantity', n * o.quantity_value);
        END IF;
      END LOOP;
    END IF;
    CONTINUE WHEN najl IS NULL;
    ile := (najl->>'quantity')::numeric;
    wynik := wynik || jsonb_build_array(jsonb_build_object(
      'offer_id', o.offer_id, 'product_id', o.product_id, 'name', o.product_name,
      'package', jsonb_build_object('quantity', o.quantity_value, 'unit', o.quantity_unit, 'label', o.gramatura_norm),
      'package_count', najl->'package_count', 'quantity', ile, 'unit', t.unit, 'sale_mode', o.sale_mode,
      'total_price', (najl->>'cost')::numeric, 'regular_total', (najl->>'regular_total')::numeric,
      'unit_price', public.unit_price((najl->>'cost')::numeric, ile, t.unit),
      'unit_price_per', public.catalog_unit_label(t.unit),
      'promotion_applied', (najl->>'promotion_applied')::boolean,
      'requires_card', (najl->>'requires_card')::boolean, 'requires_activation', (najl->>'requires_activation')::boolean,
      'condition', o.promo_condition, 'valid_from', o.valid_from, 'valid_to', o.valid_to,
      'price_source', o.price_source, 'observed_at', o.regular_price_observed_at, 'image_url', o.image_url,
      'suspicious', public.price_suspicious(public.unit_price(o.single_price, o.quantity_value, o.quantity_unit), med)));
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'suspicious')::boolean, (x->>'total_price')::numeric,
      (x->>'unit_price')::numeric, (x->>'product_id')::bigint) FROM jsonb_array_elements(wynik) x), '[]'::jsonb);
END;
$$;

-- 4. API: element rodzaju z rodzajem nadrzędnym (parent) i liczbą smaków (subtype_count).
CREATE OR REPLACE FUNCTION public.catalog_type_item(p_type_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH t AS (SELECT * FROM public.product_types WHERE id = p_type_id),
  m AS MATERIALIZED (SELECT public.product_type_median(p_type_id) AS med),   -- raz, nie dla każdej oferty
  o AS (
    SELECT c.*, public.unit_price(c.single_price, c.quantity_value, c.quantity_unit) AS unit_price
    FROM public.catalog_offers c JOIN public.products p ON p.id = c.product_id
    WHERE p.product_type_id = ANY (public.product_type_family(p_type_id))
  ), best AS (
    SELECT o.* FROM o, m WHERE o.unit_price IS NOT NULL AND NOT public.price_suspicious(o.unit_price, m.med)
    ORDER BY o.unit_price, o.single_price, o.offer_id LIMIT 1
  )
  SELECT jsonb_build_object(
    'kind', 'type', 'type_id', t.id, 'group_id', NULL, 'product_id', NULL, 'name', t.name, 'unit', t.unit,
    'g_ml_equal', t.g_ml_equal,
    'parent', (SELECT jsonb_build_object('type_id', r.id, 'name', r.name) FROM public.product_types r WHERE r.id = t.parent_id),
    'subtype_count', (SELECT count(*) FROM public.product_types c WHERE c.parent_id = t.id AND c.is_active),
    'default_quantity', coalesce(t.default_quantity, t.typical_package, CASE WHEN t.unit IN ('g', 'ml') THEN 1000 ELSE 1 END),
    'typical_package', t.typical_package,
    'product_count', (SELECT count(DISTINCT product_id) FROM o),
    'offer_count', (SELECT count(*) FROM o),
    'store_count', (SELECT count(DISTINCT store_id) FROM o),
    'stores_with_price_today', (SELECT count(DISTINCT store_id) FROM o WHERE single_price IS NOT NULL),
    'price_from', (SELECT jsonb_build_object('unit_price', b.unit_price, 'unit_price_per', public.catalog_unit_label(t.unit),
        'package_price', b.single_price, 'package_quantity', b.quantity_value, 'package_unit', b.quantity_unit,
        'store', jsonb_build_object('id', b.store_id, 'slug', b.store_slug, 'name', b.store_name), 'offer_id', b.offer_id) FROM best b),
    'image_url', (SELECT image_url FROM o WHERE image_url IS NOT NULL ORDER BY unit_price NULLS LAST, offer_id LIMIT 1))
  FROM t;
$$;

-- Ekran rodzaju: produkty całej rodziny; „subtypes” = smaki do zawężenia listy.
CREATE OR REPLACE FUNCTION public.catalog_type(p_type_id bigint, p_store_id integer DEFAULT NULL, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE item jsonb; sciezka jsonb; med numeric; total bigint; produkty jsonb; smaki jsonb;
  fam bigint[] := public.product_type_family(p_type_id);
  lim integer := greatest(1, least(coalesce(p_limit, 30), 100)); off integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  PERFORM public.catalog_require_reader();
  IF NOT EXISTS (SELECT 1 FROM public.product_types WHERE id = p_type_id AND is_active) THEN
    RAISE EXCEPTION 'Nie ma takiego rodzaju produktu.' USING ERRCODE = 'PT404'; END IF;
  item := public.catalog_type_item(p_type_id);
  med := public.product_type_median(p_type_id);
  SELECT jsonb_build_object('category', jsonb_build_object('slug', c.slug, 'name', c.name),
    'subcategory', jsonb_build_object('slug', s.slug, 'name', s.name, 'verification_status', s.verification_status))
  INTO sciezka FROM public.product_types t JOIN public.catalog_subcategories s ON s.id = t.subcategory_id
  JOIN public.categories c ON c.id = s.category_id WHERE t.id = p_type_id;
  WITH oferty AS (
    SELECT c.offer_id, c.product_id, c.store_id, public.unit_price(c.single_price, c.quantity_value, c.quantity_unit) AS u
    FROM public.catalog_offers c JOIN public.products p ON p.id = c.product_id
    WHERE p.product_type_id = ANY (fam) AND (p_store_id IS NULL OR c.store_id = p_store_id)
  ), prod AS (
    SELECT product_id, min(u) FILTER (WHERE NOT public.price_suspicious(u, med)) AS najl,
      min(u) AS najl_wszystkie FROM oferty GROUP BY product_id
  ), strona AS (
    SELECT p.*, pr.najl, pr.najl_wszystkie FROM prod pr JOIN public.products p ON p.id = pr.product_id
    ORDER BY pr.najl NULLS LAST, pr.najl_wszystkie NULLS LAST, p.canonical_name, p.id LIMIT lim OFFSET off
  )
  SELECT (SELECT count(*) FROM prod),
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'product_id', s.id, 'name', s.canonical_name, 'ean', s.ean,
      'package', jsonb_build_object('quantity', s.quantity_value, 'unit', s.quantity_unit, 'label', s.gramatura_norm),
      'sale_mode', s.sale_mode, 'image_url', s.image_url,
      'offers', (SELECT coalesce(jsonb_agg(public.catalog_offer(o.offer_id)
            || jsonb_build_object('suspicious', public.price_suspicious(o.u, med)) ORDER BY o.u NULLS LAST, o.store_id), '[]'::jsonb)
         FROM oferty o WHERE o.product_id = s.id))
      ORDER BY s.najl NULLS LAST, s.najl_wszystkie NULLS LAST, s.canonical_name, s.id), '[]'::jsonb) FROM strona s)
  INTO total, produkty;
  -- smaki rodzaju nadrzędnego (tylko te z ofertami w wybranej sieci / w ogóle), od najpopularniejszego (sieci, produkty)
  SELECT coalesce(jsonb_agg(x.it ORDER BY (x.it->>'store_count')::int DESC, (x.it->>'product_count')::int DESC, x.it->>'name'), '[]'::jsonb) INTO smaki
  FROM (SELECT public.catalog_type_item(c.id) AS it FROM public.product_types c WHERE c.parent_id = p_type_id AND c.is_active
    AND EXISTS (SELECT 1 FROM public.catalog_offers o JOIN public.products p ON p.id = o.product_id WHERE p.product_type_id = c.id
      AND (p_store_id IS NULL OR o.store_id = p_store_id))) x;
  RETURN jsonb_build_object('version', 1, 'type', item || jsonb_build_object('path', sciezka, 'median_unit_price', round(med, 2)),
    'subtypes', smaki, 'store_id', p_store_id, 'total', total, 'limit', lim, 'offset', off, 'products', produkty);
END;
$$;

-- Wyszukiwanie: rodzaj nadrzędny pasuje także przez produkty swoich smaków; popularne smaki (>= 2 sieci) jako osobne pozycje.
CREATE OR REPLACE FUNCTION public.catalog_search(p_query text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_with_types boolean DEFAULT false)
RETURNS jsonb
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
    SELECT g.id, g.name, g.group_key, coalesce(g.search_name, '') AS gn, count(*) AS n,
      bool_or(public.catalog_search_match(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, '')
        || CASE WHEN g.group_key LIKE 'product:%' THEN ' ' || coalesce(bp.search_name, '') ELSE '' END, toks)) AS w_produkcie,
      bool_and(p.product_type_id IS NOT NULL) AS w_rodzajach
    FROM public.comparison_groups g
    JOIN public.products p ON p.comparison_group_id = g.id
    JOIN public.base_products bp ON bp.id = p.base_product_id AND bp.subcategory_id IS NOT NULL
    WHERE EXISTS (SELECT 1 FROM public.store_offers so JOIN public.stores st ON st.id = so.store_id AND st.is_active WHERE so.product_id = p.id)
    GROUP BY g.id
  ), rodzaje AS (
    SELECT t.id, t.name, t.parent_id, coalesce(t.search_name, '') AS tn, count(*) AS n,
      bool_or(public.catalog_search_match(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), toks)) AS w_produkcie
    FROM public.product_types t
    JOIN public.product_types tc ON tc.id = t.id OR tc.parent_id = t.id
    JOIN public.products p ON p.product_type_id = tc.id
    WHERE p_with_types AND t.is_active
      AND EXISTS (SELECT 1 FROM public.store_offers so JOIN public.stores st ON st.id = so.store_id AND st.is_active WHERE so.product_id = p.id)
    GROUP BY t.id
  ), smaki_sieci AS (
    -- popularny smak = oferty w co najmniej 2 sieciach; taki jest pokazywany jako osobna pozycja
    SELECT p.product_type_id AS id, count(DISTINCT so.store_id) AS sieci
    FROM public.products p
    JOIN public.product_types c ON c.id = p.product_type_id AND c.parent_id IS NOT NULL
    JOIN public.store_offers so ON so.product_id = p.id JOIN public.stores st ON st.id = so.store_id AND st.is_active
    WHERE p_with_types GROUP BY 1
  ), typy AS (
    SELECT r.id, r.name, r.n, r.parent_id, coalesce(ss.sieci, 0) AS sieci, (CASE WHEN r.tn = q THEN 200 WHEN r.tn LIKE q || '%' THEN 150
        WHEN public.catalog_search_match(r.tn, toks) THEN 120 ELSE 60 END) + 1000 AS score
    FROM rodzaje r LEFT JOIN smaki_sieci ss ON ss.id = r.id WHERE r.w_produkcie
  ), trafienia AS (
    -- s1/s2/fam: miejsce na liście; smak stoi zaraz za swoim rodzajem nadrzędnym (pod = 1), popularniejsze wyżej
    SELECT 'group'::text AS rodzaj, k.id, k.name, k.n, s.score AS s1, k.n AS s2, k.id AS fam, 0 AS pod
    FROM kandydaci k
    CROSS JOIN LATERAL (SELECT (CASE WHEN k.gn = q THEN 200 WHEN k.gn LIKE q || '%' THEN 150
        WHEN public.catalog_search_match(k.gn, toks) THEN 120 ELSE 60 END
      + CASE WHEN k.group_key LIKE 'product:%' THEN 0 ELSE 40 END) AS score) s
    WHERE k.w_produkcie AND NOT (p_with_types AND k.w_rodzajach)
    UNION ALL
    -- smak: gdy jest popularny (>= 2 sieci) albo pasuje do zapytania lepiej niż rodzaj nadrzędny („chipsy paprykowe”)
    SELECT 'type', y.id, y.name, y.n,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.score ELSE y.score END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.n ELSE y.n END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.id ELSE y.id END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN 1 ELSE 0 END
    FROM typy y LEFT JOIN typy p ON p.id = y.parent_id
    WHERE y.parent_id IS NULL OR p.id IS NULL OR y.score > p.score OR y.sieci >= 2
  )
  SELECT (SELECT count(*) FROM trafienia),
    (SELECT coalesce(jsonb_agg(CASE WHEN x.rodzaj = 'type' THEN public.catalog_type_item(x.id) ELSE public.catalog_item(x.id) END
       ORDER BY x.s1 DESC, x.s2 DESC, x.rodzaj, x.fam, x.pod, x.n DESC, x.name, x.id), '[]'::jsonb)
     FROM (SELECT * FROM trafienia ORDER BY s1 DESC, s2 DESC, rodzaj, fam, pod, n DESC, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1, 'query', q, 'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

-- Gałąź: rodzaje nadrzędne i samodzielne, a za nimi ich popularne smaki; rzadkie smaki są na ekranie rodzaju.
CREATE OR REPLACE FUNCTION public.catalog_branch(p_subcategory text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_with_types boolean DEFAULT false)
RETURNS jsonb
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
      WHERE p.comparison_group_id = g.id AND bp.subcategory_id = sc.id AND NOT (p_with_types AND p.product_type_id IS NOT NULL))
  ), oferty AS (
    SELECT p.product_type_id AS id, count(DISTINCT so.store_id) AS sieci, count(DISTINCT p.id) AS ile
    FROM public.products p JOIN public.product_types t ON t.id = p.product_type_id AND t.subcategory_id = sc.id
    JOIN public.store_offers so ON so.product_id = p.id JOIN public.stores st ON st.id = so.store_id AND st.is_active
    WHERE p_with_types GROUP BY 1
  ), rodzaje AS (
    -- rodzaje nadrzędne i samodzielne + popularne smaki (>= 2 sieci) zaraz za swoim rodzajem, od najpopularniejszego
    SELECT t.id, t.name, coalesce(nad.display_order, t.display_order) AS poz, coalesce(t.parent_id, t.id) AS fam,
      CASE WHEN t.parent_id IS NULL THEN 0 ELSE 1 END AS pod, coalesce(o.sieci, 0) AS sieci, coalesce(o.ile, 0) AS ile
    FROM public.product_types t
    LEFT JOIN public.product_types nad ON nad.id = t.parent_id
    LEFT JOIN oferty o ON o.id = t.id
    WHERE p_with_types AND t.is_active AND t.subcategory_id = sc.id
      AND (CASE WHEN t.parent_id IS NULL
             THEN EXISTS (SELECT 1 FROM oferty x WHERE x.id = ANY (public.product_type_family(t.id)))
             ELSE coalesce(o.sieci, 0) >= 2 END)
  ), elementy AS (
    SELECT 0 AS kolejnosc, 'type'::text AS rodzaj, id, name, poz, fam, pod, sieci, ile FROM rodzaje
    UNION ALL
    SELECT CASE WHEN group_key LIKE 'product:%' THEN 2 ELSE 1 END, 'group', id, name, 0, 0, 0, 0, 0 FROM grupy
  )
  SELECT (SELECT count(*) FROM elementy),
    (SELECT coalesce(jsonb_agg(CASE WHEN x.rodzaj = 'type' THEN public.catalog_type_item(x.id) ELSE public.catalog_item(x.id) END
       ORDER BY x.kolejnosc, x.poz, x.fam, x.pod, x.sieci DESC, x.ile DESC, x.name, x.id), '[]'::jsonb)
     FROM (SELECT * FROM elementy ORDER BY kolejnosc, poz, fam, pod, sieci DESC, ile DESC, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1,
    'subcategory', jsonb_build_object('id', sc.id, 'slug', sc.slug, 'name', sc.name, 'verification_status', sc.verification_status,
      'category', jsonb_build_object('slug', sc.category_slug, 'name', sc.category_name)),
    'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

-- 5. Lista: wybór produktu w sieci dla rodzaju nadrzędnego może wskazać produkt dowolnego smaku.
CREATE OR REPLACE FUNCTION public.validate_list_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE gu text; t record; k text; v jsonb;
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.shopping_list_items WHERE list_id = NEW.list_id
      AND (group_id = NEW.group_id OR product_type_id = NEW.product_type_id)) THEN
    PERFORM 1 FROM public.shopping_lists WHERE id = NEW.list_id FOR UPDATE;
    IF (SELECT count(*) FROM public.shopping_list_items WHERE list_id = NEW.list_id) >= 100 THEN
      RAISE EXCEPTION 'Lista może mieć najwyżej 100 grup produktów.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF NEW.product_type_id IS NOT NULL THEN
    -- pozycja-rodzaj: jednostka rodzaju albo sztuki (= typowe opakowanie); wybory produktów w sieciach
    SELECT * INTO t FROM public.product_types WHERE id = NEW.product_type_id;
    IF NOT FOUND OR NOT t.is_active THEN RAISE EXCEPTION 'Nie ma takiego rodzaju produktu.' USING ERRCODE = '22023'; END IF;
    IF NOT (NEW.unit = t.unit OR NEW.unit = 'szt' OR (t.g_ml_equal AND NEW.unit IN ('g', 'ml'))) THEN
      RAISE EXCEPTION 'Jednostka nie pasuje do rodzaju produktu.' USING ERRCODE = '22023'; END IF;
    IF NEW.selected_product_id IS NOT NULL OR cardinality(NEW.extra_store_ids) > 0 THEN
      RAISE EXCEPTION 'Dla rodzaju produktu wybór produktu zapisuje się w sieci (store_choices).' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(NEW.store_choices)) > 20 THEN
      RAISE EXCEPTION 'Nieprawidłowy wybór produktu w sieci.' USING ERRCODE = '22023'; END IF;
    FOR k, v IN SELECT key, value FROM jsonb_each(NEW.store_choices) LOOP
      IF k !~ '^[0-9]{1,9}$' OR jsonb_typeof(v) <> 'number' OR NOT EXISTS (
        SELECT 1 FROM public.products p JOIN public.store_offers so ON so.product_id = p.id
        WHERE p.id = (v #>> '{}')::bigint AND p.product_type_id = ANY (public.product_type_family(NEW.product_type_id))
          AND so.store_id = k::integer)
      THEN RAISE EXCEPTION 'Wybrany produkt nie należy do tego rodzaju albo nie ma go w tej sieci.' USING ERRCODE = '22023'; END IF;
    END LOOP;
  ELSE
    IF NEW.store_choices <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Wybór produktu w sieci dotyczy tylko rodzajów produktów.' USING ERRCODE = '22023'; END IF;
    SELECT unit INTO gu FROM public.comparison_groups WHERE id = NEW.group_id;
    IF gu IS DISTINCT FROM NEW.unit THEN RAISE EXCEPTION 'Jednostka nie pasuje do produktu.' USING ERRCODE = '22023'; END IF;
    IF NEW.selected_product_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE id = NEW.selected_product_id AND comparison_group_id = NEW.group_id
    ) THEN RAISE EXCEPTION 'Wybrany produkt nie należy do tej grupy.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF NEW.unit = 'szt' AND NEW.quantity <> trunc(NEW.quantity) THEN RAISE EXCEPTION 'Podaj całkowitą liczbę sztuk.' USING ERRCODE = '22023'; END IF;
  IF cardinality(NEW.extra_store_ids) > 100 OR EXISTS (SELECT 1 FROM unnest(NEW.extra_store_ids) x WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = x)) THEN
    RAISE EXCEPTION 'Nieprawidłowy wybór wariantu promocyjnego.' USING ERRCODE = '22023'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.selected_product_id IS DISTINCT FROM OLD.selected_product_id) THEN NEW.extra_store_ids := '{}'; END IF;
  RETURN NEW;
END;
$$;

-- 6. Typowe opakowanie rodzaju nadrzędnego liczone z całej rodziny.
CREATE OR REPLACE FUNCTION public.refresh_product_types() RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE zmienione integer; r record;
BEGIN
  IF to_regclass('pg_temp.rodzaje_kandydaci') IS NOT NULL THEN DROP TABLE pg_temp.rodzaje_kandydaci; END IF;
  CREATE TEMP TABLE rodzaje_kandydaci ON COMMIT DROP AS
    SELECT p.id, bp.name AS base_name, p.quantity_unit AS unit, public.catalog_search_norm(p.canonical_name) AS n,
      NULL::bigint AS typ
    FROM public.products p JOIN public.base_products bp ON bp.id = p.base_product_id
    WHERE p.quantity_value > 0;
  FOR r IN SELECT ru.product_type_id, ru.base_product_names, ru.include_pattern, ru.exclude_pattern, t.unit, t.g_ml_equal
           FROM public.product_type_rules ru JOIN public.product_types t ON t.id = ru.product_type_id AND t.is_active
           ORDER BY ru.priority LOOP
    UPDATE pg_temp.rodzaje_kandydaci k SET typ = r.product_type_id
    WHERE k.typ IS NULL AND k.base_name = ANY (r.base_product_names)
      AND (k.unit = r.unit OR (r.g_ml_equal AND k.unit IN ('g', 'ml')))
      AND k.n ~ r.include_pattern AND (r.exclude_pattern IS NULL OR k.n !~ r.exclude_pattern);
  END LOOP;
  WITH nowe AS (
    SELECT p.id,
      CASE WHEN rv.product_id IS NOT NULL THEN rv.product_type_id ELSE k.typ END AS typ,
      CASE WHEN rv.product_id IS NOT NULL THEN 'review' WHEN k.typ IS NOT NULL THEN 'rule' END AS zrodlo
    FROM public.products p
    LEFT JOIN public.product_type_reviews rv ON rv.product_id = p.id
    LEFT JOIN pg_temp.rodzaje_kandydaci k ON k.id = p.id
  )
  UPDATE public.products p SET product_type_id = n.typ, product_type_source = n.zrodlo
  FROM nowe n
  WHERE n.id = p.id AND (p.product_type_id IS DISTINCT FROM n.typ OR p.product_type_source IS DISTINCT FROM n.zrodlo);
  GET DIAGNOSTICS zmienione = ROW_COUNT;
  DROP TABLE pg_temp.rodzaje_kandydaci;
  UPDATE public.product_types t SET typical_package = x.mediana
  FROM (SELECT nad.id, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.quantity_value)::numeric, 2) AS mediana
        FROM public.product_types nad
        JOIN public.product_types tc ON tc.id = nad.id OR tc.parent_id = nad.id
        JOIN public.products p ON p.product_type_id = tc.id
        WHERE p.quantity_value > 0 AND EXISTS (SELECT 1 FROM public.store_offers so WHERE so.product_id = p.id)
        GROUP BY nad.id) x
  WHERE x.id = t.id AND t.typical_package IS DISTINCT FROM x.mediana;
  RETURN jsonb_build_object('changed_products', zmienione,
    'typed_products', (SELECT count(*) FROM public.products WHERE product_type_id IS NOT NULL),
    'types', (SELECT count(*) FROM public.product_types WHERE is_active));
END;
$$;

REVOKE ALL ON FUNCTION public.product_type_family(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_type_family(bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.product_types_parent_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_types_parent_check() TO service_role;

-- 7. Podrodzaje i ich reguły.
CREATE TEMP TABLE smaki(parent_name text, slug text, name text, ord integer, flavor text, flavor_exclude text) ON COMMIT DROP;
INSERT INTO smaki VALUES
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-sol-i-ocet', 'Chipsy ziemniaczane sól i ocet', 1, 'ocet|vinegar', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-paprykowe', 'Chipsy ziemniaczane paprykowe', 2, 'papryk|paprika|\ypap\y|\ypapr\y', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-serowe', 'Chipsy ziemniaczane serowe', 3, '\yser|cheese|fromage|cheddar|serow', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-cebulowe-smietankowe', 'Chipsy ziemniaczane cebulowe / śmietankowe', 4, 'cebul|onion|smietan|sour cream', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-ketchupowe', 'Chipsy ziemniaczane ketchupowe', 5, 'ketch', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-pikantne-chili-jalapeno', 'Chipsy ziemniaczane pikantne (chili, jalapeño)', 6, 'chili|chilli|jalapen|\yhot\y|spicy|pikant|cayenne|chakalaka|salsa|ostr', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-miesne-bekon-zeberka-wolowina', 'Chipsy ziemniaczane mięsne (bekon, żeberka, wołowina)', 7, 'bekon|bacon|zeberk|wolow|stek|grill|kurcz', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-o-smaku-pizzy-pomidorowe', 'Chipsy ziemniaczane o smaku pizzy / pomidorowe', 8, 'pizz|oregano|pomodor|pomidor', NULL),
  ('Chipsy ziemniaczane', 'chipsy-ziemniaczane-solone', 'Chipsy ziemniaczane solone', 9, 'solon|\ysol\y|salted|z sola|original|classic|naturaln', 'nori'),
  ('Nachos / chipsy tortilla', 'nachos-serowe', 'Nachos serowe', 1, '\yser|cheese|cheddar|maasdam', NULL),
  ('Nachos / chipsy tortilla', 'nachos-pikantne-chili-salsa', 'Nachos pikantne (chili, salsa)', 2, 'chili|chilli|\yhot\y|salsa|pikant|jalapen|spicy', NULL),
  ('Chrupki kukurydziane', 'chrupki-ketchupowe', 'Chrupki ketchupowe', 1, 'ketch', NULL),
  ('Chrupki kukurydziane', 'chrupki-serowe', 'Chrupki serowe', 2, '\yser|cheese|\ychee\y|serow', NULL),
  ('Chrupki kukurydziane', 'chrupki-o-smaku-pizzy', 'Chrupki o smaku pizzy', 3, 'pizz', NULL),
  ('Chrupki kukurydziane', 'chrupki-paprykowe', 'Chrupki paprykowe', 4, 'papryk|paprika|mexican', NULL),
  ('Chrupki kukurydziane', 'chrupki-naturalne-solone', 'Chrupki naturalne / solone', 5, 'naturaln|solon|\ysol\y|original|tygrysk|classic', NULL),
  ('Popcorn', 'popcorn-maslany', 'Popcorn maślany', 1, 'masl|butter', NULL),
  ('Popcorn', 'popcorn-solony', 'Popcorn solony', 2, 'solon|\ysol\y|salted', NULL),
  ('Orzeszki ziemne w panierce / chrupiącej skorupce', 'orzeszki-w-panierce-wasabi', 'Orzeszki w panierce wasabi', 1, 'wasabi', 'prazynk|chrupk|cheetos|chrups'),
  ('Orzeszki ziemne w panierce / chrupiącej skorupce', 'orzeszki-w-panierce-paprykowe', 'Orzeszki w panierce paprykowe', 2, 'papryk|paprika', 'prazynk|chrupk|cheetos|chrups'),
  ('Orzeszki ziemne w panierce / chrupiącej skorupce', 'orzeszki-w-panierce-serowe', 'Orzeszki w panierce serowe', 3, '\yser|cheese', 'prazynk|chrupk|cheetos|chrups'),
  ('Jogurt owocowy', 'jogurt-z-ziarnami-musli-granola', 'Jogurt z ziarnami / musli / granolą', 1, 'zboz|ziarn|musli|granol|platk', NULL),
  ('Jogurt owocowy', 'jogurt-truskawkowy', 'Jogurt truskawkowy', 2, 'trusk|poziom|strawb', NULL),
  ('Jogurt owocowy', 'jogurt-malinowy', 'Jogurt malinowy', 3, 'malin|raspb', 'strucl'),
  ('Jogurt owocowy', 'jogurt-wisniowy', 'Jogurt wiśniowy', 4, 'wisn|\ywis\y|cherry', NULL),
  ('Jogurt owocowy', 'jogurt-brzoskwiniowy-morelowy', 'Jogurt brzoskwiniowy / morelowy', 5, 'brzosk|peach|morel', NULL),
  ('Jogurt owocowy', 'jogurt-jagodowy-owoce-lesne', 'Jogurt jagodowy / owoce leśne', 6, 'jagod|borow|lesn|blueb|berry|porzecz|jezyn|aronia|blckcur', NULL),
  ('Jogurt owocowy', 'jogurt-czekoladowy-deserowy', 'Jogurt czekoladowy / deserowy', 7, 'czek|choc|kakao|stracc|straciat|brownie|karmel|toff|krowk|caramel|kajmak|twix', 'bita smiet'),
  ('Jogurt pitny', 'jogurt-pitny-truskawkowy', 'Jogurt pitny truskawkowy', 1, 'trusk|poziom|strawb', NULL),
  ('Jogurt pitny', 'jogurt-pitny-malinowy', 'Jogurt pitny malinowy', 2, 'malin|raspb', NULL),
  ('Jogurt pitny', 'jogurt-pitny-wisniowy', 'Jogurt pitny wiśniowy', 3, 'wisn|\ywis\y|cherry', NULL),
  ('Jogurt pitny', 'jogurt-pitny-brzoskwiniowy', 'Jogurt pitny brzoskwiniowy', 4, 'brzosk|peach|morel', NULL),
  ('Jogurt pitny', 'jogurt-pitny-jagodowy-owoce-lesne', 'Jogurt pitny jagodowy / owoce leśne', 5, 'jagod|borow|lesn|blueb|berry|porzecz|jezyn|aronia|blckcur', NULL),
  ('Jogurt pitny', 'jogurt-pitny-tropikalny-mango-marakuja', 'Jogurt pitny tropikalny (mango, marakuja)', 6, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', NULL),
  ('Jogurt pitny', 'jogurt-pitny-waniliowy-stracciatella', 'Jogurt pitny waniliowy / stracciatella', 7, 'wanil|vanil|stracc|straciat', NULL),
  ('Jogurt pitny', 'jogurt-pitny-naturalny', 'Jogurt pitny naturalny', 8, 'naturaln|klasyczn', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-waniliowy', 'Serek homogenizowany waniliowy', 1, 'wanil|vanil', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-truskawkowy', 'Serek homogenizowany truskawkowy', 2, 'trusk|poziom|strawb', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-czekoladowy-stracciatella', 'Serek homogenizowany czekoladowy / stracciatella', 3, 'czek|choc|kakao|stracc|straciat|brownie', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-brzoskwiniowy', 'Serek homogenizowany brzoskwiniowy', 4, 'brzosk|peach|morel', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-bananowy', 'Serek homogenizowany bananowy', 5, 'banan', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-ciasteczkowy', 'Serek homogenizowany ciasteczkowy', 6, 'ciastecz|cias\y|tutti', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-tropikalny-mango-kokos', 'Serek homogenizowany tropikalny (mango, kokos)', 7, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', NULL),
  ('Serek homogenizowany', 'serek-homogenizowany-naturalny-smietankowy', 'Serek homogenizowany naturalny / śmietankowy', 8, 'naturaln|smietank|klasyczn', NULL),
  ('Deser mleczny / budyń', 'deser-mleczny-czekoladowy', 'Deser mleczny czekoladowy', 1, 'czek|choc|kakao|stracc|straciat|brownie', 'cukierk|polewa|czekol mlecz|mieszanka|wedlowsk'),
  ('Deser mleczny / budyń', 'deser-mleczny-karmelowy-krowkowy', 'Deser mleczny karmelowy / krówkowy', 2, 'karmel|toff|krowk|caramel|kajmak|creme brulee|brulee', NULL),
  ('Ice tea (herbata mrożona)', 'ice-tea-cytrynowa', 'Ice tea cytrynowa', 1, 'cytr|lemon|limonk|\ylime', NULL),
  ('Ice tea (herbata mrożona)', 'ice-tea-brzoskwiniowa', 'Ice tea brzoskwiniowa', 2, 'brzosk|peach|morel', NULL),
  ('Ice tea (herbata mrożona)', 'ice-tea-zielona', 'Ice tea zielona', 3, 'green|zielon', NULL),
  ('Ice tea (herbata mrożona)', 'ice-tea-tropikalna-mango-ananas', 'Ice tea tropikalna (mango, ananas)', 4, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', 'galaretk'),
  ('Ice tea (herbata mrożona)', 'ice-tea-owoce-lesne-malina', 'Ice tea owoce leśne / malina', 5, 'malin|raspb|jagod|borow|lesn|blueb|berry|porzecz|jezyn|aronia|blckcur|hibisc|hibisk', NULL),
  ('Napój izotoniczny', 'napoj-izotoniczny-cytrynowy-grejpfrutowy', 'Napój izotoniczny cytrynowy / grejpfrutowy', 1, 'cytr|lemon|limonk|\ylime|grejpfr', NULL),
  ('Napój izotoniczny', 'napoj-izotoniczny-pomaranczowy', 'Napój izotoniczny pomarańczowy', 2, 'pomaran|orange', NULL),
  ('Napój izotoniczny', 'napoj-izotoniczny-wieloowocowy', 'Napój izotoniczny wieloowocowy', 3, 'wieloowoc|multifruit|multi', NULL),
  ('Napój izotoniczny', 'napoj-izotoniczny-owoce-lesne-malina', 'Napój izotoniczny owoce leśne / malina', 4, 'malin|raspb|jagod|borow|lesn|blueb|berry|porzecz|jezyn|aronia|blckcur|wisn|\ywis\y|cherry', NULL),
  ('Woda smakowa', 'woda-smakowa-cytrynowa-limonkowa', 'Woda smakowa cytrynowa / limonkowa', 1, 'cytr|lemon|limonk|\ylime', NULL),
  ('Woda smakowa', 'woda-smakowa-truskawkowa', 'Woda smakowa truskawkowa', 2, 'trusk|poziom|strawb', NULL),
  ('Woda smakowa', 'woda-smakowa-jablkowa', 'Woda smakowa jabłkowa', 3, 'jabl', NULL),
  ('Syrop owocowy', 'syrop-malinowy', 'Syrop malinowy', 1, 'malin|raspb', NULL),
  ('Syrop owocowy', 'syrop-cytrynowy', 'Syrop cytrynowy', 2, 'cytr|lemon|limonk|\ylime', NULL),
  ('Syrop owocowy', 'syrop-truskawkowy', 'Syrop truskawkowy', 3, 'trusk|poziom|strawb', NULL),
  ('Syrop owocowy', 'syrop-z-czarnej-porzeczki', 'Syrop z czarnej porzeczki', 4, 'porzecz', NULL),
  ('Syrop owocowy', 'syrop-pomaranczowy', 'Syrop pomarańczowy', 5, 'pomaran', NULL),
  ('Nektar', 'nektar-z-czarnej-porzeczki', 'Nektar z czarnej porzeczki', 1, 'porzecz|czarnaporz', NULL),
  ('Nektar', 'nektar-pomaranczowy', 'Nektar pomarańczowy', 2, 'pomaran', NULL),
  ('Nektar', 'nektar-grejpfrutowy', 'Nektar grejpfrutowy', 3, 'grejpfr', NULL),
  ('Nektar', 'nektar-bananowy', 'Nektar bananowy', 4, 'banan', NULL),
  ('Nektar', 'nektar-wieloowocowy-multiwitamina', 'Nektar wieloowocowy / multiwitamina', 5, 'wieloowoc|multi', NULL),
  ('Mus owocowy w tubce', 'mus-owocowy-z-mango-tropikalny', 'Mus owocowy z mango / tropikalny', 1, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', NULL),
  ('Mus owocowy w tubce', 'mus-owocowy-truskawkowy', 'Mus owocowy truskawkowy', 2, 'trusk|poziom|strawb', NULL),
  ('Mus owocowy w tubce', 'mus-owocowo-warzywny-marchew-dynia', 'Mus owocowo-warzywny (marchew, dynia)', 3, 'marchew|marchw|dyni|warzyw|burak', NULL),
  ('Mus owocowy w tubce', 'mus-owocowy-bananowy', 'Mus owocowy bananowy', 4, 'banan', NULL),
  ('Mus owocowy w tubce', 'mus-jablkowy', 'Mus jabłkowy', 5, 'jabl', 'gruszk|brzosk|malin|wisn|jagod|borow|kiwi|sliw|porzecz|morel|\yryz'),
  ('Lody w pudełku', 'lody-pistacjowe', 'Lody pistacjowe', 1, 'pistac', NULL),
  ('Lody w pudełku', 'lody-karmelowe-slony-karmel', 'Lody karmelowe / słony karmel', 2, 'karmel|toff|krowk|caramel|kajmak', NULL),
  ('Lody w pudełku', 'lody-czekoladowe', 'Lody czekoladowe', 3, 'czek|choc|kakao|stracc|straciat|brownie', NULL),
  ('Lody w pudełku', 'lody-truskawkowe', 'Lody truskawkowe', 4, 'trusk|poziom|strawb', NULL),
  ('Lody w pudełku', 'lody-waniliowe', 'Lody waniliowe', 5, 'wanil|vanil', NULL),
  ('Lody w pudełku', 'lody-smietankowe', 'Lody śmietankowe', 6, 'smietan', NULL),
  ('Budyń', 'budyn-waniliowy', 'Budyń waniliowy', 1, 'wanil|vanil', NULL),
  ('Budyń', 'budyn-smietankowy', 'Budyń śmietankowy', 2, 'smiet', NULL),
  ('Budyń', 'budyn-czekoladowy', 'Budyń czekoladowy', 3, 'czek|choc|kakao|stracc|straciat|brownie', NULL),
  ('Galaretka (w proszku)', 'galaretka-truskawkowa', 'Galaretka truskawkowa', 1, 'trusk|poziom|strawb', NULL),
  ('Galaretka (w proszku)', 'galaretka-cytrynowa', 'Galaretka cytrynowa', 2, 'cytr|lemon|limonk|\ylime', NULL),
  ('Galaretka (w proszku)', 'galaretka-malinowa', 'Galaretka malinowa', 3, 'malin|raspb', NULL),
  ('Galaretka (w proszku)', 'galaretka-wisniowa', 'Galaretka wiśniowa', 4, 'wisn|\ywis\y|cherry', NULL),
  ('Galaretka (w proszku)', 'galaretka-agrestowa', 'Galaretka agrestowa', 5, 'agrest', NULL),
  ('Croissant / rogalik', 'croissant-z-nadzieniem-kakaowym-czekoladowym', 'Croissant z nadzieniem kakaowym / czekoladowym', 1, 'czek|choc|kakao|stracc|straciat|brownie|milka|nutella', NULL),
  ('Croissant / rogalik', 'croissant-z-nadzieniem-waniliowym', 'Croissant z nadzieniem waniliowym', 2, 'wanil|vanil|budyn', NULL),
  ('Croissant / rogalik', 'croissant-z-nadzieniem-orzechowym-pistacjowym', 'Croissant z nadzieniem orzechowym / pistacjowym', 3, 'orzech|laskow|pistac', NULL),
  ('Croissant / rogalik', 'croissant-z-nadzieniem-owocowym', 'Croissant z nadzieniem owocowym', 4, 'trusk|poziom|strawb|wisn|\ywis\y|cherry|morel|owoc|jabl|malin', NULL),
  ('Croissant / rogalik', 'rogal-z-makiem', 'Rogal z makiem', 5, '\ymak\y|makiem|makow', NULL),
  ('Croissant / rogalik', 'croissant-maslany-bez-nadzienia', 'Croissant maślany (bez nadzienia)', 6, 'masl|klasyczn|natur', 'nadzien|\ynadz'),
  ('Donut / pączek', 'paczek-donut-czekoladowy', 'Pączek / donut czekoladowy', 1, 'czek|choc|kakao|stracc|straciat|brownie', NULL),
  ('Donut / pączek', 'paczek-donut-owocowy', 'Pączek / donut owocowy', 2, 'trusk|poziom|strawb|wisn|\ywis\y|cherry|malin|raspb|mango|owoc|jabl|morel', NULL),
  ('Donut / pączek', 'paczek-donut-z-kremem-orzechowym-karmelowym', 'Pączek / donut z kremem orzechowym / karmelowym', 3, 'orzech|pistac|lotus|biscoff|karmel|toff|krowk|caramel|kajmak', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-tropikalny-mango-ananas-marakuja', 'Sok tropikalny (mango, ananas, marakuja)', 1, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-grejpfrutowy', 'Sok grejpfrutowy', 2, 'grejpfr', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-marchwiowo-owocowy', 'Sok marchwiowo-owocowy', 3, 'marchew|marchw|\ymarch\y|\ykar\y|kubus', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-pomaranczowy-tloczony-mieszany', 'Sok pomarańczowy (tłoczony / mieszany)', 4, 'pomaran|\ypom\y|mandaryn', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-multiwitamina-wieloowocowy', 'Sok multiwitamina / wieloowocowy', 5, 'multi|wieloowoc|vital|odporn|vitamin|witamin', NULL),
  ('Sok wieloowocowy / inny 100%', 'sok-jablkowy-z-dodatkiem-jablko-mieta-jablko-wisnia', 'Sok jabłkowy z dodatkiem (jabłko-mięta, jabłko-wiśnia…)', 6, 'jabl|\yjab\y', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-cytrynowy-lemoniada', 'Napój owocowy cytrynowy / lemoniada', 1, 'cytr|lemon|limonk|\ylime', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-truskawkowy', 'Napój owocowy truskawkowy', 2, 'trusk|poziom|strawb', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-wisniowy', 'Napój owocowy wiśniowy', 3, 'wisn|\ywis\y|cherry', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-tropikalny', 'Napój owocowy tropikalny', 4, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-jablkowy', 'Napój owocowy jabłkowy', 5, 'jabl', NULL),
  ('Napój owocowy niegazowany (Tymbark, Kubuś…)', 'napoj-owocowy-wieloowocowy-multiwitamina', 'Napój owocowy wieloowocowy / multiwitamina', 6, 'wieloowoc|multi|vitamin|witamin', NULL),
  ('Żelki', 'zelki-kwasne', 'Żelki kwaśne', 1, 'kwas|sour', NULL),
  ('Żelki', 'zelki-o-smaku-coli', 'Żelki o smaku coli', 2, '\ycol', NULL),
  ('Żelki', 'zelki-owocowe-misie-klasyczne', 'Żelki owocowe (misie, klasyczne)', 3, 'owoc|\ymis|bear|malin|raspb|trusk|poziom|strawb|zlote', NULL),
  ('Zupka błyskawiczna', 'zupka-krewetkowa-owoce-morza', 'Zupka krewetkowa / owoce morza', 1, 'krewet|owoce morza|shrimp', NULL),
  ('Zupka błyskawiczna', 'zupka-pikantna-curry-chili-tom-yum', 'Zupka pikantna (curry, chili, tom yum)', 2, 'pikant|ostr|chili|\yhot\y|curry|tom yum|kimchi|spicy', NULL),
  ('Zupka błyskawiczna', 'zupka-pomidorowa', 'Zupka pomidorowa', 3, 'pomidor', NULL),
  ('Zupka błyskawiczna', 'zupka-grzybowa-pieczarkowa', 'Zupka grzybowa / pieczarkowa', 4, 'grzyb|pieczark', NULL),
  ('Zupka błyskawiczna', 'zupka-wolowa', 'Zupka wołowa', 5, 'wolow|beef', NULL),
  ('Zupka błyskawiczna', 'zupka-o-smaku-kurczaka-rosol', 'Zupka o smaku kurczaka / rosół', 6, 'kurc|rosol|chicken|drob', NULL),
  ('Napój mleczny smakowy', 'napoj-mleczny-czekoladowy', 'Napój mleczny czekoladowy', 1, 'czek|choc|kakao|stracc|straciat|brownie', NULL),
  ('Napój mleczny smakowy', 'napoj-mleczny-waniliowy', 'Napój mleczny waniliowy', 2, 'wanil|vanil', NULL),
  ('Napój mleczny smakowy', 'napoj-mleczny-truskawkowy', 'Napój mleczny truskawkowy', 3, 'trusk|poziom|strawb', NULL),
  ('Napój mleczny smakowy', 'napoj-mleczny-bananowy', 'Napój mleczny bananowy', 4, 'banan', NULL),
  ('Serek do smarowania z dodatkami', 'serek-do-smarowania-ze-szczypiorkiem-cebula', 'Serek do smarowania ze szczypiorkiem / cebulą', 1, 'szczypior|cebul', NULL),
  ('Serek do smarowania z dodatkami', 'serek-do-smarowania-z-ziolami-czosnkiem', 'Serek do smarowania z ziołami / czosnkiem', 2, 'ziol|czosn|bazyli', NULL),
  ('Serek do smarowania z dodatkami', 'serek-do-smarowania-z-chrzanem', 'Serek do smarowania z chrzanem', 3, 'chrzan', NULL),
  ('Serek do smarowania z dodatkami', 'serek-do-smarowania-pikantny-z-papryka-pomidorami', 'Serek do smarowania pikantny / z papryką / pomidorami', 4, 'papryk|chili|pomidor|jalap|pikant', NULL),
  ('Ser topiony', 'ser-topiony-w-plastrach', 'Ser topiony w plastrach', 1, 'plastr|toast', NULL),
  ('Ser topiony', 'ser-topiony-z-szynka', 'Ser topiony z szynką', 2, 'szynk|szy\y', NULL),
  ('Ser topiony', 'ser-topiony-ziolowy', 'Ser topiony ziołowy', 3, 'ziol|bazyli', NULL),
  ('Ser topiony', 'ser-topiony-pikantny-z-papryka', 'Ser topiony pikantny / z papryką', 4, 'chili|papryk|jalap|pikant', NULL),
  ('Ser topiony', 'ser-topiony-smietankowy-naturalny', 'Ser topiony śmietankowy / naturalny', 5, 'smietank|classic|naturaln|kremow', NULL),
  ('Herbata owocowa', 'herbata-malinowa-owoce-lesne', 'Herbata malinowa / owoce leśne', 1, 'malin|raspb|jagod|borow|lesn|blueb|berry|porzecz|jezyn|aronia|blckcur', NULL),
  ('Herbata owocowa', 'herbata-cytrynowa-z-imbirem', 'Herbata cytrynowa / z imbirem', 2, 'cytr|lemon|limonk|\ylime|imbir', NULL),
  ('Herbata owocowa', 'herbata-z-hibiskusem-dzika-roza', 'Herbata z hibiskusem / dziką różą', 3, 'hibisk|\yroz|granat', NULL),
  ('Herbata owocowa', 'herbata-tropikalna-mango-soursop', 'Herbata tropikalna (mango, soursop)', 4, 'mango|\ymang\y|marak|ananas|tropic|egzot|kokos|passion|soursop', NULL),
  ('Herbata owocowa', 'herbata-truskawkowa', 'Herbata truskawkowa', 5, 'trusk|poziom|strawb', NULL),
  ('Herbata owocowa', 'herbata-zimowa-korzenna', 'Herbata zimowa / korzenna', 6, 'winter|zimow|korzen|piernik|pomaran|grzan', NULL),
  ('Wafelek w czekoladzie (Prince Polo, Grześki, KitKat…)', 'wafelki-orzechowe', 'Wafelki orzechowe', 1, 'orzech|laskow|arach|peanut', NULL),
  ('Wafelek w czekoladzie (Prince Polo, Grześki, KitKat…)', 'wafelki-kokosowe', 'Wafelki kokosowe', 2, 'kokos', NULL),
  ('Wafelek w czekoladzie (Prince Polo, Grześki, KitKat…)', 'wafelki-smietankowe-mleczne', 'Wafelki śmietankowe / mleczne', 3, 'smietan|wanil|vanil', 'czekoladzie mlecznej'),
  ('Wafelek w czekoladzie (Prince Polo, Grześki, KitKat…)', 'wafelki-kakaowe-czekoladowe', 'Wafelki kakaowe / czekoladowe', 4, 'kakao|czekoladow|choco|chocolate', NULL),
  ('Ptasie mleczko (inne smaki)', 'ptasie-mleczko-owocowe-malina-wisnia-cytryna', 'Ptasie mleczko owocowe (malina, wiśnia, cytryna)', 1, 'malin|raspb|wisn|\ywis\y|cherry|cytr|lemon|limonk|\ylime|trusk|poziom|strawb|owoc', NULL),
  ('Ptasie mleczko (inne smaki)', 'ptasie-mleczko-czekoladowe', 'Ptasie mleczko czekoladowe', 2, 'czekoladow|kakao', NULL),
  ('Ptasie mleczko (inne smaki)', 'ptasie-mleczko-smietankowe-mascarpone', 'Ptasie mleczko śmietankowe / mascarpone', 3, 'smietan|mascarpone|jogurt', NULL),
  ('Baton proteinowy', 'baton-proteinowy-orzechowy', 'Baton proteinowy orzechowy', 1, 'orzech|arach|peanut', NULL),
  ('Baton proteinowy', 'baton-proteinowy-karmelowy', 'Baton proteinowy karmelowy', 2, 'karmel|carmel|caramel|toff', NULL),
  ('Baton proteinowy', 'baton-proteinowy-ciasteczkowy', 'Baton proteinowy ciasteczkowy', 3, 'ciastecz|cookie', NULL),
  ('Baton proteinowy', 'baton-proteinowy-owocowy', 'Baton proteinowy owocowy', 4, 'trusk|poziom|strawb|malin|raspb|owoc|yuzu|baobab|kokos|cytr', NULL),
  ('Hummus', 'hummus-paprykowy-pomidorowy', 'Hummus paprykowy / pomidorowy', 1, 'papryk|pomidor|ajvar', NULL),
  ('Hummus', 'hummus-z-ziolami-czosnkiem', 'Hummus z ziołami / czosnkiem', 2, 'ziol|czosn|bazyli|kolendr|pesto', NULL),
  ('Hummus', 'hummus-klasyczny', 'Hummus klasyczny', 3, 'klasyczn|naturaln|original|classic', NULL),
  ('Pasztet wieprzowy / pieczony', 'pasztet-z-grzybami', 'Pasztet z grzybami', 1, 'grzyb|borowik|pieczark', NULL),
  ('Pasztet wieprzowy / pieczony', 'pasztet-z-zurawina-sliwka', 'Pasztet z żurawiną / śliwką', 2, 'zurawin|sliwk', NULL);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT parent_name FROM smaki) s
             WHERE (SELECT count(*) FROM public.product_types t WHERE t.name = s.parent_name AND t.parent_id IS NULL) <> 1) THEN
    RAISE EXCEPTION 'Smaki: brak rodzaju nadrzędnego (migracje 20261124000200 i 000300).';
  END IF;
END $$;

INSERT INTO public.product_types(slug, name, subcategory_id, unit, g_ml_equal, display_order, parent_id)
SELECT s.slug, s.name, p.subcategory_id, p.unit, p.g_ml_equal, s.ord, p.id
FROM smaki s JOIN public.product_types p ON p.name = s.parent_name AND p.parent_id IS NULL;

INSERT INTO public.product_type_rules(product_type_id, priority, base_product_names, include_pattern, exclude_pattern, note)
SELECT c.id, r.priority - 10 + s.ord, r.base_product_names,
  '^(?=.*(?:' || r.include_pattern || ')).*(?:' || s.flavor || ')',
  concat_ws('|', '(?:' || r.exclude_pattern || ')', '(?:' || s.flavor_exclude || ')', '(?:mix|rozne|\ylub\y|edycj|zestaw|\ywow|kolekcj|multipak|selection)'),
  'smak: ' || s.parent_name
FROM smaki s
JOIN public.product_types p ON p.name = s.parent_name AND p.parent_id IS NULL
JOIN public.product_type_rules r ON r.product_type_id = p.id
JOIN public.product_types c ON c.slug = s.slug;

ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
SELECT public.refresh_product_types();
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;

NOTIFY pgrst, 'reload schema';
