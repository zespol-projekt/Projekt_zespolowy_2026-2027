-- Reguła mleka (22.11.2026): skrót „BEZ LAK.” oznacza mleko bez laktozy, tak jak „BEZ LAKT.”.
-- Na wspólnej bazie dotyczy 2 produktów Biedronki, dotąd w grupach „z laktozą”:
--   „MLEKO ŚWIEŻE 2% BEZ LAK.MLECZ. DOLINA 1l” i „MLEKO UHT BEZ LAK. 1,5% WYDOJONE 6X500ml”.
-- Jedyna zmiana w classify_comparison_product względem 20261121000100_milk_rules.sql: wzorzec „\mbez lak”
-- (rozpoznanie laktozy i wykluczenie z grup innych niż mleko). Potem ponowna klasyfikacja mleka bez decyzji ręcznej
-- (reclassify_milk: listy i ulubione zostają) i dopasowanie produktów bazowych do laktozy grupy.

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
    -- „bez lak” obejmuje też skrót „BEZ LAK.” (Biedronka, 22.11.2026), nie tylko „BEZ LAKT.” i pełny zapis.
    lactose := CASE WHEN n ~ '\mbez lak|bezlakt|bez lektozy' THEN 'bez laktozy' ELSE 'z laktozą' END;
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
      OR n ~ 'bez laktozy|bez lektozy|\mbez lak'
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

DO $$ BEGIN
  RAISE NOTICE 'Skrót BEZ LAK.: %', public.reclassify_milk('Reguła mleka: skrót BEZ LAK. (22.11.2026)');
  RAISE NOTICE 'Poprawione produkty bazowe mleka: %', public.align_milk_base_products();
END $$;

NOTIFY pgrst, 'reload schema';
