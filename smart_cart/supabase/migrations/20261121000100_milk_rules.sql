-- Reguły mleka v3 (20.11.2026), etap Nabiał -> Mleko.
-- 1. Skrót „BEZ LAKT.” (Biedronka) oznacza mleko bez laktozy - wcześniej trafiało do grupy z laktozą.
-- 2. „Mazurski Smak” to marka, nie mleko smakowe - nie wyklucza produktu z grupy.
-- 3. Mleko zagęszczone, fermentowane i „nie-mleko” (napój roślinny) nigdy nie trafia do grup mleka.
-- 4. Grupa mleka liczona jedną funkcją (milk_group) - tą samą w regule automatycznej i w ręcznym przeglądzie,
--    żeby mleko sprawdzone ręcznie trafiało do tych samych grup co rozpoznane automatycznie.
-- 5. Rejestr decyzji przeglądu (catalog_reviews): kto/co/kiedy - pochodzenie klasyfikacji „reviewed”.
-- 6. Ponowna klasyfikacja mlek bez decyzji ręcznej; pusta stara grupa używana na listach/w ulubionych
--    jest scalana z nową (merge_comparison_group), więc nic nie zostaje porzucone.

CREATE OR REPLACE FUNCTION public.milk_group(p_kind text, p_fat numeric, p_lactose text, p_name text)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE n text := public.norm_text(p_name); f text; kind text; k text; label text;
BEGIN
  IF p_fat IS NULL OR p_fat < 0 OR p_fat > 10 THEN RETURN NULL; END IF;
  kind := CASE lower(p_kind) WHEN 'uht' THEN 'UHT' WHEN 'świeże' THEN 'świeże' WHEN 'swieze' THEN 'świeże' END;
  IF kind IS NULL OR p_lactose NOT IN ('z laktozą', 'bez laktozy') THEN RETURN NULL; END IF;
  f := p_fat::text;
  IF position('.' IN f) > 0 THEN f := rtrim(rtrim(f, '0'), '.'); END IF;
  k := 'milk:' || lower(kind) || ':' || f || ':' || p_lactose;
  label := 'Mleko ' || kind || ' ' || replace(f, '.', ',') || '% · ' || p_lactose;
  -- Te same dopiski co w regule ogólnej (kozie/owcze, ekologiczne).
  IF n ~ 'kozi' THEN k := k || ':goat'; label := label || ' · kozie';
  ELSIF n ~ 'owcz' THEN k := k || ':sheep'; label := label || ' · owcze'; END IF;
  IF n ~ '\mbio\M|ekolog|organic' THEN k := k || ':organic'; label := label || ' · ekologiczne'; END IF;
  RETURN ARRAY[k, label];
END;
$$;

CREATE OR REPLACE FUNCTION public.classify_comparison_product() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE n text := public.norm_text(NEW.canonical_name); k text; label text;
  fat text; kind text; lactose text; base_name text; base_norm text; mg text[];
  u text := coalesce(NEW.quantity_unit,'szt');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.classification_source = 'reviewed' THEN RETURN NEW; END IF;
  k := 'product:' || NEW.id; label := NEW.canonical_name;
  SELECT name INTO base_name FROM public.base_products WHERE id=NEW.base_product_id;
  base_norm := public.norm_text(base_name);
  IF n ~ '\mmleko\M' AND n !~ '(kokos|soj|owsian|migdal|czekolad|wanili|w proszku|skondens|kondens|zageszcz|fermentowan|\mnie mleko\M|roslinn)' THEN
    fat := substring(replace(NEW.canonical_name,',','.') FROM '([0-9]+(?:\.[0-9]+)?)\s*%');
    kind := CASE WHEN n ~ '\muht\M' THEN 'UHT' WHEN n ~ 'swiez' THEN 'świeże' END;
    lactose := CASE WHEN n ~ 'bez lakt|bezlakt|bez lektozy' THEN 'bez laktozy' ELSE 'z laktozą' END;
    IF fat IS NOT NULL AND kind IS NOT NULL AND u = 'ml'
      -- Warianty smakowe, proteinowe i barista to inne produkty; „Mazurski Smak” jest marką.
      AND n !~ '(protein|barista|banan|truskawk|kaka|kawow)' AND NOT (n ~ 'smak' AND n !~ 'mazurski smak')
      AND NOT (n ~ 'uht' AND n ~ 'swiez') THEN
      mg := public.milk_group(kind, fat::numeric, lactose, NEW.canonical_name);
      IF mg IS NOT NULL THEN k := mg[1]; label := mg[2]; END IF;
    END IF;
  ELSIF n ~ '\mcukier bialy\M' AND n !~ '(wanili|zeluj|trzcin)' AND u='g' THEN
    k := 'sugar:white:g'; label := 'Cukier biały';
  ELSIF n ~ '\mmaslo\M' AND n ~ '(82%|82 %|82[ .,]+0%)' AND n !~ '(orzech|roslin|klarowan|solon|miks|mix)' AND u='g' THEN
    k := 'butter:82:unsalted:g'; label := 'Masło 82% · niesolone';
  ELSIF n ~ '\mmaka\M' AND n ~ 'pszenn' AND n ~ 'typ 650' AND n !~ '(pelnoziarn|razow)' AND u='g' THEN
    k := 'flour:wheat:650:g'; label := 'Mąka pszenna typ 650';
  ELSIF n ~ '\mmaka\M' AND n ~ 'pszenn' AND n ~ 'typ 450' AND u='g' THEN
    k := 'flour:wheat:450:g'; label := 'Mąka pszenna typ 450';
  ELSIF n ~ '\mmaka ziemniaczan|\mskrobia ziemniaczan' AND u='g' THEN
    k := 'starch:potato:g'; label := 'Skrobia ziemniaczana';
  ELSIF n ~ '\mryz\M' AND n ~ 'basmati' AND u='g' THEN
    k := 'rice:basmati:g'; label := 'Ryż basmati';
  ELSIF n ~ '\mryz\M' AND n ~ 'jasmin' AND u='g' THEN
    k := 'rice:jasmine:g'; label := 'Ryż jaśminowy';
  ELSIF n ~ '\mryz\M' AND n ~ 'parboiled' AND u='g' THEN
    k := 'rice:parboiled:g'; label := 'Ryż parboiled';
  ELSIF n ~ '\mryz bialy\M' AND n !~ '(wafl|gotow|parboiled|basmati|jasmin)' AND u='g' THEN
    k := 'rice:white:g'; label := 'Ryż biały';
  ELSIF n ~ '\m(jaja|jajka)\M' AND n ~ '\m(m|l)\M' AND n !~ '(przepior|czekol|kinder)' AND u='szt' THEN
    kind := CASE WHEN n ~ '\ml\M' THEN 'L' ELSE 'M' END;
    lactose := CASE WHEN n ~ 'ekolog|bio' THEN 'ekologiczne' WHEN n ~ 'woln.*wybie' THEN 'wolny wybieg' WHEN n ~ 'sciolk' THEN 'ściółkowe' WHEN n ~ 'klatkow' THEN 'klatkowe' END;
    IF lactose IS NOT NULL THEN k := 'eggs:'||kind||':'||lactose; label := 'Jajka '||kind||' · '||lactose; END IF;
  END IF;
  -- Distinct ingredients and processing must not collapse into one equivalent (mleko: sprawdzone wyżej, z dopiskami w milk_group).
  IF k NOT LIKE 'product:%' AND k NOT LIKE 'milk:%' THEN
    IF (k LIKE 'rice:%' AND (n ~ '(mix|mieszank|gotow|wafl|chrup|makaron|napoj|warzyw|kurcz|pomidor|sos|zup|danie)' OR (n ~ 'basmati' AND n ~ 'jasmin')))
      OR (k LIKE 'sugar:%' AND n ~ '(puder|kostk|smak|trzcino|wanili)')
      OR (k LIKE 'eggs:%' AND (n ~ '(kacz|gesi|strusi)' OR (n ~ '\mm\M' AND n ~ '\ml\M')))
      OR n ~ 'bez laktozy|bez lektozy|bez lakt'
      OR (n ~ 'kozi' AND n ~ 'owcz') THEN
      k:='product:'||NEW.id; label:=NEW.canonical_name;
    ELSE
      IF n ~ 'kozi' THEN k:=k||':goat'; label:=label||' · kozie';
      ELSIF n ~ 'owcz' THEN k:=k||':sheep'; label:=label||' · owcze'; END IF;
      IF n ~ '\mbio\M|ekolog|organic' THEN k:=k||':organic'; label:=label||' · ekologiczne'; END IF;
    END IF;
  ELSIF k LIKE 'milk:%' AND n ~ 'kozi' AND n ~ 'owcz' THEN
    k:='product:'||NEW.id; label:=NEW.canonical_name;
  END IF;
  -- No category-wide fallback: broad categories do not prove equivalence.
  -- An administrator can explicitly review remaining products and groups.
  -- Do not infer loose sale from a category or a nominal weight alone.
  IF NEW.sale_mode = 'unknown' THEN
    IF n ~ '\mluzem\M|na wage|cena za kg|za kilogram' OR NEW.canonical_name ~* '(/\s*kg|\bzł\s*/\s*kg)' THEN
      IF u='g' AND NEW.quantity_value=1000 THEN NEW.sale_mode := 'bulk'; END IF;
    ELSIF NEW.quantity_value > 0 AND NEW.quantity_unit IS NOT NULL AND (
      n ~ '(opakowan|tacka|tacce|butelk|pusz|karton|worecz|paczka|sloik)' OR
      n ~ '\m(mleko|maslo|jogurt|kefir|skyr|smietana|smietanka|cukier|maka|ryz|makaron|czekolada|kawa|herbata|sok|napoj|woda|ser|serek|twarog|majonez|ketchup|musztarda|olej|oliwa|platki|jaja|jajka|tofu|dzem|miod)\M'
    ) THEN
      NEW.sale_mode := 'package';
    END IF;
  END IF;
  INSERT INTO public.comparison_groups(group_key,base_product_id,name,normalized_name,unit)
    VALUES(k,NEW.base_product_id,label,public.norm_text(label),u) ON CONFLICT(group_key)
    DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name;
  SELECT id INTO NEW.comparison_group_id FROM public.comparison_groups WHERE group_key=k;
  NEW.classification_source := CASE WHEN k LIKE 'product:%' THEN 'exact_product' ELSE 'name_rule_v3' END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.classify_comparison_product(), public.milk_group(text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_comparison_product(), public.milk_group(text, numeric, text, text) TO service_role;

-- Rejestr decyzji ręcznego przeglądu (pochodzenie klasyfikacji „reviewed”). Tylko administrator.
CREATE TABLE public.catalog_reviews (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('milk')),
  decision text NOT NULL CHECK (decision IN ('group', 'skip')),
  group_key text,
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 200),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'group') = (group_key IS NOT NULL))
);
CREATE INDEX catalog_reviews_product ON public.catalog_reviews(product_id, topic);
ALTER TABLE public.catalog_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalog_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalog_reviews TO service_role;

-- Przeniesienie produktów do nowych grup bez porzucania list i ulubionych:
-- pusta stara grupa z odwołaniami jest scalana z grupą, do której trafiła większość jej produktów;
-- pusta stara grupa „product:…” bez odwołań jest usuwana.
CREATE OR REPLACE FUNCTION public.settle_regrouped(p_moves jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE r record; n_merged integer := 0; n_deleted integer := 0;
BEGIN
  FOR r IN
    SELECT old_id, (array_agg(new_id ORDER BY cnt DESC, new_id))[1] AS new_id
    FROM (SELECT (m->>'old')::bigint AS old_id, (m->>'new')::bigint AS new_id, count(*) AS cnt
          FROM jsonb_array_elements(p_moves) m
          WHERE (m->>'old') IS NOT NULL AND (m->>'old') <> (m->>'new') GROUP BY 1, 2) x
    GROUP BY old_id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.products WHERE comparison_group_id = r.old_id);
    IF EXISTS (SELECT 1 FROM public.shopping_list_items WHERE group_id = r.old_id)
      OR EXISTS (SELECT 1 FROM public.favorite_groups WHERE group_id = r.old_id) THEN
      PERFORM public.merge_comparison_group(r.old_id, r.new_id, p_reason);
      n_merged := n_merged + 1;
    ELSIF EXISTS (SELECT 1 FROM public.comparison_groups WHERE id = r.old_id AND group_key LIKE 'product:%')
      AND NOT EXISTS (SELECT 1 FROM public.comparison_group_redirects WHERE r.old_id IN (old_group_id, new_group_id)) THEN
      DELETE FROM public.comparison_groups WHERE id = r.old_id;
      n_deleted := n_deleted + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('merged_groups', n_merged, 'deleted_empty_groups', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_regrouped(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_regrouped(jsonb, text) TO service_role;

-- Ponowna klasyfikacja produktów mlecznych bez decyzji ręcznej (wyzwalacz liczy grupę od nowa).
CREATE OR REPLACE FUNCTION public.reclassify_milk(p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE moves jsonb; n_all integer; wynik jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS milk_before(id bigint, old_group bigint) ON COMMIT DROP;
  DELETE FROM milk_before;
  INSERT INTO milk_before SELECT id, comparison_group_id FROM public.products
    WHERE coalesce(classification_source, '') <> 'reviewed' AND public.norm_text(canonical_name) ~ '\mmleko\M';
  GET DIAGNOSTICS n_all = ROW_COUNT;
  UPDATE public.products p SET canonical_name = p.canonical_name FROM milk_before b WHERE p.id = b.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('old', b.old_group, 'new', p.comparison_group_id)), '[]')
    INTO moves FROM milk_before b JOIN public.products p ON p.id = b.id WHERE b.old_group IS DISTINCT FROM p.comparison_group_id;
  wynik := public.settle_regrouped(moves, p_reason);
  RETURN wynik || jsonb_build_object('checked_products', n_all, 'changed_group', jsonb_array_length(moves));
END;
$$;
REVOKE ALL ON FUNCTION public.reclassify_milk(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_milk(text) TO service_role;

DO $reclassify$ BEGIN
  RAISE NOTICE 'Reguły mleka v3: %', public.reclassify_milk('Reguły mleka v3 (20.11.2026)');
END $reclassify$;

NOTIFY pgrst, 'reload schema';
