-- Tighten name-based equivalents using counterexamples found in the real catalogue.
CREATE OR REPLACE FUNCTION public.classify_comparison_product() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE n text := public.norm_text(NEW.canonical_name); k text; label text;
  fat text; kind text; lactose text; base_name text; base_norm text; token text; variants text[] := '{}';
  u text := coalesce(NEW.quantity_unit,'szt');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.classification_source = 'reviewed' THEN RETURN NEW; END IF;
  k := 'product:' || NEW.id; label := NEW.canonical_name;
  SELECT name INTO base_name FROM public.base_products WHERE id=NEW.base_product_id;
  base_norm := public.norm_text(base_name);
  IF n ~ '\mmleko\M' AND n !~ '(kokos|soj|owsian|migdal|czekolad|wanili|w proszku|skondens|kondens)' THEN
    fat := substring(replace(NEW.canonical_name,',','.') FROM '([0-9]+(?:\.[0-9]+)?)\s*%');
    kind := CASE WHEN n ~ '\muht\M' THEN 'UHT' WHEN n ~ 'swiez' THEN 'Ĺ›wieĹĽe' END;
    lactose := CASE WHEN n ~ 'bez laktozy|bez lektozy' THEN 'bez laktozy' ELSE 'z laktozÄ…' END;
    IF fat IS NOT NULL AND kind IS NOT NULL AND u = 'ml' THEN
      fat := trim(trailing '.' FROM trim(trailing '0' FROM (fat::numeric)::text || CASE WHEN position('.' IN fat) = 0 THEN '.0' ELSE '' END));
      k := 'milk:' || lower(kind) || ':' || fat || ':' || lactose;
      label := 'Mleko ' || kind || ' ' || replace(fat,'.',',') || '% Â· ' || lactose;
    END IF;
  ELSIF n ~ '\mcukier bialy\M' AND n !~ '(wanili|zeluj|trzcin)' AND u='g' THEN
    k := 'sugar:white:g'; label := 'Cukier biaĹ‚y';
  ELSIF n ~ '\mmaslo\M' AND n ~ '(82%|82 %|82[ .,]+0%)' AND n !~ '(orzech|roslin|klarowan|solon|miks|mix)' AND u='g' THEN
    k := 'butter:82:unsalted:g'; label := 'MasĹ‚o 82% Â· niesolone';
  ELSIF n ~ '\mmaka\M' AND n ~ 'pszenn' AND n ~ 'typ 650' AND n !~ '(pelnoziarn|razow)' AND u='g' THEN
    k := 'flour:wheat:650:g'; label := 'MÄ…ka pszenna typ 650';
  ELSIF n ~ '\mmaka\M' AND n ~ 'pszenn' AND n ~ 'typ 450' AND u='g' THEN
    k := 'flour:wheat:450:g'; label := 'MÄ…ka pszenna typ 450';
  ELSIF n ~ '\mmaka ziemniaczan|\mskrobia ziemniaczan' AND u='g' THEN
    k := 'starch:potato:g'; label := 'Skrobia ziemniaczana';
  ELSIF n ~ '\mryz\M' AND n ~ 'basmati' AND u='g' THEN
    k := 'rice:basmati:g'; label := 'RyĹĽ basmati';
  ELSIF n ~ '\mryz\M' AND n ~ 'jasmin' AND u='g' THEN
    k := 'rice:jasmine:g'; label := 'RyĹĽ jaĹ›minowy';
  ELSIF n ~ '\mryz\M' AND n ~ 'parboiled' AND u='g' THEN
    k := 'rice:parboiled:g'; label := 'RyĹĽ parboiled';
  ELSIF n ~ '\mryz bialy\M' AND n !~ '(wafl|gotow|parboiled|basmati|jasmin)' AND u='g' THEN
    k := 'rice:white:g'; label := 'RyĹĽ biaĹ‚y';
  ELSIF n ~ '\m(jaja|jajka)\M' AND n ~ '\m(m|l)\M' AND n !~ '(przepior|czekol|kinder)' AND u='szt' THEN
    kind := CASE WHEN n ~ '\ml\M' THEN 'L' ELSE 'M' END;
    lactose := CASE WHEN n ~ 'ekolog|bio' THEN 'ekologiczne' WHEN n ~ 'woln.*wybie' THEN 'wolny wybieg' WHEN n ~ 'sciolk' THEN 'Ĺ›ciĂłĹ‚kowe' WHEN n ~ 'klatkow' THEN 'klatkowe' END;
    IF lactose IS NOT NULL THEN k := 'eggs:'||kind||':'||lactose; label := 'Jajka '||kind||' Â· '||lactose; END IF;
  END IF;
  -- Distinct ingredients and processing must not collapse into one equivalent.
  IF k NOT LIKE 'product:%' THEN
    IF (k LIKE 'rice:%' AND (n ~ '(mix|mieszank|gotow|wafl|chrup|makaron|napoj|warzyw|kurcz|pomidor|sos|zup|danie)' OR (n ~ 'basmati' AND n ~ 'jasmin')))
      OR (k LIKE 'sugar:%' AND n ~ '(puder|kostk|smak|trzcino|wanili)')
      OR (k LIKE 'eggs:%' AND (n ~ '(kacz|gesi|strusi)' OR (n ~ '\mm\M' AND n ~ '\ml\M')))
      OR (k LIKE 'milk:%' AND (n ~ '(smak|protein|barista|banan|truskawk|kaka|kawow)' OR (n ~ 'uht' AND n ~ 'swiez')))
      OR (k NOT LIKE 'milk:%' AND n ~ 'bez laktozy|bez lektozy')
      OR (n ~ 'kozi' AND n ~ 'owcz') THEN
      k:='product:'||NEW.id; label:=NEW.canonical_name;
    ELSE
      IF n ~ 'kozi' THEN k:=k||':goat'; label:=label||' · kozie';
      ELSIF n ~ 'owcz' THEN k:=k||':sheep'; label:=label||' · owcze'; END IF;
      IF n ~ '\mbio\M|ekolog|organic' THEN k:=k||':organic'; label:=label||' · ekologiczne'; END IF;
    END IF;
  END IF;
  -- No category-wide fallback: broad categories do not prove equivalence.
  -- An administrator can explicitly review remaining products and groups.
  -- Do not infer loose sale from a category or a nominal weight alone.
  IF NEW.sale_mode = 'unknown' THEN
    IF n ~ '\mluzem\M|na wage|cena za kg|za kilogram' OR NEW.canonical_name ~* '(/\s*kg|\bzĹ‚\s*/\s*kg)' THEN
      IF u='g' AND NEW.quantity_value=1000 THEN NEW.sale_mode := 'bulk'; END IF;
    ELSIF NEW.quantity_value > 0 AND NEW.quantity_unit IS NOT NULL AND (
      n ~ '(opakowan|tacka|tacce|butelk|pusz|karton|worecz|paczka|sloik)' OR
      n ~ '\m(mleko|maslo|jogurt|kefir|skyr|smietana|smietanka|cukier|maka|ryz|makaron|czekolada|kawa|herbata|sok|napoj|woda|ser|serek|twarog|majonez|ketchup|musztarda|olej|oliwa|platki|jaja|jajka|tofu|dzem|miod)\M'
    ) THEN
      NEW.sale_mode := 'package';
    END IF;
  END IF;
  INSERT INTO public.comparison_groups(group_key,base_product_id,name,normalized_name,unit)
    VALUES(k,NEW.base_product_id,label,public.norm_text(label),u) ON CONFLICT(group_key) DO NOTHING;
  SELECT id INTO NEW.comparison_group_id FROM public.comparison_groups WHERE group_key=k;
  NEW.classification_source := CASE WHEN k LIKE 'product:%' THEN 'exact_product' ELSE 'name_rule_v2' END;
  RETURN NEW;
END;
$$;
ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
UPDATE public.products SET canonical_name=canonical_name WHERE classification_source IS DISTINCT FROM 'reviewed';
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;
NOTIFY pgrst,'reload schema';

