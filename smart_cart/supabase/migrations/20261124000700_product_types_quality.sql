-- Jakość rodzajów i wyszukiwania (24.11.2026).
-- 1. Wyszukiwanie z rodzajami: produkt z rodzajem trafia tylko nazwą, całymi słowami (nie produktem bazowym „Rodzynki / Żurawina /
--    Daktyle” ani początkiem marki „Mlekovita”); rodzaj jest pokazywany także, gdy pasuje co najmniej 3 i 1/3 jego produktów
--    („mleko” -> „Mleko smakowe”). Dzięki temu wyniki pokazują rodzaje zamiast wielu pojedynczych produktów.
-- 2. 61 korekt przypisań: reguły przed wszystkimi innymi (priorytet ujemny, notatka „korekta”), np. twaróg półtłusty był
--    w „Twaróg tłusty” (wzorzec „tlust” trafiał w „poltlusty”), „Daktyle … cola” w „Cola”.
-- 3. 17 rodzajów dostaje nazwy ze słowami, którymi klienci szukają (slug bez zmian), np. „Napój mleczny smakowy” -> „Mleko smakowe (napój mleczny)”.
-- Wygenerowane skryptem Dane_sklepy_current/rodzaje_produktow/generuj_korekty.py (korekty.py, korekty_bazy.py, wyszukiwanie_700.sql).

-- Przeliczenie rodzajów trwa na wspólnej bazie dłużej niż jej domyślny limit czasu polecenia (db push zgłosił „statement timeout”).
SET statement_timeout = '15min';

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
    -- rodzaj pasuje nazwą, większością swoich produktów albo co najmniej trzema produktami i jedną trzecią
    -- („mleko” -> „Mleko smakowe”: „mleko czekoladowe”, ale „napój mleczny Milka”); nie jednym produktem „z pomidorami”
    -- 200 dokładnie, 160 nazwa zaczyna się całymi słowami zapytania („ser” -> „Ser Gouda”), 150 początkiem słowa („Serek …”)
    SELECT r.id, r.name, r.n, r.parent_id, coalesce(ss.sieci, 0) AS sieci, (CASE WHEN r.tn = q THEN 200
        WHEN r.nazwa AND r.tn LIKE array_to_string(toks_r, ' ') || ' %' THEN 160
        WHEN r.nazwa AND (r.tn LIKE array_to_string(toks_r, ' ') || '%' OR r.tn LIKE array_to_string(st_r, ' ') || '%') THEN 150
        WHEN r.nazwa THEN 120
        WHEN r.m * 2 >= r.n THEN 60 ELSE 50 END) + 1000 AS score
    FROM (SELECT r.*, public.catalog_search_name_match(r.tn, toks_r) AS nazwa FROM rodzaje r) r
    LEFT JOIN smaki_sieci ss ON ss.id = r.id
    WHERE r.m > 0 AND (r.nazwa OR r.m * 2 >= r.n OR (r.m >= 3 AND r.m * 3 >= r.n))
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

INSERT INTO public.product_type_rules(product_type_id, priority, base_product_names, include_pattern, exclude_pattern, note)
SELECT t.id, v.priority, v.names, v.include_pattern, v.exclude_pattern, 'korekta'
FROM (VALUES
  ('Twaróg półtłusty', -99990, ARRAY['Twaróg półtłusty / chudy'], 'twarog.*poltl|poltl.*twarog', 'serek|smarow|puszyst|kanap'),
  ('Twaróg tłusty', -99980, ARRAY['Pozostałe serki i twarogi'], '^twarog smietankowy', NULL),
  ('Serek do smarowania z ziołami / czosnkiem', -99970, ARRAY['Pozostałe serki i twarogi', 'Pozostałe sery'], '\ytartare', NULL),
  ('Ser kozi', -99960, ARRAY['Pozostałe serki i twarogi'], 'kozi twarog', NULL),
  ('Daktyle suszone', -99950, ARRAY['Napój gazowany typu Cola'], '^daktyle', NULL),
  ('Donut / pączek', -99940, ARRAY['Kakao ciemne', 'Napój gazowany typu Cola'], '^donut (cola|today)', NULL),
  ('Koncentrat napoju (do rozcieńczania / saturatora)', -99930, ARRAY['Napój gazowany typu Cola', 'Pozostałe soki, nektary i syropy'], 'koncentrat napoju cola|syrop sodastream', NULL),
  ('Biszkopty', -99920, ARRAY['Pozostałe jogurty i desery mleczne'], '^biszkopty deserowe', NULL),
  ('Herbatniki / ciastka maślane', -99910, ARRAY['Pozostałe jogurty i desery mleczne'], '^herbatniki deserowe', NULL),
  ('Czekolada mleczna', -99900, ARRAY['Pozostałe jogurty i desery mleczne', 'Płatki śniadaniowe / Musli / Granola'], '^czekol\w* mlecz deser|^czekolada nesquik', NULL),
  ('Czekolada mleczna nadziewana', -99890, ARRAY['Bombonierka / Czekoladki (np. Merci / Raffaello)', 'Herbatniki / Ciastka / Biszkopty', 'Pozostałe ciastka, wafle i batony', 'Pozostałe jogurty i desery mleczne'], '^czeko nadziana|^czekolada milka oreo|^czekolada piernik|^czekolada (ferrero|raffaello)', NULL),
  ('Polewa / lukier', -99880, ARRAY['Pozostałe jogurty i desery mleczne'], '^polewa', NULL),
  ('Kanapka mleczna (Kinder Pingui, Mleczna kanapka)', -99870, ARRAY['Pozostałe jogurty i desery mleczne', 'Płatki śniadaniowe / Musli / Granola'], 'kanapka monte|^mlecz\w* kanapka', NULL),
  ('Pierniki', -99860, ARRAY['Pozostałe czekolady, praliny i figurki', 'Pozostałe jogurty i desery mleczne'], '^pierniki|kostki domino', NULL),
  ('Deser mleczny / budyń', -99850, ARRAY['Pozostałe jogurty i desery mleczne', 'Płatki śniadaniowe / Musli / Granola'], 'bita smietana czekol|^jogurt lion', NULL),
  ('Budyń', -99840, ARRAY['Płatki śniadaniowe / Musli / Granola'], 'budyn.*nesquik', NULL),
  ('Kulki mocy / kulki daktylowe', -99830, ARRAY['Kakao ciemne'], 'kulki w kakao', NULL),
  ('Wafelek w czekoladzie (Prince Polo, Grześki, KitKat…)', -99820, ARRAY['Pozostałe ciastka, wafle i batony'], '^wafle (w czekol|rurki czekol)', NULL),
  ('Croissant / rogalik', -99810, ARRAY['Drożdżówka / Croissant / Pączek', 'Kakao ciemne'], 'croissant z nadz\w* mix|croissant paczek', NULL),
  ('Lizaki', -99800, ARRAY['Kakao ciemne'], '^lizak', NULL),
  ('Cukierki czekoladowe (Michałki…)', -99790, ARRAY['Herbatniki / Ciastka / Biszkopty', 'Kakao ciemne', 'Pozostałe cukierki, gumy i lizaki', 'Pozostałe czekolady, praliny i figurki'], '^cukierki kakao|^cukierki z nadzieniem oreo|michaszki', NULL),
  ('Babka', -99780, ARRAY['Pozostałe jogurty i desery mleczne'], '^babka', 'jajowat|lupin'),
  ('Tort', -99770, ARRAY['Pozostałe jogurty i desery mleczne'], '^tort\y', NULL),
  ('Napój / jogurt proteinowy', -99760, ARRAY['Jogurt owocowy / pitny', 'Pozostałe jogurty i desery mleczne'], 'jogurt wysokobialkowy (banan|trusk|malin|wisn|brzosk|mango|jagod)', NULL),
  ('Bajgiel', -99750, ARRAY['Słonecznik / Pestki dyni / Sezam / Siemię lniane'], '^bajgiel', NULL),
  ('Baton owocowy / orzechowy (raw)', -99740, ARRAY['Orzechy (Włoskie / Laskowe / Nerkowca / Migdały)'], '^baton orzech', 'prot'),
  ('Bombonierka / praliny (inne)', -99730, ARRAY['Ptasie Mleczko / Pianki w czekoladzie'], '^bombonierka alpejsk', NULL),
  ('Burgery / nuggetsy roślinne', -99720, ARRAY['Pozostałe rośliny strączkowe'], 'burger z grochu', NULL),
  ('Carpaccio wołowe', -99710, ARRAY['Ser twardy (Parmezan / Grana Padano / Bursztyn)'], '^carpaccio', NULL),
  ('Chipsy z ciecierzycy / warzywne / proteinowe', -99700, ARRAY['Soczewica / Ciecierzyca sucha / Fasola sucha'], '^chrupki soczew', NULL),
  ('Chipsy ziemniaczane', -99690, ARRAY['Pozostałe słone przekąski'], '^chrupki ziemniacz', NULL),
  ('Ciastka owsiane / zbożowe (BelVita…)', -99680, ARRAY['Pozostałe ciastka, wafle i batony', 'Płatki śniadaniowe / Musli / Granola'], '^ciast\w* (belvita|zbozowe)', NULL),
  ('Draże / pastylki (Mentos, Tic Tac…)', -99670, ARRAY['Czekolada mleczna'], 'cukierki mleczna czekolada mms', NULL),
  ('Figurki czekoladowe (Mikołaj, zajączek, jajka)', -99660, ARRAY['Baton czekoladowy / Wafelek', 'Herbatniki / Ciastka / Biszkopty', 'Pozostałe jaja'], '^jajka czekol|^figurka mikolaj', NULL),
  ('Danie gotowe (do podgrzania)', -99650, ARRAY['Pozostała wieprzowina i wołowina', 'Pozostałe mrożonki i dania gotowe', 'Pozostały drób', 'Tofu (naturalne / wędzone / marynowane)'], '^fasolka z tofu|^kotlet\w* .*(z puree|placki)', NULL),
  ('Śledź w śmietanie', -99640, ARRAY['Pozostałe owoce świeże', 'Śledzie (filety w oleju / śmietanie)'], '^filety sledz.*smiet', NULL),
  ('Drób wolno gotowany / w sosie (gotowy)', -99630, ARRAY['Pozostałe bakalie, orzechy i nasiona'], 'filety z kaczki z sosem', NULL),
  ('Herbata zielona', -99620, ARRAY['Pozostałe kawy'], '^herbata matcha', NULL),
  ('Kabanosy drobiowe', -99610, ARRAY['Paluszki słone / Krakersy / Precelki', 'Parówki'], 'kabanosy berlinki (drob|indyk)|paluszki drobiowe', NULL),
  ('Kalendarz adwentowy', -99600, ARRAY['Baton czekoladowy / Wafelek'], '^kalendarz adwent', NULL),
  ('Kiełbaski (grillowe, norymberskie, drobiowe)', -99590, ARRAY['Ser żółty (Edamski / Podlaski / Morski / Królewski / Cheddar)'], '^kielb\w* z ser', NULL),
  ('Kiełbasa sucha / dojrzewająca (fuet, kindziuk)', -99580, ARRAY['Pozostałe wędliny i kiełbasy'], '^kielbasa dojrzewajaca', NULL),
  ('Krem czekoladowo-orzechowy', -99570, ARRAY['Pozostałe ciastka, wafle i batony', 'Pozostały chleb'], '^krem z paluszkami|^krem ciasteczkowy', NULL),
  ('Krówki', -99560, ARRAY['Pozostała śmietana i śmietanka'], '^krowka', NULL),
  ('Lasagne (danie)', -99550, ARRAY['Mix sałat / Rukola / Szpinak / Sałata', 'Pozostałe makarony'], '^lasagne', NULL),
  ('Lody na patyku / rożki (multipack)', -99540, ARRAY['Napój gazowany owocowy (Fanta / Sprite / Mirinda / 7Up / Tonik)'], '^lody oranzada', NULL),
  ('Makaron – inne kształty (rigatoni, orzo, gwiazdki…)', -99530, ARRAY['Kopytka / Kluski śląskie / Pyzy / Gnocchi', 'Pesto (zielone / czerwone)', 'Pozostałe makarony'], '^makaron (gnocchi|linguine|warzyw)', NULL),
  ('Mozzarella (kulka)', -99520, ARRAY['Mozzarella Light / Serek wiejski lekki'], '^mozzarella light', NULL),
  ('Naleśniki', -99510, ARRAY['Pierogi / Uszka / Krokiety (gotowe)'], '^nalesniki', NULL),
  ('Ciasto (blacha, keks, sernik, brownie)', -99500, ARRAY['Pozostałe ciastka, wafle i batony', 'Ser pleśniowy (Camembert / Brie / Lazur)'], '^piernik\y', NULL),
  ('Pierogi (inne / mix)', -99490, ARRAY['Pesto (zielone / czerwone)'], '^pierozki girasoli', NULL),
  ('Pierogi z serem / owocami', -99480, ARRAY['Ser Mascarpone'], '^pierogi z mascarpone', NULL),
  ('Popcorn maślany', -99470, ARRAY['Pozostałe słone przekąski'], 'popcorn do mikrofali o smaku masla', NULL),
  ('Popcorn', -99460, ARRAY['Pozostałe sery'], '^popcorn bakalland', NULL),
  ('Prażynki', -99450, ARRAY['Pozostałe słone przekąski', 'Zupka błyskawiczna / Ramen instant (np. Vifon / Knorr)'], '^prazynki', NULL),
  ('Przekąska słodko-słona / inne', -99440, ARRAY['Cynamon / Curry / Kurkuma / Przyprawa do kurczaka', 'Ser żółty Gouda'], '^przekaska (kurczak|z serem)', NULL),
  ('Sałatka gotowa (makaronowa, ziemniaczana, z kaszą…)', -99430, ARRAY['Pozostałe ryby i owoce morza'], '^salatka pikantna z lososia', NULL),
  ('Kotlety schabowe / rozbijane', -99420, ARRAY['Pozostałe wędliny i kiełbasy'], '^sznycel wieprzowy', NULL),
  ('Tortellini / ravioli', -99410, ARRAY['Pesto (zielone / czerwone)'], '^tortelloni', NULL),
  ('Wafle kukurydziane', -99400, ARRAY['Pizza (mrożona / chłodzona)'], 'chrupasy', NULL),
  ('Zapiekanka (bagietka)', -99390, ARRAY['Boczek wędzony / parzony'], '^zapiekanka', NULL)
) AS v(typ, priority, names, include_pattern, exclude_pattern)
JOIN public.product_types t ON t.name = v.typ;

UPDATE public.product_types t SET name = v.nowa
FROM (VALUES
  ('Napój mleczny smakowy', 'Mleko smakowe (napój mleczny)'),
  ('Napój mleczny czekoladowy', 'Mleko czekoladowe'),
  ('Napój mleczny truskawkowy', 'Mleko truskawkowe'),
  ('Napój mleczny waniliowy', 'Mleko waniliowe'),
  ('Napój mleczny bananowy', 'Mleko bananowe'),
  ('Zupka błyskawiczna', 'Zupa / zupka błyskawiczna (instant)'),
  ('Draże / pastylki (Mentos, Tic Tac…)', 'Cukierki – draże / pastylki (Mentos, Skittles, Tic Tac…)'),
  ('Krem czekoladowo-orzechowy', 'Krem czekoladowo-orzechowy (Nutella)'),
  ('Masło orzechowe', 'Masło orzechowe / krem orzechowy'),
  ('Kawa zbożowa', 'Kawa zbożowa (Inka)'),
  ('Kuskus', 'Kasza kuskus'),
  ('Skyr naturalny', 'Skyr naturalny (jogurt islandzki)'),
  ('Pierś z kurczaka pieczona / gotowana (wędlina)', 'Filet / pierś z kurczaka pieczona (wędlina)'),
  ('Pudding / deser proteinowy', 'Pudding / deser proteinowy (wysokobiałkowy)'),
  ('Ice tea (herbata mrożona)', 'Ice tea / napój herbaciany (herbata mrożona)'),
  ('Serek do smarowania naturalny', 'Serek twarogowy do smarowania (naturalny)'),
  ('Serek do smarowania z dodatkami', 'Serek twarogowy do smarowania z dodatkami')
) AS v(stara, nowa)
WHERE t.name = v.stara;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.product_type_rules WHERE note = 'korekta') <> 61
     OR (SELECT count(*) FROM public.product_types WHERE name IN ('Mleko smakowe (napój mleczny)', 'Mleko czekoladowe', 'Mleko truskawkowe', 'Mleko waniliowe', 'Mleko bananowe', 'Zupa / zupka błyskawiczna (instant)', 'Cukierki – draże / pastylki (Mentos, Skittles, Tic Tac…)', 'Krem czekoladowo-orzechowy (Nutella)', 'Masło orzechowe / krem orzechowy', 'Kawa zbożowa (Inka)', 'Kasza kuskus', 'Skyr naturalny (jogurt islandzki)', 'Filet / pierś z kurczaka pieczona (wędlina)', 'Pudding / deser proteinowy (wysokobiałkowy)', 'Ice tea / napój herbaciany (herbata mrożona)', 'Serek twarogowy do smarowania (naturalny)', 'Serek twarogowy do smarowania z dodatkami')) <> 17 THEN
    RAISE EXCEPTION 'Rodzaje 000700: brak rodzajów z migracji 000200-000600 (korekty albo zmiana nazw).';
  END IF;
END $$;

ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
SELECT public.refresh_product_types();
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;

NOTIFY pgrst, 'reload schema';
