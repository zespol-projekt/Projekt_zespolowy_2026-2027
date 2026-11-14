


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."shopping_list_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "group_id" bigint NOT NULL,
    "selected_product_id" bigint,
    "quantity" numeric(12,2) NOT NULL,
    "unit" "text" NOT NULL,
    "extra_store_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shopping_list_items_quantity_check" CHECK ((("quantity" > (0)::numeric) AND ("quantity" <= (100000)::numeric))),
    CONSTRAINT "shopping_list_items_unit_check" CHECK (("unit" = ANY (ARRAY['g'::"text", 'ml'::"text", 'szt'::"text"])))
);


ALTER TABLE "public"."shopping_list_items" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_shopping_item"("p_list_id" "uuid", "p_group_id" bigint, "p_quantity" numeric, "p_unit" "text", "p_selected_product_id" bigint DEFAULT NULL::bigint) RETURNS SETOF "public"."shopping_list_items"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Zaloguj się, aby edytować listę.' USING ERRCODE='42501'; END IF;
  RETURN QUERY INSERT INTO public.shopping_list_items(list_id,group_id,quantity,unit,selected_product_id)
    VALUES(p_list_id,p_group_id,p_quantity,p_unit,p_selected_product_id)
    ON CONFLICT(list_id,group_id) DO UPDATE SET quantity=shopping_list_items.quantity+excluded.quantity,
      selected_product_id=coalesce(excluded.selected_product_id,shopping_list_items.selected_product_id),extra_store_ids='{}'
    RETURNING *;
END;
$$;


ALTER FUNCTION "public"."add_shopping_item"("p_list_id" "uuid", "p_group_id" bigint, "p_quantity" numeric, "p_unit" "text", "p_selected_product_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_catalog"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = (SELECT auth.uid())
    AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous, false));
$$;


ALTER FUNCTION "public"."can_read_catalog"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."classify_comparison_product"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."classify_comparison_product"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_basket"("p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."compare_basket"("p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_price_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF (TG_OP = 'INSERT' AND (NEW.regular_price IS NOT NULL OR NEW.promo_price IS NOT NULL)) THEN
        INSERT INTO public.price_history (store_offer_id, regular_price, promo_price, price_source)
        VALUES (NEW.id, NEW.regular_price, NEW.promo_price, NEW.price_source);
    ELSIF (TG_OP = 'UPDATE' AND (
        NEW.regular_price IS DISTINCT FROM OLD.regular_price OR
        NEW.promo_price IS DISTINCT FROM OLD.promo_price
    )) THEN
        INSERT INTO public.price_history (store_offer_id, regular_price, promo_price, price_source)
        VALUES (NEW.id, NEW.regular_price, NEW.promo_price, NEW.price_source);
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_log_price_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."norm_text"("t" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT trim(regexp_replace(lower(public.unaccent(coalesce(t,''))), '[^a-z0-9%]+', ' ', 'g'));
$$;


ALTER FUNCTION "public"."norm_text"("t" "text") OWNER TO "postgres";


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


ALTER FUNCTION "public"."plan_group_purchase"("gid" bigint, "sid" integer, "needed" numeric, "wanted_unit" "text", "pinned" bigint, "extra" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promotion_usable"("o" "jsonb") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT coalesce(o->>'promo_scope'='nationwide' AND o->>'promo_price_status'='prawdziwa'
    AND (o->>'promo_price')::numeric>0 AND o->>'promo_evidence_url' LIKE 'https://%'
    AND o->'promo_rule' IS NOT NULL AND o->'promo_rule'<>'null'::jsonb AND public.valid_promotion_rule(o->'promo_rule')
    AND (o->>'valid_from' IS NOT NULL OR o->>'valid_to' IS NOT NULL)
    AND (o->>'valid_from' IS NULL OR (o->>'valid_from')::date<=CURRENT_DATE)
    AND (o->>'valid_to' IS NULL OR (o->>'valid_to')::date>=CURRENT_DATE),false);
$$;


ALTER FUNCTION "public"."promotion_usable"("o" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_price"("o" "jsonb", "n" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."purchase_price"("o" "jsonb", "n" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_offers"("search_query" "text" DEFAULT ''::"text", "result_limit" integer DEFAULT 40) RETURNS TABLE("id" bigint, "name" "text", "regular_price" numeric, "promo_price" numeric, "normalized_weight" "text", "image_url" "text", "kcal_100g" numeric, "store_name" "text", "base_product_name" "text", "relevance_score" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_product_groups"("search_query" "text" DEFAULT ''::"text", "result_limit" integer DEFAULT 40, "result_offset" integer DEFAULT 0) RETURNS TABLE("id" bigint, "name" "text", "unit" "text", "default_quantity" numeric, "offer_count" bigint, "lowest_price" numeric, "relevance_score" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."search_product_groups"("search_query" "text", "result_limit" integer, "result_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_list_from_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  UPDATE public.shopping_lists SET updated_at=now() WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.list_id ELSE NEW.list_id END;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."touch_list_from_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."valid_promotion_rule"("r" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."valid_promotion_rule"("r" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_list_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE gu text;
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.shopping_list_items WHERE list_id=NEW.list_id AND group_id=NEW.group_id) THEN
    PERFORM 1 FROM public.shopping_lists WHERE id=NEW.list_id FOR UPDATE;
    IF (SELECT count(*) FROM public.shopping_list_items WHERE list_id=NEW.list_id)>=100 THEN
      RAISE EXCEPTION 'Lista może mieć najwyżej 100 grup produktów.' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT unit INTO gu FROM public.comparison_groups WHERE id=NEW.group_id;
  IF gu IS DISTINCT FROM NEW.unit THEN RAISE EXCEPTION 'Jednostka nie pasuje do produktu.' USING ERRCODE='22023'; END IF;
  IF NEW.unit='szt' AND NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'Podaj całkowitą liczbę sztuk.' USING ERRCODE='22023'; END IF;
  IF NEW.selected_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products WHERE id=NEW.selected_product_id AND comparison_group_id=NEW.group_id
  ) THEN RAISE EXCEPTION 'Wybrany produkt nie należy do tej grupy.' USING ERRCODE='22023'; END IF;
  IF cardinality(NEW.extra_store_ids)>100 OR EXISTS(SELECT 1 FROM unnest(NEW.extra_store_ids) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=x)) THEN
    RAISE EXCEPTION 'Nieprawidłowy wybór wariantu promocyjnego.' USING ERRCODE='22023'; END IF;
  IF TG_OP='UPDATE' AND (NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.selected_product_id IS DISTINCT FROM OLD.selected_product_id) THEN NEW.extra_store_ids:='{}'; END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_list_item"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."base_products" (
    "id" integer NOT NULL,
    "category_id" integer NOT NULL,
    "name" character varying(120) NOT NULL,
    "default_shelf_life_days" smallint DEFAULT 7 NOT NULL,
    "median_kcal_100g" numeric(6,1),
    "median_protein_100g" numeric(5,1),
    "median_fat_100g" numeric(5,1),
    "median_carbs_100g" numeric(5,1),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "base_products_default_shelf_life_days_check" CHECK (("default_shelf_life_days" > 0)),
    CONSTRAINT "base_products_median_carbs_100g_check" CHECK ((("median_carbs_100g" >= (0)::numeric) AND ("median_carbs_100g" <= (100)::numeric))),
    CONSTRAINT "base_products_median_fat_100g_check" CHECK ((("median_fat_100g" >= (0)::numeric) AND ("median_fat_100g" <= (100)::numeric))),
    CONSTRAINT "base_products_median_kcal_100g_check" CHECK ((("median_kcal_100g" >= (0)::numeric) AND ("median_kcal_100g" <= (905)::numeric))),
    CONSTRAINT "base_products_median_protein_100g_check" CHECK ((("median_protein_100g" >= (0)::numeric) AND ("median_protein_100g" <= (100)::numeric)))
);


ALTER TABLE "public"."base_products" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."base_products_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."base_products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."base_products_id_seq" OWNED BY "public"."base_products"."id";



CREATE TABLE IF NOT EXISTS "public"."comparison_groups" (
    "id" bigint NOT NULL,
    "group_key" "text" NOT NULL,
    "base_product_id" integer NOT NULL,
    "name" "text" NOT NULL,
    "normalized_name" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comparison_groups_name_check" CHECK ((("length"("name") >= 1) AND ("length"("name") <= 500))),
    CONSTRAINT "comparison_groups_unit_check" CHECK (("unit" = ANY (ARRAY['g'::"text", 'ml'::"text", 'szt'::"text"])))
);


ALTER TABLE "public"."comparison_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" bigint NOT NULL,
    "product_key" character varying(64) NOT NULL,
    "base_product_id" integer NOT NULL,
    "ean" character varying(20),
    "canonical_name" "text" NOT NULL,
    "gramatura_norm" character varying(24),
    "quantity_value" numeric(10,2),
    "quantity_unit" character varying(10),
    "kcal_100g" numeric(6,1),
    "protein_100g" numeric(5,1),
    "fat_100g" numeric(5,1),
    "carbs_100g" numeric(5,1),
    "off_scans" integer DEFAULT 0 NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comparison_group_id" bigint,
    "sale_mode" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "classification_source" "text",
    CONSTRAINT "products_carbs_100g_check" CHECK ((("carbs_100g" >= (0)::numeric) AND ("carbs_100g" <= (100)::numeric))),
    CONSTRAINT "products_fat_100g_check" CHECK ((("fat_100g" >= (0)::numeric) AND ("fat_100g" <= (100)::numeric))),
    CONSTRAINT "products_kcal_100g_check" CHECK ((("kcal_100g" >= (0)::numeric) AND ("kcal_100g" <= (905)::numeric))),
    CONSTRAINT "products_off_scans_check" CHECK (("off_scans" >= 0)),
    CONSTRAINT "products_protein_100g_check" CHECK ((("protein_100g" >= (0)::numeric) AND ("protein_100g" <= (100)::numeric))),
    CONSTRAINT "products_quantity_unit_check" CHECK ((("quantity_unit")::"text" = ANY ((ARRAY['g'::character varying, 'ml'::character varying, 'szt'::character varying])::"text"[]))),
    CONSTRAINT "products_quantity_value_check" CHECK (("quantity_value" > (0)::numeric)),
    CONSTRAINT "products_sale_mode_check" CHECK (("sale_mode" = ANY (ARRAY['package'::"text", 'bulk'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."store_offers" (
    "id" bigint NOT NULL,
    "offer_key" character varying(64) NOT NULL,
    "store_id" integer NOT NULL,
    "product_id" bigint NOT NULL,
    "store_product_name" "text" NOT NULL,
    "regular_price" numeric(10,2),
    "promo_price" numeric(10,2),
    "promo_type" character varying(64),
    "promo_condition" "text",
    "valid_from" "date",
    "valid_to" "date",
    "price_status" character varying(20) DEFAULT 'brak'::character varying NOT NULL,
    "price_source" character varying(32) DEFAULT 'brak'::character varying NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "regular_price_observed_at" timestamp with time zone,
    "promo_scope" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "promo_evidence_url" "text",
    "promo_rule" "jsonb",
    "promo_price_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    CONSTRAINT "chk_promo_lt_regular" CHECK ((("promo_price" IS NULL) OR ("regular_price" IS NULL) OR ("promo_price" < "regular_price"))),
    CONSTRAINT "nationwide_evidence" CHECK ((("promo_scope" <> 'nationwide'::"text") OR (("promo_evidence_url" IS NOT NULL) AND ("promo_evidence_url" ~ '^https://'::"text") AND ("promo_rule" IS NOT NULL)))),
    CONSTRAINT "store_offers_price_status_check" CHECK ((("price_status")::"text" = ANY ((ARRAY['prawdziwa'::character varying, 'estymowana'::character varying, 'brak'::character varying])::"text"[]))),
    CONSTRAINT "store_offers_promo_price_check" CHECK (("promo_price" > (0)::numeric)),
    CONSTRAINT "store_offers_promo_price_status_check" CHECK (("promo_price_status" = ANY (ARRAY['prawdziwa'::"text", 'estymowana'::"text", 'unknown'::"text"]))),
    CONSTRAINT "store_offers_promo_scope_check" CHECK (("promo_scope" = ANY (ARRAY['nationwide'::"text", 'personalized'::"text", 'unknown'::"text"]))),
    CONSTRAINT "store_offers_regular_price_check" CHECK (("regular_price" > (0)::numeric)),
    CONSTRAINT "valid_promo_rule" CHECK ("public"."valid_promotion_rule"("promo_rule"))
);


ALTER TABLE "public"."store_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stores" (
    "id" integer NOT NULL,
    "slug" character varying(32) NOT NULL,
    "name" character varying(64) NOT NULL,
    "logo_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."catalog_offers" WITH ("security_invoker"='true') AS
 SELECT "so"."id" AS "offer_id",
    "so"."product_id",
    "p"."comparison_group_id" AS "group_id",
    "so"."store_id",
    "s"."slug" AS "store_slug",
    ("s"."name")::"text" AS "store_name",
    "p"."base_product_id",
    "g"."name" AS "group_name",
    "so"."store_product_name" AS "product_name",
    "p"."ean",
    "p"."gramatura_norm",
    "p"."quantity_value",
    "p"."quantity_unit",
    "p"."sale_mode",
    "p"."kcal_100g",
    "p"."protein_100g",
    "p"."fat_100g",
    "p"."carbs_100g",
    "p"."off_scans",
    COALESCE("so"."image_url", "p"."image_url") AS "image_url",
    "so"."regular_price",
    "so"."promo_price",
    "so"."price_status",
    "so"."price_source",
    "so"."regular_price_observed_at",
    "so"."promo_type",
    "so"."promo_condition",
    "so"."valid_from",
    "so"."valid_to",
    "so"."promo_scope",
    "so"."promo_evidence_url",
    "so"."promo_rule",
    "so"."promo_price_status",
    "public"."promotion_usable"("to_jsonb"("so".*)) AS "verified_promotion",
    (("public"."purchase_price"("to_jsonb"("so".*), (1)::numeric) ->> 'cost'::"text"))::numeric AS "single_price"
   FROM ((("public"."store_offers" "so"
     JOIN "public"."products" "p" ON (("p"."id" = "so"."product_id")))
     JOIN "public"."stores" "s" ON (("s"."id" = "so"."store_id")))
     JOIN "public"."comparison_groups" "g" ON (("g"."id" = "p"."comparison_group_id")))
  WHERE "s"."is_active";


ALTER VIEW "public"."catalog_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" integer NOT NULL,
    "name" character varying(64) NOT NULL,
    "display_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."categories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";



ALTER TABLE "public"."comparison_groups" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."comparison_groups_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."favorite_groups" (
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "group_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."favorite_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_history" (
    "id" bigint NOT NULL,
    "store_offer_id" bigint NOT NULL,
    "regular_price" numeric(10,2),
    "promo_price" numeric(10,2),
    "price_source" character varying(32),
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."price_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."price_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."price_history_id_seq" OWNED BY "public"."price_history"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."products_id_seq" OWNED BY "public"."products"."id";



CREATE TABLE IF NOT EXISTS "public"."shopping_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shopping_lists_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 100)))
);


ALTER TABLE "public"."shopping_lists" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."store_offers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."store_offers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."store_offers_id_seq" OWNED BY "public"."store_offers"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."stores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."stores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."stores_id_seq" OWNED BY "public"."stores"."id";



CREATE OR REPLACE VIEW "public"."v_store_offers_full" WITH ("security_invoker"='true') AS
 SELECT "so"."id" AS "offer_id",
    "s"."id" AS "store_id",
    "s"."slug" AS "store_slug",
    "s"."name" AS "store_name",
    "c"."id" AS "category_id",
    "c"."name" AS "category_name",
    "bp"."id" AS "base_product_id",
    "bp"."name" AS "base_product_name",
    "bp"."default_shelf_life_days",
    "p"."id" AS "product_id",
    "p"."ean",
    "so"."store_product_name" AS "product_name",
    "p"."gramatura_norm",
    "p"."quantity_value",
    "p"."quantity_unit",
    "so"."regular_price",
    "public"."promotion_usable"("to_jsonb"("so".*)) AS "is_promo_active",
    COALESCE((("so"."promo_rule" ->> 'kind'::"text") = ANY (ARRAY['min_quantity'::"text", 'bundle'::"text"])), false) AS "is_multibuy_promo",
        CASE
            WHEN "public"."promotion_usable"("to_jsonb"("so".*)) THEN "so"."promo_price"
            ELSE NULL::numeric
        END AS "active_promo_price",
    (("public"."purchase_price"("to_jsonb"("so".*), (1)::numeric) ->> 'cost'::"text"))::numeric(10,2) AS "effective_price",
    (("public"."purchase_price"("to_jsonb"("so".*), (1)::numeric) ->> 'cost'::"text"))::numeric(10,2) AS "single_item_price",
        CASE
            WHEN (("so"."regular_price" > (0)::numeric) AND "public"."promotion_usable"("to_jsonb"("so".*))) THEN "round"(((("so"."regular_price" - "so"."promo_price") / "so"."regular_price") * (100)::numeric), 0)
            ELSE (0)::numeric
        END AS "discount_pct",
        CASE
            WHEN ("p"."quantity_value" > (0)::numeric) THEN "round"((((("public"."purchase_price"("to_jsonb"("so".*), (1)::numeric) ->> 'cost'::"text"))::numeric / "p"."quantity_value") * (
            CASE
                WHEN (("p"."quantity_unit")::"text" = ANY ((ARRAY['g'::character varying, 'ml'::character varying])::"text"[])) THEN 100
                ELSE 1
            END)::numeric), 2)
            ELSE NULL::numeric
        END AS "price_per_unit_100",
    "so"."promo_type",
    "so"."promo_condition",
    "so"."valid_from",
    "so"."valid_to",
    "so"."price_status",
    "so"."price_source",
    COALESCE("so"."image_url", "p"."image_url") AS "image_url",
    "p"."kcal_100g",
    "p"."protein_100g",
    "p"."fat_100g",
    "p"."carbs_100g",
    "p"."off_scans"
   FROM (((("public"."store_offers" "so"
     JOIN "public"."stores" "s" ON (("s"."id" = "so"."store_id")))
     JOIN "public"."products" "p" ON (("p"."id" = "so"."product_id")))
     JOIN "public"."base_products" "bp" ON (("bp"."id" = "p"."base_product_id")))
     JOIN "public"."categories" "c" ON (("c"."id" = "bp"."category_id")));


ALTER VIEW "public"."v_store_offers_full" OWNER TO "postgres";


ALTER TABLE ONLY "public"."base_products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."base_products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."price_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."price_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."store_offers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."store_offers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."stores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comparison_groups"
    ADD CONSTRAINT "comparison_groups_group_key_key" UNIQUE ("group_key");



ALTER TABLE ONLY "public"."comparison_groups"
    ADD CONSTRAINT "comparison_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorite_groups"
    ADD CONSTRAINT "favorite_groups_pkey" PRIMARY KEY ("owner_id", "group_id");



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_ean_key" UNIQUE ("ean");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_product_key_key" UNIQUE ("product_key");



ALTER TABLE ONLY "public"."shopping_list_items"
    ADD CONSTRAINT "shopping_list_items_list_id_group_id_key" UNIQUE ("list_id", "group_id");



ALTER TABLE ONLY "public"."shopping_list_items"
    ADD CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopping_lists"
    ADD CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_offer_key_key" UNIQUE ("offer_key");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "uq_store_product" UNIQUE ("store_id", "product_id");



CREATE INDEX "comparison_groups_search" ON "public"."comparison_groups" USING "gin" ("normalized_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_base_products_category" ON "public"."base_products" USING "btree" ("category_id");



CREATE INDEX "idx_price_history_offer_date" ON "public"."price_history" USING "btree" ("store_offer_id", "recorded_at" DESC);



CREATE INDEX "idx_products_base_product" ON "public"."products" USING "btree" ("base_product_id");



CREATE INDEX "idx_products_ean" ON "public"."products" USING "btree" ("ean") WHERE ("ean" IS NOT NULL);



CREATE INDEX "idx_products_name_trgm" ON "public"."products" USING "gin" ("canonical_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_store_offers_active_promo" ON "public"."store_offers" USING "btree" ("store_id", "valid_to") WHERE ("promo_price" IS NOT NULL);



CREATE INDEX "idx_store_offers_prices" ON "public"."store_offers" USING "btree" ("store_id", "regular_price") WHERE ("regular_price" IS NOT NULL);



CREATE INDEX "idx_store_offers_store_product" ON "public"."store_offers" USING "btree" ("store_id", "product_id");



CREATE INDEX "products_comparison_group" ON "public"."products" USING "btree" ("comparison_group_id");



CREATE INDEX "shopping_list_items_list" ON "public"."shopping_list_items" USING "btree" ("list_id", "created_at");



CREATE INDEX "shopping_lists_owner" ON "public"."shopping_lists" USING "btree" ("owner_id", "updated_at" DESC);



CREATE OR REPLACE TRIGGER "classify_product" BEFORE INSERT OR UPDATE OF "canonical_name", "quantity_value", "quantity_unit", "base_product_id" ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."classify_comparison_product"();



CREATE OR REPLACE TRIGGER "shopping_list_items_updated" BEFORE UPDATE ON "public"."shopping_list_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "shopping_lists_updated" BEFORE UPDATE ON "public"."shopping_lists" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "touch_list" AFTER INSERT OR DELETE OR UPDATE ON "public"."shopping_list_items" FOR EACH ROW EXECUTE FUNCTION "public"."touch_list_from_item"();



CREATE OR REPLACE TRIGGER "trg_log_price_change" AFTER INSERT OR UPDATE ON "public"."store_offers" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_price_change"();



CREATE OR REPLACE TRIGGER "trg_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_store_offers_updated_at" BEFORE UPDATE ON "public"."store_offers" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "validate_list_item" BEFORE INSERT OR UPDATE ON "public"."shopping_list_items" FOR EACH ROW EXECUTE FUNCTION "public"."validate_list_item"();



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comparison_groups"
    ADD CONSTRAINT "comparison_groups_base_product_id_fkey" FOREIGN KEY ("base_product_id") REFERENCES "public"."base_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."favorite_groups"
    ADD CONSTRAINT "favorite_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."comparison_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorite_groups"
    ADD CONSTRAINT "favorite_groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_store_offer_id_fkey" FOREIGN KEY ("store_offer_id") REFERENCES "public"."store_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_base_product_id_fkey" FOREIGN KEY ("base_product_id") REFERENCES "public"."base_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_comparison_group_id_fkey" FOREIGN KEY ("comparison_group_id") REFERENCES "public"."comparison_groups"("id");



ALTER TABLE ONLY "public"."shopping_list_items"
    ADD CONSTRAINT "shopping_list_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."comparison_groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shopping_list_items"
    ADD CONSTRAINT "shopping_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shopping_list_items"
    ADD CONSTRAINT "shopping_list_items_selected_product_id_fkey" FOREIGN KEY ("selected_product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shopping_lists"
    ADD CONSTRAINT "shopping_lists_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE "public"."base_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalog_read" ON "public"."base_products" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."categories" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."comparison_groups" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."price_history" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."products" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."store_offers" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



CREATE POLICY "catalog_read" ON "public"."stores" FOR SELECT TO "authenticated" USING (( SELECT "public"."can_read_catalog"() AS "can_read_catalog"));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comparison_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."favorite_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_favorites" ON "public"."favorite_groups" TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."can_read_catalog"() AS "can_read_catalog"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."can_read_catalog"() AS "can_read_catalog")));



CREATE POLICY "own_items" ON "public"."shopping_list_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shopping_lists" "l"
  WHERE (("l"."id" = "shopping_list_items"."list_id") AND ("l"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."shopping_lists" "l"
  WHERE (("l"."id" = "shopping_list_items"."list_id") AND ("l"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "own_lists" ON "public"."shopping_lists" TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."can_read_catalog"() AS "can_read_catalog"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."can_read_catalog"() AS "can_read_catalog")));



ALTER TABLE "public"."price_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shopping_list_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shopping_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."store_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stores" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































GRANT ALL ON TABLE "public"."shopping_list_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shopping_list_items" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."add_shopping_item"("p_list_id" "uuid", "p_group_id" bigint, "p_quantity" numeric, "p_unit" "text", "p_selected_product_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_shopping_item"("p_list_id" "uuid", "p_group_id" bigint, "p_quantity" numeric, "p_unit" "text", "p_selected_product_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_shopping_item"("p_list_id" "uuid", "p_group_id" bigint, "p_quantity" numeric, "p_unit" "text", "p_selected_product_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_catalog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."classify_comparison_product"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classify_comparison_product"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compare_basket"("p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compare_basket"("p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compare_basket"("p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_log_price_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_log_price_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_log_price_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."norm_text"("t" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."norm_text"("t" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."norm_text"("t" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."plan_group_purchase"("gid" bigint, "sid" integer, "needed" numeric, "wanted_unit" "text", "pinned" bigint, "extra" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."plan_group_purchase"("gid" bigint, "sid" integer, "needed" numeric, "wanted_unit" "text", "pinned" bigint, "extra" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan_group_purchase"("gid" bigint, "sid" integer, "needed" numeric, "wanted_unit" "text", "pinned" bigint, "extra" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."promotion_usable"("o" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promotion_usable"("o" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promotion_usable"("o" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purchase_price"("o" "jsonb", "n" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_price"("o" "jsonb", "n" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_price"("o" "jsonb", "n" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_product_groups"("search_query" "text", "result_limit" integer, "result_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_product_groups"("search_query" "text", "result_limit" integer, "result_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_product_groups"("search_query" "text", "result_limit" integer, "result_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_list_from_item"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_list_from_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."valid_promotion_rule"("r" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."valid_promotion_rule"("r" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."valid_promotion_rule"("r" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_list_item"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_list_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."base_products" TO "service_role";
GRANT SELECT ON TABLE "public"."base_products" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."base_products_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."comparison_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."comparison_groups" TO "authenticated";



GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."store_offers" TO "service_role";
GRANT SELECT ON TABLE "public"."store_offers" TO "authenticated";



GRANT ALL ON TABLE "public"."stores" TO "service_role";
GRANT SELECT ON TABLE "public"."stores" TO "authenticated";



GRANT ALL ON TABLE "public"."catalog_offers" TO "service_role";
GRANT SELECT ON TABLE "public"."catalog_offers" TO "authenticated";



GRANT ALL ON TABLE "public"."categories" TO "service_role";
GRANT SELECT ON TABLE "public"."categories" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."comparison_groups_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."favorite_groups" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."favorite_groups" TO "authenticated";



GRANT ALL ON TABLE "public"."price_history" TO "service_role";
GRANT SELECT ON TABLE "public"."price_history" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."price_history_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."shopping_lists" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shopping_lists" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."store_offers_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."v_store_offers_full" TO "service_role";
GRANT SELECT ON TABLE "public"."v_store_offers_full" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































