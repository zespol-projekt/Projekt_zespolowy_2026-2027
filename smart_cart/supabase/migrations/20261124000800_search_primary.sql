-- Wyszukiwanie: trafienie „główne” (24.11.2026).
-- Rodzaje i produkty z rodzajem są pokazywane tylko wtedy, gdy słowo zapytania jest w nazwie samym produktem, a nie dodatkiem
-- ani smakiem. Przykład: „pomidor” nie daje już „Gołąbki”, „Pulpety / klopsiki w sosie”, „Owoce morza” ani „Pesto czerwone”
-- (produkty „w sosie pomidorowym”, „z suszonymi pomidorami”).
-- Zmiany względem 20261124000700:
-- - nowa funkcja catalog_search_primary (dodatek: przymiotnik „pomidorowy”, słowo po „w / sosie / smaku…”, narzędnik po „z / i”);
-- - rodzaj pasuje nazwą albo, jeśli jest nadrzędny, większością swoich produktów (bez progu 1/3 z 000700);
--   smak (rodzaj podrzędny) nie jest dociągany przez produkty, tylko nazwą („truskawki” nie daje „Mus owocowy truskawkowy”).
-- Zapisane w Dane_sklepy_current/rodzaje_produktow/wyszukiwanie_800.sql.

-- Dopasowanie całych słów z prostą odmianą: słowo zapytania bez końcówki (co najmniej 5 liter) może być początkiem słowa w nazwie
-- („cytryna” -> „cytrynowa”, „jablka” -> „jablkowy”, „pomidory” -> „pomidorowym”). Krótsze słowa jak dotąd („kawa” nie trafia w „kawałki”).
CREATE OR REPLACE FUNCTION public.catalog_search_name_match(p_text text, p_tokens text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM (
      SELECT t.tok, t.nr, CASE WHEN length(s.rdzen) >= 5 AND s.rdzen <> t.tok THEN s.rdzen END AS rdzen
      FROM unnest(p_tokens) WITH ORDINALITY AS t(tok, nr)
      CROSS JOIN LATERAL (SELECT regexp_replace(t.tok, '(ami|ach|ow|om|em|a|y|i|e|o|u)$', '') AS rdzen) s
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(coalesce(p_text, ''), ' ')) AS w(word)
      WHERE w.word = t.tok
         OR (t.nr = cardinality(p_tokens) AND left(w.word, length(t.tok)) = t.tok AND length(t.tok) * 10 >= length(w.word) * 6)
         OR (t.rdzen IS NOT NULL AND left(w.word, length(t.rdzen)) = t.rdzen AND length(t.rdzen) * 10 >= length(w.word) * 6)));
$$;

-- Trafienie „główne”: słowo zapytania jest w nazwie samym produktem, a nie dodatkiem lub smakiem. Dodatek to:
-- przymiotnik od słowa zapytania („pomidor” -> „sos pomidorowy”, „cytryna” -> „ice tea cytrynowa”),
-- słowo po „w / o / sosie / smaku / nadzieniem …” („gołąbki w sosie pomidorowym”, „orzechy w czekoladzie”),
-- narzędnik po „z / ze / i” („pesto z suszonymi pomidorami”, „pierogi z serem”; ale „filet z kurczaka” to główne).
-- Rodzaje i produkty z rodzajem są pokazywane tylko przy trafieniu głównym.
CREATE OR REPLACE FUNCTION public.catalog_search_primary(p_text text, p_tokens text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH w AS (SELECT string_to_array(coalesce(p_text, ''), ' ') AS ws),
  t AS (
    SELECT t.tok, t.nr, CASE WHEN length(s.rdzen) >= 5 AND s.rdzen <> t.tok THEN s.rdzen END AS rdzen
    FROM unnest(p_tokens) WITH ORDINALITY AS t(tok, nr)
    CROSS JOIN LATERAL (SELECT regexp_replace(t.tok, '(ami|ach|ow|om|em|a|y|i|e|o|u)$', '') AS rdzen) s
  )
  SELECT EXISTS (
    SELECT 1 FROM w, t, unnest(w.ws) WITH ORDINALITY AS x(word, i)
    CROSS JOIN LATERAL (SELECT CASE
        WHEN x.word = t.tok THEN ''
        WHEN t.nr = cardinality(p_tokens) AND left(x.word, length(t.tok)) = t.tok AND length(t.tok) * 10 >= length(x.word) * 6
          THEN substr(x.word, length(t.tok) + 1)
        WHEN t.rdzen IS NOT NULL AND left(x.word, length(t.rdzen)) = t.rdzen AND length(t.rdzen) * 10 >= length(x.word) * 6
          THEN substr(x.word, length(t.rdzen) + 1) END AS reszta,
      coalesce(w.ws[x.i - 1], '') AS p1, coalesce(w.ws[x.i - 2], '') AS p2) m
    WHERE m.reszta IS NOT NULL
      AND m.reszta !~ '^ow'
      AND m.p1 NOT IN ('w', 'we', 'o', 'sos', 'sosie', 'sosem', 'smaku', 'smak', 'dodatkiem', 'nadzieniem', 'kremem', 'polewie', 'zalewie', 'marynacie', 'galarecie')
      AND m.p2 NOT IN ('w', 'we', 'o', 'sos', 'sosie', 'sosem', 'smaku', 'dodatkiem', 'nadzieniem', 'kremem', 'polewie', 'zalewie', 'marynacie', 'galarecie')
      AND NOT ((m.p1 IN ('z', 'ze', 'i', 'oraz') OR m.p2 IN ('z', 'ze', 'i', 'oraz')) AND x.word ~ '(ami|mi|em)$'));
$$;

-- Szybki filtr przed catalog_search_name_match: każdy rdzeń (słowo zapytania bez końcówki) jest początkiem jakiegoś słowa.
CREATE OR REPLACE FUNCTION public.catalog_search_stems(p_tokens text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(CASE WHEN length(r) >= 5 THEN r ELSE tok END ORDER BY nr), '{}')
  FROM unnest(p_tokens) WITH ORDINALITY AS t(tok, nr)
  CROSS JOIN LATERAL (SELECT regexp_replace(tok, '(ami|ach|ow|om|em|a|y|i|e|o|u)$', '') AS r) s;
$$;

CREATE OR REPLACE FUNCTION public.catalog_search_prefix(p_text text, p_stems text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(p_stems) AS t(st) WHERE position(' ' || t.st IN ' ' || coalesce(p_text, '')) = 0);
$$;

CREATE OR REPLACE FUNCTION public.catalog_search(p_query text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_with_types boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE q text := public.catalog_search_glue(public.catalog_search_norm(left(coalesce(p_query, ''), 200))); toks text[];
  lim integer := greatest(1, least(coalesce(p_limit, 30), 100)); off integer := greatest(coalesce(p_offset, 0), 0);
  total bigint; items jsonb; toks_r text[]; st text[]; st_r text[];
BEGIN
  PERFORM public.catalog_require_reader();
  toks := array_remove(string_to_array(q, ' '), '');
  -- rodzaj nie zależy od opakowania: „woda 1,5 l” szuka rodzajów jak „woda” (procenty zostają: „mleko 2%”)
  SELECT coalesce(array_agg(x ORDER BY nr), '{}') INTO toks_r FROM unnest(toks) WITH ORDINALITY AS u(x, nr)
  WHERE x !~ '^[0-9,]+(g|kg|dag|ml|l|szt)?$' AND x NOT IN ('g', 'kg', 'dag', 'ml', 'l', 'szt', 'x');
  st := public.catalog_search_stems(toks); st_r := public.catalog_search_stems(toks_r);
  IF coalesce(array_length(toks, 1), 0) = 0 THEN
    RETURN jsonb_build_object('version', 1, 'query', q, 'total', 0, 'limit', lim, 'offset', off, 'items', '[]'::jsonb);
  END IF;
  WITH rodzaje AS (
    -- n = produkty rodzaju (z ofertami), m = te z nich, które pasują do zapytania
    SELECT t.id, t.name, t.parent_id, coalesce(t.search_name, '') AS tn, count(*) AS n,
      count(*) FILTER (WHERE public.catalog_search_prefix(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), st_r)
        AND public.catalog_search_name_match(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), toks_r)
        AND public.catalog_search_primary(coalesce(t.search_name, '') || ' ' || coalesce(p.search_text, ''), toks_r)) AS m
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
    -- rodzaj pasuje nazwą albo (rodzaj nadrzędny) większością swoich produktów, zawsze trafieniem głównym (catalog_search_primary):
    -- „pomidor” nie daje „Gołąbki” przez „gołąbki w sosie pomidorowym” ani smaku „Mus owocowy truskawkowy” przez „mus jabłko-truskawka”
    -- 200 dokładnie, 160 nazwa zaczyna się całymi słowami zapytania („ser” -> „Ser Gouda”), 150 początkiem słowa („Serek …”)
    SELECT r.id, r.name, r.n, r.parent_id, coalesce(ss.sieci, 0) AS sieci, (CASE WHEN r.tn = q THEN 200
        WHEN r.nazwa AND r.tn LIKE array_to_string(toks_r, ' ') || ' %' THEN 160
        WHEN r.nazwa AND (r.tn LIKE array_to_string(toks_r, ' ') || '%' OR r.tn LIKE array_to_string(st_r, ' ') || '%') THEN 150
        WHEN r.nazwa THEN 120
        ELSE 60 END) + 1000 AS score
    FROM (SELECT r.*, public.catalog_search_name_match(r.tn, toks_r) AND public.catalog_search_primary(r.tn, toks_r) AS nazwa FROM rodzaje r) r
    LEFT JOIN smaki_sieci ss ON ss.id = r.id
    WHERE r.m > 0 AND (r.nazwa OR (r.parent_id IS NULL AND r.m * 2 >= r.n))
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
      -- produkt z rodzajem (wyszukiwanie z rodzajami): tylko jego nazwa, całymi słowami. Produkt bazowy („Rodzynki / Żurawina /
      -- Daktyle”) i początek marki („mleko” w „Mlekovita”) nie wystarczą: taki produkt jest już w swoim rodzaju.
      bool_or(CASE WHEN p_with_types AND p.product_type_id IS NOT NULL THEN
          public.catalog_search_prefix(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, ''), st)
          AND public.catalog_search_name_match(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, ''), toks)
          AND public.catalog_search_primary(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, ''), toks)
        ELSE public.catalog_search_match(coalesce(g.search_name, '') || ' ' || coalesce(p.search_text, '')
          || CASE WHEN g.group_key LIKE 'product:%' THEN ' ' || coalesce(bp.search_name, '') ELSE '' END, toks) END) AS w_produkcie,
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
        WHEN nm.nazwa AND (k.gn LIKE q || '%' OR k.gn LIKE array_to_string(st, ' ') || '%') THEN 150
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

NOTIFY pgrst, 'reload schema';
