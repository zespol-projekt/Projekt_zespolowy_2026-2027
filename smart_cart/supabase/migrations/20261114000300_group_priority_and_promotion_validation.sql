-- General product groups precede exact-product fallbacks in equally relevant results.
-- Reject contradictory rules, and never interpret kilograms as multibuy package counts.
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
  IF n<=0 THEN RAISE EXCEPTION 'NieprawidĹ‚owa iloĹ›Ä‡.' USING ERRCODE='22023'; END IF;
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
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj siÄ™, aby wyszukiwaÄ‡ produkty.' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH selected AS (
    SELECT g.*, (CASE WHEN q='' THEN 0 WHEN g.normalized_name=q THEN 200
      WHEN g.normalized_name LIKE q||'%' THEN 150 WHEN position(q IN g.normalized_name)>0 THEN 100
      ELSE public.word_similarity(q,g.normalized_name)*50 END + CASE WHEN g.group_key LIKE 'product:%' THEN 0 ELSE 25 END)::numeric AS score
    FROM public.comparison_groups g
    WHERE q='' OR position(q IN g.normalized_name)>0 OR public.word_similarity(q,g.normalized_name)>=0.35
    ORDER BY score DESC,g.name,g.id LIMIT greatest(1,least(result_limit,100)) OFFSET greatest(result_offset,0)
  )
  SELECT g.id,g.name,g.unit,CASE WHEN g.unit IN ('g','ml') THEN 1000 ELSE 1 END::numeric,
    count(o.offer_id),min(o.single_price),round(g.score,1)
  FROM selected g LEFT JOIN public.catalog_offers o ON o.group_id=g.id
  GROUP BY g.id,g.name,g.unit,g.score ORDER BY g.score DESC,g.name,g.id;
END;
$$;
NOTIFY pgrst,'reload schema';

