-- Preserve UTF-8 labels in group keys; refresh generated classification only.
-- Already reviewed groups and user data remain unchanged. Unused groups are not searched.
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
    kind := CASE WHEN n ~ '\muht\M' THEN 'UHT' WHEN n ~ 'swiez' THEN 'świeże' END;
    lactose := CASE WHEN n ~ 'bez laktozy|bez lektozy' THEN 'bez laktozy' ELSE 'z laktozą' END;
    IF fat IS NOT NULL AND kind IS NOT NULL AND u = 'ml' THEN
      fat := trim(trailing '.' FROM trim(trailing '0' FROM (fat::numeric)::text || CASE WHEN position('.' IN fat) = 0 THEN '.0' ELSE '' END));
      k := 'milk:' || lower(kind) || ':' || fat || ':' || lactose;
      label := 'Mleko ' || kind || ' ' || replace(fat,'.',',') || '% · ' || lactose;
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
  NEW.classification_source := CASE WHEN k LIKE 'product:%' THEN 'exact_product' ELSE 'name_rule_v2' END;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.valid_promotion_rule(r jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; n integer; v numeric;
BEGIN
  IF r IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(r)<>'object' OR coalesce(r->>'kind','') NOT IN ('unit','min_quantity','bundle') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN
    ('kind','min_quantity','bundle_size','bundle_price','max_discount_quantity','requires_activation','requires_card')) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['min_quantity','bundle_size','max_discount_quantity'] LOOP
    IF r ? k THEN
      IF jsonb_typeof(r->k)<>'number' THEN RETURN false; END IF;
      v:=(r->>k)::numeric; n:=v::integer;
      IF n<>v OR n<1 OR n>1000 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['requires_activation','requires_card'] LOOP
    IF r ? k AND jsonb_typeof(r->k)<>'boolean' THEN RETURN false; END IF;
  END LOOP;
  IF r->>'kind'='min_quantity' AND NOT (r ? 'min_quantity') THEN RETURN false; END IF;
  IF r->>'kind'='bundle' THEN
    IF NOT(r ? 'bundle_size' AND r ? 'bundle_price') OR jsonb_typeof(r->'bundle_price')<>'number' THEN RETURN false; END IF;
    IF (r->>'bundle_price')::numeric<=0 THEN RETURN false; END IF;
  END IF;
  IF r->>'kind'='unit' AND (r ? 'min_quantity' OR r ? 'bundle_size' OR r ? 'bundle_price') THEN RETURN false; END IF;
  IF r->>'kind'='min_quantity' AND (r ? 'bundle_size' OR r ? 'bundle_price') THEN RETURN false; END IF;
  IF r->>'kind'='bundle' AND r ? 'min_quantity' THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION public.purchase_price(o jsonb,n numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE reg numeric; regular_total numeric; promo numeric; amount numeric; lim numeric;
  r jsonb:=o->'promo_rule'; discounted numeric; bundle integer; rest numeric; used boolean:=false;
BEGIN
  IF n<=0 THEN RAISE EXCEPTION 'Nieprawidłowa ilość.' USING ERRCODE='22023'; END IF;
  IF o->>'price_status'='prawdziwa' AND (o->>'regular_price')::numeric>0 THEN reg:=(o->>'regular_price')::numeric; END IF;
  regular_total:=round(reg*n,2); amount:=regular_total;
  IF public.promotion_usable(o) AND (o->>'sale_mode' IS DISTINCT FROM 'bulk' OR r->>'kind'='unit') THEN
    lim:=least(n,coalesce((r->>'max_discount_quantity')::numeric,n));
    IF r->>'kind'='unit' OR (r->>'kind'='min_quantity' AND n>=(r->>'min_quantity')::numeric) THEN
      discounted:=lim; rest:=n-lim;
      IF rest=0 OR reg IS NOT NULL THEN promo:=round(discounted*(o->>'promo_price')::numeric+coalesce(rest*reg,0),2); END IF;
    ELSIF r->>'kind'='bundle' AND n=trunc(n) THEN
      bundle:=(r->>'bundle_size')::integer;
      discounted:=floor(lim/bundle)*bundle; rest:=n-discounted;
      IF discounted>0 AND (rest=0 OR reg IS NOT NULL) THEN
        promo:=round((discounted/bundle)*(r->>'bundle_price')::numeric+coalesce(rest*reg,0),2);
      END IF;
    END IF;
    IF promo IS NOT NULL AND (amount IS NULL OR promo<amount) THEN amount:=promo; used:=true; END IF;
  END IF;
  RETURN jsonb_build_object('cost',amount,'regular_total',regular_total,'promotion_applied',used,
    'requires_activation',used AND coalesce((r->>'requires_activation')::boolean,false),
    'requires_card',used AND coalesce((r->>'requires_card')::boolean,false));
END;
$$;
CREATE OR REPLACE FUNCTION public.search_product_groups(search_query text DEFAULT '',result_limit integer DEFAULT 40,result_offset integer DEFAULT 0)
RETURNS TABLE(id bigint,name text,unit text,default_quantity numeric,offer_count bigint,lowest_price numeric,relevance_score numeric)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE q text:=public.norm_text(left(search_query,200));
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby wyszukiwać produkty.' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH selected AS (
    SELECT g.*, (CASE WHEN q='' THEN 0 WHEN g.normalized_name=q THEN 200
      WHEN g.normalized_name LIKE q||'%' THEN 150 WHEN position(q IN g.normalized_name)>0 THEN 100
      ELSE public.word_similarity(q,g.normalized_name)*50 END + CASE WHEN g.group_key LIKE 'product:%' THEN 0 ELSE 25 END)::numeric AS score
    FROM public.comparison_groups g
    WHERE (q='' OR position(q IN g.normalized_name)>0 OR public.word_similarity(q,g.normalized_name)>=0.35)
      AND EXISTS(SELECT 1 FROM public.products p WHERE p.comparison_group_id=g.id)
    ORDER BY score DESC,g.name,g.id LIMIT greatest(1,least(result_limit,100)) OFFSET greatest(result_offset,0)
  )
  SELECT g.id,g.name,g.unit,CASE WHEN g.unit IN ('g','ml') THEN 1000 ELSE 1 END::numeric,
    count(o.offer_id),min(o.single_price),round(g.score,1)
  FROM selected g LEFT JOIN public.catalog_offers o ON o.group_id=g.id
  GROUP BY g.id,g.name,g.unit,g.score ORDER BY g.score DESC,g.name,g.id;
END;
$$;
ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
UPDATE public.products SET canonical_name=canonical_name WHERE classification_source IS DISTINCT FROM 'reviewed';
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;
NOTIFY pgrst,'reload schema';
