-- Trafniejsze wyszukiwanie (24.11.2026), zgłoszone przy testach porównywarki:
-- 1. „pomidor” pokazywał rodzaj „Mozzarella (kulka)”: rodzaj pasował, gdy do zapytania pasował choć jeden jego produkt
--    (tu „Minicalzone margherita z mozzarellą i pomidorami”). Teraz rodzaj pasuje nazwą albo większością swoich produktów
--    (całymi słowami, bez ilości typu „1,5 l”);
--    pojedyncze pasujące produkty z innych rodzajów są pokazywane jako zwykłe grupy / produkty, niżej.
-- 2. „mleko 2%” dawało najpierw „Mleko 3,2%”: normalizacja zamienia „3,2%” na „3 2%”, więc słowo „2%” pasowało.
--    Teraz liczby dziesiętne są sklejane („3 2%” -> „3,2%”) w zapytaniu i w zapisanych tekstach do wyszukiwania
--    (search_text / search_name). catalog_search_norm się nie zmienia (używają jej reguły rodzajów).
-- 3. „kawa” pokazywała rodzaje z „kawałkami”: początek słowa liczy się przy rodzajach, gdy pokrywa co najmniej 60% słowa.

-- „3 2%” -> „3,2%”, „mleko 1 5 2%” (z „1,5–2%”) -> „mleko 1,5 2%”, „0 5 l” -> „0,5 l”, „0 33l” -> „0,33l”. Tylko do wyszukiwarki.
CREATE FUNCTION public.catalog_search_glue(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(coalesce(t, ''), '(^| )([0-9]+) ([0-9]+)(?=[ %]|(g|kg|dag|ml|cl|l)( |$)|$)', '\1\2,\3', 'g');
$$;

-- Zapisane teksty do wyszukiwania (używa ich tylko catalog_search) dostają sklejone liczby.
CREATE OR REPLACE FUNCTION public.products_search_text() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_text := public.catalog_search_glue(public.catalog_search_norm(NEW.canonical_name));
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.groups_search_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_name := public.catalog_search_glue(public.catalog_search_norm(NEW.name));
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.base_products_search_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_name := public.catalog_search_glue(public.catalog_search_norm(NEW.name));
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.product_types_search_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_name := public.catalog_search_glue(public.catalog_search_norm(NEW.name));
  RETURN NEW;
END;
$$;
ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
UPDATE public.products SET search_text = public.catalog_search_glue(search_text) WHERE search_text ~ '[0-9] [0-9]';
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;
UPDATE public.comparison_groups SET search_name = public.catalog_search_glue(search_name) WHERE search_name ~ '[0-9] [0-9]';
UPDATE public.base_products SET search_name = public.catalog_search_glue(search_name) WHERE search_name ~ '[0-9] [0-9]';
UPDATE public.product_types SET search_name = public.catalog_search_glue(search_name) WHERE search_name ~ '[0-9] [0-9]';

-- Dopasowanie ścisłe (nazwy rodzajów i grup, przynależność rodzaju): słowa całe, a ostatnie słowo zapytania może być
-- początkiem słowa, ale co najmniej w 60% jego długości („pomidor” -> „pomidory”, „pomidorowy”, „kielb” -> „kiełbasa”;
-- „kawa” -> nie „kawałkami”, „ser” -> nie „serowe”).
CREATE FUNCTION public.catalog_search_name_match(p_text text, p_tokens text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(p_tokens) WITH ORDINALITY AS t(tok, nr)
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(coalesce(p_text, ''), ' ')) AS w(word)
      WHERE w.word = t.tok
         OR (t.nr = cardinality(p_tokens) AND left(w.word, length(t.tok)) = t.tok AND length(t.tok) * 10 >= length(w.word) * 6)));
$$;

CREATE OR REPLACE FUNCTION public.catalog_search(p_query text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_with_types boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE q text := public.catalog_search_glue(public.catalog_search_norm(left(coalesce(p_query, ''), 200))); toks text[];
  lim integer := greatest(1, least(coalesce(p_limit, 30), 100)); off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint; items jsonb; toks_r text[];
BEGIN
  PERFORM public.catalog_require_reader();
  toks := array_remove(string_to_array(q, ' '), '');
  -- rodzaj nie zależy od opakowania: „woda 1,5 l” szuka rodzajów jak „woda” (procenty zostają: „mleko 2%”)
  SELECT coalesce(array_agg(x ORDER BY nr), '{}') INTO toks_r FROM unnest(toks) WITH ORDINALITY AS u(x, nr)
  WHERE x !~ '^[0-9,]+(g|kg|dag|ml|l|szt)?$' AND x NOT IN ('g', 'kg', 'dag', 'ml', 'l', 'szt', 'x');
  IF coalesce(array_length(toks, 1), 0) = 0 THEN
    RETURN jsonb_build_object('version', 1, 'query', q, 'total', 0, 'limit', lim, 'offset', off, 'items', '[]'::jsonb);
  END IF;
  WITH rodzaje AS (
    -- n = produkty rodzaju (z ofertami), m = te z nich, które pasują do zapytania
    SELECT t.id, t.name, t.parent_id, coalesce(t.search_name, '') AS tn, count(*) AS n,
      count(*) FILTER (WHERE public.catalog_search_match(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), toks_r)
        AND public.catalog_search_name_match(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), toks_r)) AS m
    FROM public.product_types t
    JOIN public.product_types tc ON tc.id = t.id OR tc.parent_id = t.id
    JOIN public.products p ON p.product_type_id = tc.id
    WHERE p_with_types AND cardinality(toks_r) > 0 AND t.is_active
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
    -- rodzaj pasuje nazwą albo większością swoich produktów (nie jednym produktem „z pomidorami”)
    -- 200 dokładnie, 160 nazwa zaczyna się całymi słowami zapytania („ser” -> „Ser Gouda”), 150 początkiem słowa („Serek …”)
    SELECT r.id, r.name, r.n, r.parent_id, coalesce(ss.sieci, 0) AS sieci, (CASE WHEN r.tn = q THEN 200
        WHEN r.nazwa AND r.tn LIKE array_to_string(toks_r, ' ') || ' %' THEN 160
        WHEN r.nazwa AND r.tn LIKE array_to_string(toks_r, ' ') || '%' THEN 150 WHEN r.nazwa THEN 120 ELSE 60 END) + 1000 AS score
    FROM (SELECT r.*, public.catalog_search_name_match(r.tn, toks_r) AS nazwa FROM rodzaje r) r
    LEFT JOIN smaki_sieci ss ON ss.id = r.id
    WHERE r.m > 0 AND (r.nazwa OR r.m * 2 >= r.n)
  ), pokazane AS (
    -- rodzaje w wynikach razem ze smakami rodzajów nadrzędnych: ich produkty nie są pokazywane osobno
    SELECT y.id FROM typy y
    WHERE y.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM typy p WHERE p.id = y.parent_id)
       OR (SELECT p.score FROM typy p WHERE p.id = y.parent_id) < y.score OR y.sieci >= 2
  ), pokryte AS (
    SELECT id FROM pokazane
    UNION
    SELECT c.id FROM public.product_types c JOIN pokazane s ON s.id = c.parent_id
  ), kandydaci AS (
    SELECT g.id, g.name, g.group_key, coalesce(g.search_name, '') AS gn, count(*) AS n,
      bool_or(public.catalog_search_match(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, '')
        || CASE WHEN g.group_key LIKE 'product:%' THEN ' ' || coalesce(bp.search_name, '') ELSE '' END, toks)) AS w_produkcie,
      bool_and(pk.id IS NOT NULL) AS w_pokazanych
    FROM public.comparison_groups g
    JOIN public.products p ON p.comparison_group_id = g.id
    JOIN public.base_products bp ON bp.id = p.base_product_id AND bp.subcategory_id IS NOT NULL
    LEFT JOIN pokryte pk ON pk.id = p.product_type_id
    WHERE EXISTS (SELECT 1 FROM public.store_offers so JOIN public.stores st ON st.id = so.store_id AND st.is_active WHERE so.product_id = p.id)
    GROUP BY g.id
  ), trafienia AS (
    -- s1/s2/fam: miejsce na liście; smak stoi zaraz za swoim rodzajem nadrzędnym (pod = 1), popularniejsze wyżej
    SELECT 'group'::text AS rodzaj, k.id, k.name, k.n, s.score AS s1, k.n AS s2, k.id AS fam, 0 AS pod
    FROM kandydaci k
    CROSS JOIN LATERAL (SELECT public.catalog_search_name_match(k.gn, toks) AS nazwa) nm
    CROSS JOIN LATERAL (SELECT (CASE WHEN k.gn = q THEN 200 WHEN nm.nazwa AND k.gn LIKE q || ' %' THEN 160
        WHEN nm.nazwa AND k.gn LIKE q || '%' THEN 150
        WHEN nm.nazwa THEN 120 ELSE 60 END
      + CASE WHEN k.group_key LIKE 'product:%' THEN 0 ELSE 40 END) AS score) s
    WHERE k.w_produkcie AND NOT (p_with_types AND k.w_pokazanych)
    UNION ALL
    SELECT 'type', y.id, y.name, y.n,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.score ELSE y.score END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.n ELSE y.n END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN p.id ELSE y.id END,
      CASE WHEN p.id IS NOT NULL AND y.score <= p.score THEN 1 ELSE 0 END
    FROM typy y JOIN pokazane z ON z.id = y.id LEFT JOIN typy p ON p.id = y.parent_id
  )
  SELECT (SELECT count(*) FROM trafienia),
    (SELECT coalesce(jsonb_agg(CASE WHEN x.rodzaj = 'type' THEN public.catalog_type_item(x.id) ELSE public.catalog_item(x.id) END
       ORDER BY x.s1 DESC, x.s2 DESC, x.rodzaj, x.fam, x.pod, x.n DESC, x.name, x.id), '[]'::jsonb)
     FROM (SELECT * FROM trafienia ORDER BY s1 DESC, s2 DESC, rodzaj, fam, pod, n DESC, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1, 'query', q, 'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_search_glue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_search_glue(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalog_search_name_match(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_search_name_match(text, text[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
