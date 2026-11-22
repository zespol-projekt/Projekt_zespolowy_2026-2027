-- Poprawki API katalogu (22.11.2026), zgłoszone przez Radka. Kształt odpowiedzi i version: 1 bez zmian.
-- 1. catalog_search: wszystkie słowa zapytania muszą wystąpić w JEDNYM produkcie (razem z nazwą jego grupy),
--    a nie w dowolnych produktach grupy; w grupach zamienników nie przeszukujemy nazwy produktu bazowego
--    (cechy opisuje nazwa grupy); słowa wpisane w całości dopasowujemy jako całe wyrazy („bez” nie trafia
--    w „bezglutenowe”), a ostatnie słowo - jeszcze wpisywane - jako początek wyrazu („łaci” trafia w „łaciate”).
--    Przykład: „mleko 3,2% bez laktozy” nie zwraca już grupy „Mleko świeże 3,2% · z laktozą”,
--    a „mleko uht 3,2%” - grup mleka świeżego (produkty świeże mają produkt bazowy „Mleko UHT 3,2%”).
-- 2. Dane: produkty w grupach mleka z produktem bazowym niezgodnym z laktozą grupy dostają zgodny produkt bazowy
--    (na wspólnej bazie 22.11.2026: 4 produkty z dawnego importu). Grupy, listy i ulubione bez zmian.
-- 3. compare_basket: każdy wybór (picks[]) ma price_source - źródło ceny, do podpisania daty ceny w Koszyku.

-- 1. Tekst wyszukiwania: produkt = sama nazwa; produkt bazowy osobno (używany tylko w pojedynczych produktach).
ALTER TABLE public.base_products ADD COLUMN search_name text;
CREATE FUNCTION public.base_products_search_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_name := public.catalog_search_norm(NEW.name);
  RETURN NEW;
END;
$$;
CREATE TRIGGER base_products_search_name BEFORE INSERT OR UPDATE OF name ON public.base_products
  FOR EACH ROW EXECUTE FUNCTION public.base_products_search_name();
UPDATE public.base_products SET search_name = public.catalog_search_norm(name);

CREATE OR REPLACE FUNCTION public.products_search_text() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search_text := public.catalog_search_norm(NEW.canonical_name);
  RETURN NEW;
END;
$$;
ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
UPDATE public.products SET search_text = public.catalog_search_norm(canonical_name);
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;

-- Czy tekst zawiera wszystkie słowa zapytania: wszystkie poza ostatnim jako całe wyrazy, ostatnie jako początek wyrazu.
CREATE FUNCTION public.catalog_search_match(p_text text, p_tokens text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(p_tokens) WITH ORDINALITY AS t(tok, nr)
    WHERE position(' ' || t.tok || CASE WHEN t.nr < cardinality(p_tokens) THEN ' ' ELSE '' END
                   IN ' ' || coalesce(p_text, '') || ' ') = 0);
$$;
REVOKE ALL ON FUNCTION public.catalog_search_match(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_search_match(text, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.base_products_search_name() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.catalog_search(p_query text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0) RETURNS jsonb
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
        || CASE WHEN g.group_key LIKE 'product:%' THEN ' ' || coalesce(bp.search_name, '') ELSE '' END, toks)) AS w_produkcie
    FROM public.comparison_groups g
    JOIN public.products p ON p.comparison_group_id = g.id
    JOIN public.base_products bp ON bp.id = p.base_product_id AND bp.subcategory_id IS NOT NULL
    WHERE EXISTS (SELECT 1 FROM public.store_offers so JOIN public.stores st ON st.id = so.store_id AND st.is_active WHERE so.product_id = p.id)
    GROUP BY g.id
  ), trafienia AS (
    SELECT k.id, k.name, k.n, (CASE WHEN k.gn = q THEN 200 WHEN k.gn LIKE q || '%' THEN 150
        WHEN public.catalog_search_match(k.gn, toks) THEN 120 ELSE 60 END
      + CASE WHEN k.group_key LIKE 'product:%' THEN 0 ELSE 40 END) AS score
    FROM kandydaci k
    WHERE k.w_produkcie
  )
  SELECT (SELECT count(*) FROM trafienia),
    (SELECT coalesce(jsonb_agg(public.catalog_item(x.id) ORDER BY x.score DESC, x.n DESC, x.name, x.id), '[]'::jsonb)
     FROM (SELECT * FROM trafienia ORDER BY score DESC, n DESC, name, id LIMIT lim OFFSET off) x)
  INTO total, items;
  RETURN jsonb_build_object('version', 1, 'query', q, 'total', total, 'limit', lim, 'offset', off, 'items', items);
END;
$$;

-- 2. Produkty bazowe mleka zgodne z laktozą grupy. Funkcja administracyjna (do ponownego użycia po imporcie).
CREATE FUNCTION public.align_milk_base_products() RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE bez bigint; uht32 bigint; m15 bigint; n integer;
BEGIN
  SELECT min(id) INTO bez FROM public.base_products WHERE name = 'Mleko bez laktozy' HAVING count(*) = 1;
  SELECT min(id) INTO uht32 FROM public.base_products WHERE name = 'Mleko UHT 3,2%' HAVING count(*) = 1;
  SELECT min(id) INTO m15 FROM public.base_products WHERE name = 'Mleko 1,5% - 2,0%' HAVING count(*) = 1;
  IF bez IS NULL OR uht32 IS NULL OR m15 IS NULL THEN RAISE NOTICE 'Brak jednoznacznych produktów bazowych mleka - bez zmian.'; RETURN 0; END IF;
  IF (SELECT count(DISTINCT subcategory_id) FROM public.base_products WHERE id IN (bez, uht32, m15)) <> 1
    OR EXISTS (SELECT 1 FROM public.base_products WHERE id IN (bez, uht32, m15) AND subcategory_id IS NULL)
    THEN RAISE EXCEPTION 'Produkty bazowe mleka są w różnych podkategoriach - poprawka przerwana.'; END IF;
  WITH zmiany AS (
    SELECT p.id, CASE
        WHEN g.group_key LIKE '%:bez laktozy%' THEN bez
        WHEN split_part(g.group_key, ':', 3) = '3.2' THEN uht32
        WHEN split_part(g.group_key, ':', 3) IN ('1.5', '2') THEN m15 END AS nowy
    FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id
    JOIN public.base_products b ON b.id = p.base_product_id
    WHERE g.group_key LIKE 'milk:%' AND b.subcategory_id = (SELECT subcategory_id FROM public.base_products WHERE id = bez)
      AND ((g.group_key LIKE '%:bez laktozy%' AND p.base_product_id <> bez)
        OR (g.group_key LIKE '%:z laktozą%' AND p.base_product_id = bez))
  )
  UPDATE public.products p SET base_product_id = z.nowy FROM zmiany z WHERE p.id = z.id AND z.nowy IS NOT NULL AND z.nowy <> p.base_product_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 50 THEN RAISE EXCEPTION 'Poprawka produktów bazowych mleka zmieniłaby % produktów - przerwana, sprawdź dane.', n; END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.align_milk_base_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.align_milk_base_products() TO service_role;
DO $$ BEGIN RAISE NOTICE 'Poprawione produkty bazowe mleka: %', public.align_milk_base_products(); END $$;

-- 3. compare_basket: price_source w każdym wyborze (jedyna zmiana względem wersji z 20261114000200).
CREATE OR REPLACE FUNCTION "public"."plan_group_purchase"("gid" bigint, "sid" integer, "needed" numeric, "wanted_unit" "text", "pinned" bigint DEFAULT NULL::bigint, "extra" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE states jsonb:='{"0":{"cost":0,"amount":0,"picks":[]}}'; next_states jsonb;
  o record; st record; old jsonb; candidate jsonb; pick jsonb; priced jsonb;
  q numeric; n integer; max_n integer; qty numeric; actual numeric; cost numeric; state_key text;
  best jsonb; best_regular numeric; bulk_n numeric; label text;
BEGIN
  SELECT name INTO label FROM public.comparison_groups WHERE id=gid AND unit=wanted_unit;
  IF label IS NULL THEN RAISE EXCEPTION 'Nieprawidłowy produkt lub jednostka.' USING ERRCODE='22023'; END IF;
  IF needed<=0 OR needed>100000 OR scale(needed)>2 OR (wanted_unit='szt' AND needed<>trunc(needed)) THEN
    RAISE EXCEPTION 'Podaj poprawną ilość (maksymalnie 100000, do dwóch miejsc po przecinku).' USING ERRCODE='22023'; END IF;
  IF pinned IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=pinned AND comparison_group_id=gid) THEN
    RAISE EXCEPTION 'Wybrany produkt nie należy do grupy.' USING ERRCODE='22023'; END IF;
  FOR o IN SELECT c.*,to_jsonb(c) AS data FROM public.catalog_offers c
    WHERE c.group_id=gid AND c.store_id=sid AND c.quantity_unit=wanted_unit AND c.quantity_value>0
      AND c.sale_mode='package' AND (pinned IS NULL OR c.product_id=pinned) ORDER BY c.offer_id
  LOOP
    q:=o.quantity_value; next_states:=states;
    FOR st IN SELECT key,value FROM jsonb_each(states) LOOP
      qty:=st.key::numeric; IF qty>=needed THEN CONTINUE; END IF;
      max_n:=ceil((needed-qty)/q)::integer;
      IF extra AND o.verified_promotion THEN
        max_n:=greatest(max_n,coalesce((o.promo_rule->>'min_quantity')::integer,1));
        IF o.promo_rule->>'kind'='bundle' THEN
          max_n:=ceil(max_n::numeric/(o.promo_rule->>'bundle_size')::integer)::integer*(o.promo_rule->>'bundle_size')::integer;
        END IF;
      END IF;
      IF max_n>1000 THEN RAISE EXCEPTION 'Zbyt wiele opakowań. Zmniejsz ilość jednej pozycji.' USING ERRCODE='22023'; END IF;
      FOR n IN 1..max_n LOOP
        priced:=public.purchase_price(o.data,n);
        IF priced->>'cost' IS NULL THEN CONTINUE; END IF;
        cost:=(st.value->>'cost')::numeric+(priced->>'cost')::numeric;
        actual:=(st.value->>'amount')::numeric+n*q;
        state_key:=least(needed,qty+n*q)::text;
        old:=next_states->state_key;
        IF old IS NULL OR cost<(old->>'cost')::numeric OR (cost=(old->>'cost')::numeric AND actual<(old->>'amount')::numeric) THEN
          pick:=jsonb_build_object('offer_id',o.offer_id,'product_id',o.product_id,'name',o.product_name,
            'package_count',n,'quantity',n*q,'unit',wanted_unit,'sale_mode','package','total_price',(priced->>'cost')::numeric,
            'regular_total',(priced->>'regular_total')::numeric,'promotion_applied',(priced->>'promotion_applied')::boolean,
            'requires_activation',(priced->>'requires_activation')::boolean,'requires_card',(priced->>'requires_card')::boolean,
            'condition',o.promo_condition,'observed_at',o.regular_price_observed_at,'price_source',o.price_source,'valid_from',o.valid_from,'valid_to',o.valid_to);
          next_states:=jsonb_set(next_states,ARRAY[state_key],jsonb_build_object('cost',cost,'amount',actual,'picks',(st.value->'picks')||jsonb_build_array(pick)));
        END IF;
      END LOOP;
    END LOOP;
    states:=next_states;
    IF (SELECT count(*) FROM jsonb_object_keys(states))>10000 THEN
      RAISE EXCEPTION 'Zbyt wiele wariantów opakowań. Zmniejsz ilość lub wybierz konkretny produkt.' USING ERRCODE='22023'; END IF;
  END LOOP;
  best:=states->needed::text;
  -- A loose offer can cover the remaining mass after any package combination.
  FOR o IN SELECT c.*,to_jsonb(c) AS data FROM public.catalog_offers c
    WHERE c.group_id=gid AND c.store_id=sid AND c.quantity_unit=wanted_unit AND c.quantity_value>0
      AND c.sale_mode='bulk' AND (pinned IS NULL OR c.product_id=pinned) ORDER BY c.offer_id
  LOOP
    FOR st IN SELECT key,value FROM jsonb_each(states) LOOP
      qty:=st.key::numeric; IF qty>=needed THEN CONTINUE; END IF;
      bulk_n:=(needed-qty)/o.quantity_value;
      priced:=public.purchase_price(o.data,bulk_n);
      IF priced->>'cost' IS NULL THEN CONTINUE; END IF;
      cost:=(st.value->>'cost')::numeric+(priced->>'cost')::numeric;
      IF best IS NULL OR cost<(best->>'cost')::numeric OR (cost=(best->>'cost')::numeric AND needed<(best->>'amount')::numeric) THEN
        pick:=jsonb_build_object('offer_id',o.offer_id,'product_id',o.product_id,'name',o.product_name,
          'package_count',NULL,'quantity',needed-qty,'unit',wanted_unit,'sale_mode','bulk','total_price',(priced->>'cost')::numeric,
          'regular_total',(priced->>'regular_total')::numeric,'promotion_applied',(priced->>'promotion_applied')::boolean,
          'requires_activation',(priced->>'requires_activation')::boolean,'requires_card',(priced->>'requires_card')::boolean,
          'condition',o.promo_condition,'observed_at',o.regular_price_observed_at,'price_source',o.price_source,'valid_from',o.valid_from,'valid_to',o.valid_to);
        best:=jsonb_build_object('cost',cost,'amount',needed,'picks',(st.value->'picks')||jsonb_build_array(pick));
      END IF;
    END LOOP;
  END LOOP;
  IF best IS NULL THEN RETURN jsonb_build_object('status','missing','name',label,'required_quantity',needed,'unit',wanted_unit,
    'total_price',NULL,'picks','[]'::jsonb,'reason','Brak produktu/ceny w bazie danych lub potwierdzonego sposobu sprzedaży.'); END IF;
  SELECT CASE WHEN count(*)=count(v->>'regular_total') THEN sum((v->>'regular_total')::numeric) END
    INTO best_regular FROM jsonb_array_elements(best->'picks') v;
  RETURN jsonb_build_object('status','priced','name',label,'required_quantity',needed,'unit',wanted_unit,
    'total_price',(best->>'cost')::numeric,'regular_total',best_regular,
    'purchased_quantity',(best->>'amount')::numeric,'surplus',(best->>'amount')::numeric-needed,'picks',best->'picks');
END;
$$;

