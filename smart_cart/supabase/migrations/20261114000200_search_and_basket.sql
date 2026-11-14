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
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
ALTER TABLE public.store_offers ADD CONSTRAINT valid_promo_rule CHECK(public.valid_promotion_rule(promo_rule));
ALTER TABLE public.store_offers ADD CONSTRAINT nationwide_evidence CHECK(
  promo_scope<>'nationwide' OR (promo_evidence_url IS NOT NULL AND promo_evidence_url ~ '^https://' AND promo_rule IS NOT NULL));

CREATE OR REPLACE FUNCTION public.promotion_usable(o jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(o->>'promo_scope'='nationwide' AND o->>'promo_price_status'='prawdziwa'
    AND (o->>'promo_price')::numeric>0 AND o->>'promo_evidence_url' LIKE 'https://%'
    AND o->'promo_rule' IS NOT NULL AND o->'promo_rule'<>'null'::jsonb AND public.valid_promotion_rule(o->'promo_rule')
    AND (o->>'valid_from' IS NOT NULL OR o->>'valid_to' IS NOT NULL)
    AND (o->>'valid_from' IS NULL OR (o->>'valid_from')::date<=CURRENT_DATE)
    AND (o->>'valid_to' IS NULL OR (o->>'valid_to')::date>=CURRENT_DATE),false);
$$;

-- n is a count of packages, or a fraction of the price basis for loose goods.
CREATE OR REPLACE FUNCTION public.purchase_price(o jsonb,n numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE reg numeric; regular_total numeric; promo numeric; amount numeric; lim numeric;
  r jsonb:=o->'promo_rule'; discounted numeric; bundle integer; rest numeric; used boolean:=false;
BEGIN
  IF n<=0 THEN RAISE EXCEPTION 'Nieprawidłowa ilość.' USING ERRCODE='22023'; END IF;
  IF o->>'price_status'='prawdziwa' AND (o->>'regular_price')::numeric>0 THEN reg:=(o->>'regular_price')::numeric; END IF;
  regular_total:=round(reg*n,2); amount:=regular_total;
  IF public.promotion_usable(o) THEN
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

CREATE VIEW public.catalog_offers WITH (security_invoker=true) AS
 SELECT so.id AS offer_id,so.product_id,p.comparison_group_id AS group_id,
   so.store_id,s.slug AS store_slug,s.name::text AS store_name,
   p.base_product_id,g.name AS group_name,so.store_product_name AS product_name,
   p.ean,p.gramatura_norm,p.quantity_value,p.quantity_unit,p.sale_mode,
   p.kcal_100g,p.protein_100g,p.fat_100g,p.carbs_100g,p.off_scans,
   coalesce(so.image_url,p.image_url) AS image_url,
   so.regular_price,so.promo_price,so.price_status,so.price_source,so.regular_price_observed_at,
   so.promo_type,so.promo_condition,so.valid_from,so.valid_to,
   so.promo_scope,so.promo_evidence_url,so.promo_rule,so.promo_price_status,
   public.promotion_usable(to_jsonb(so)) AS verified_promotion,
   (public.purchase_price(to_jsonb(so),1)->>'cost')::numeric AS single_price
 FROM public.store_offers so JOIN public.products p ON p.id=so.product_id
 JOIN public.stores s ON s.id=so.store_id JOIN public.comparison_groups g ON g.id=p.comparison_group_id
 WHERE s.is_active;
REVOKE ALL ON TABLE public.catalog_offers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.catalog_offers TO authenticated,service_role;

-- Preserve the legacy view's column names/order while correcting its price semantics.
CREATE OR REPLACE VIEW public.v_store_offers_full WITH (security_invoker=true) AS
 SELECT so.id AS offer_id,s.id AS store_id,s.slug AS store_slug,s.name AS store_name,
 c.id AS category_id,c.name AS category_name,bp.id AS base_product_id,bp.name AS base_product_name,bp.default_shelf_life_days,
 p.id AS product_id,p.ean,so.store_product_name AS product_name,p.gramatura_norm,p.quantity_value,p.quantity_unit,
 so.regular_price,public.promotion_usable(to_jsonb(so)) AS is_promo_active,
 coalesce(so.promo_rule->>'kind' IN ('min_quantity','bundle'),false) AS is_multibuy_promo,
 CASE WHEN public.promotion_usable(to_jsonb(so)) THEN so.promo_price END AS active_promo_price,
 (public.purchase_price(to_jsonb(so),1)->>'cost')::numeric(10,2) AS effective_price,
 (public.purchase_price(to_jsonb(so),1)->>'cost')::numeric(10,2) AS single_item_price,
 CASE WHEN so.regular_price>0 AND public.promotion_usable(to_jsonb(so))
   THEN round((so.regular_price-so.promo_price)/so.regular_price*100,0) ELSE 0::numeric END AS discount_pct,
 CASE WHEN p.quantity_value>0 THEN round((public.purchase_price(to_jsonb(so),1)->>'cost')::numeric/p.quantity_value*
   CASE WHEN p.quantity_unit IN ('g','ml') THEN 100 ELSE 1 END,2) END AS price_per_unit_100,
 so.promo_type,so.promo_condition,so.valid_from,so.valid_to,so.price_status,so.price_source,
 coalesce(so.image_url,p.image_url) AS image_url,p.kcal_100g,p.protein_100g,p.fat_100g,p.carbs_100g,p.off_scans
 FROM public.store_offers so JOIN public.stores s ON s.id=so.store_id JOIN public.products p ON p.id=so.product_id
 JOIN public.base_products bp ON bp.id=p.base_product_id JOIN public.categories c ON c.id=bp.category_id;

CREATE FUNCTION public.search_product_groups(search_query text DEFAULT '',result_limit integer DEFAULT 40,result_offset integer DEFAULT 0)
RETURNS TABLE(id bigint,name text,unit text,default_quantity numeric,offer_count bigint,lowest_price numeric,relevance_score numeric)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE q text:=public.norm_text(left(search_query,200));
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby wyszukiwać produkty.' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH selected AS (
    SELECT g.*, CASE WHEN q='' THEN 0 WHEN g.normalized_name=q THEN 200
      WHEN g.normalized_name LIKE q||'%' THEN 150 WHEN position(q IN g.normalized_name)>0 THEN 100
      ELSE public.word_similarity(q,g.normalized_name)*50 END::numeric AS score
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

DROP FUNCTION IF EXISTS public.search_offers(text,integer);
CREATE FUNCTION public.search_offers(search_query text DEFAULT '',result_limit integer DEFAULT 40)
RETURNS TABLE(id bigint,name text,regular_price numeric,promo_price numeric,normalized_weight text,image_url text,kcal_100g numeric,store_name text,base_product_name text,relevance_score numeric)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE q text:=public.norm_text(left(search_query,200));
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby wyszukiwać oferty.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT o.offer_id,o.product_name,o.regular_price,
    CASE WHEN o.verified_promotion THEN o.promo_price END,o.gramatura_norm::text,o.image_url,o.kcal_100g,
    o.store_name,o.group_name,round((CASE WHEN q='' THEN 0 WHEN position(q IN public.norm_text(o.group_name))>0 THEN 150
      WHEN position(q IN public.norm_text(o.product_name))>0 THEN 100 ELSE public.word_similarity(q,public.norm_text(o.product_name))*50 END)::numeric,1)
  FROM public.catalog_offers o WHERE q='' OR position(q IN public.norm_text(o.group_name||' '||o.product_name))>0
    OR public.word_similarity(q,public.norm_text(o.product_name))>=0.38
  ORDER BY 10 DESC,o.single_price NULLS LAST,o.offer_id LIMIT greatest(1,least(result_limit,100));
END;
$$;

-- Exact bounded covering DP over package quantities. Each offer is processed
-- once so its multibuy/limit rule is applied to its complete package count.
CREATE FUNCTION public.plan_group_purchase(gid bigint,sid integer,needed numeric,wanted_unit text,pinned bigint DEFAULT NULL,extra boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
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
            'condition',o.promo_condition,'observed_at',o.regular_price_observed_at,'valid_from',o.valid_from,'valid_to',o.valid_to);
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
          'condition',o.promo_condition,'observed_at',o.regular_price_observed_at,'valid_from',o.valid_from,'valid_to',o.valid_to);
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

DROP FUNCTION IF EXISTS public.compare_basket(integer[],boolean,boolean);
CREATE FUNCTION public.compare_basket(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s record; item jsonb; base jsonb; proposal jsonb; selected jsonb;
  rows jsonb; networks jsonb:='[]'; missing integer; total numeric; regular numeric;
  gid bigint; pinned bigint; needed numeric; u text; allow_more boolean; item_count integer;
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby porównać koszyk.' USING ERRCODE='42501'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>100 THEN
    RAISE EXCEPTION 'Koszyk musi zawierać najwyżej 100 pozycji.' USING ERRCODE='22023'; END IF;
  item_count:=jsonb_array_length(p_items);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'group_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Połącz powtarzające się grupy produktów w jedną pozycję.' USING ERRCODE='22023'; END IF;
  FOR s IN SELECT id,name FROM public.stores WHERE is_active ORDER BY name LOOP
    rows:='[]'; missing:=0; total:=0; regular:=0;
    FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      IF jsonb_typeof(item)<>'object' OR item->>'group_id' IS NULL OR item->>'quantity' IS NULL OR item->>'unit' IS NULL THEN
        RAISE EXCEPTION 'Pozycja wymaga produktu, ilości i jednostki.' USING ERRCODE='22023'; END IF;
      gid:=(item->>'group_id')::bigint; pinned:=(item->>'selected_product_id')::bigint;
      needed:=(item->>'quantity')::numeric; u:=item->>'unit';
      IF item ? 'extra_store_ids' AND jsonb_typeof(item->'extra_store_ids')<>'array' THEN
        RAISE EXCEPTION 'Nieprawidłowy wybór wariantu promocyjnego.' USING ERRCODE='22023'; END IF;
      allow_more:=EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(item->'extra_store_ids','[]')) x WHERE x::integer=s.id);
      base:=public.plan_group_purchase(gid,s.id,needed,u,pinned,false);
      proposal:=public.plan_group_purchase(gid,s.id,needed,u,pinned,true);
      IF proposal->>'status'<>'priced' OR (base->>'status'='priced' AND (proposal->>'total_price')::numeric>=(base->>'total_price')::numeric)
        OR (base->>'status'='priced' AND (proposal->>'purchased_quantity')::numeric<=(base->>'purchased_quantity')::numeric) THEN proposal:=NULL; END IF;
      selected:=CASE WHEN allow_more AND proposal IS NOT NULL THEN proposal ELSE base END;
      rows:=rows||jsonb_build_array(selected||jsonb_build_object('item_id',item->>'id','group_id',gid,'selected_product_id',pinned,
        'extra_selected',allow_more AND proposal IS NOT NULL,'alternative',proposal));
      IF selected->>'status'='priced' THEN
        total:=total+(selected->>'total_price')::numeric;
        regular:=regular+(selected->>'regular_total')::numeric;
      ELSE missing:=missing+1; END IF;
    END LOOP;
    networks:=networks||jsonb_build_array(jsonb_build_object('store_id',s.id,'store_name',s.name,'price_level','network',
      'complete',missing=0 AND item_count>0,'available_count',item_count-missing,'requested_count',item_count,
      'total_price',CASE WHEN missing=0 AND item_count>0 THEN round(total,2) END,
      'regular_total',CASE WHEN missing=0 AND item_count>0 THEN round(regular,2) END,'items',rows));
  END LOOP;
  RETURN jsonb_build_object('version',2,'calculated_at',now(),'stores',coalesce((SELECT jsonb_agg(x ORDER BY (x->>'complete')::boolean DESC,
    (x->>'total_price')::numeric NULLS LAST,x->>'store_name') FROM jsonb_array_elements(networks) x),'[]'::jsonb));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Nieprawidłowe dane pozycji koszyka.' USING ERRCODE='22023';
END;
$$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('norm_text','search_offers','search_product_groups','compare_basket',
      'valid_promotion_rule','promotion_usable','purchase_price','plan_group_purchase','fn_log_price_change','fn_set_updated_at')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f.signature);
  END LOOP;
END $$;

CREATE FUNCTION public.add_shopping_item(p_list_id uuid,p_group_id bigint,p_quantity numeric,p_unit text,p_selected_product_id bigint DEFAULT NULL)
RETURNS SETOF public.shopping_list_items LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby edytować listę.' USING ERRCODE='42501'; END IF;
  RETURN QUERY INSERT INTO public.shopping_list_items(list_id,group_id,quantity,unit,selected_product_id)
    VALUES(p_list_id,p_group_id,p_quantity,p_unit,p_selected_product_id)
    ON CONFLICT(list_id,group_id) DO UPDATE SET quantity=shopping_list_items.quantity+excluded.quantity,
      selected_product_id=coalesce(excluded.selected_product_id,shopping_list_items.selected_product_id),extra_store_ids='{}'
    RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.add_shopping_item(uuid,bigint,numeric,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_shopping_item(uuid,bigint,numeric,text,bigint) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
