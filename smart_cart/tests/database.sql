-- Disposable local database only. Test data is rolled back.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES
 ('11111111-1111-4111-8111-111111111111','one@example.invalid',now(),false),
 ('22222222-2222-4222-8222-222222222222','two@example.invalid',now(),false),
 ('33333333-3333-4333-8333-333333333333','unconfirmed@example.invalid',NULL,false);
INSERT INTO public.categories(id,name) VALUES(90001,'Test');
INSERT INTO public.base_products(id,category_id,name) VALUES(90001,90001,'Produkt testowy');
INSERT INTO public.stores(id,slug,name) VALUES(90001,'test-a','Test A'),(90002,'test-b','Test B');
INSERT INTO public.products(id,product_key,base_product_id,canonical_name,quantity_value,quantity_unit) VALUES
 (91001,'test:milk-a',90001,'Firma A Mleko UHT 3,2% 1l',1000,'ml'),
 (91002,'test:milk-b',90001,'Firma B Mleko UHT 3,2% 500ml',500,'ml'),
 (91003,'test:milk-lactose',90001,'Mleko UHT 3,2% bez laktozy 1l',1000,'ml'),
 (91004,'test:butter',90001,'Masło 82% 200g',200,'g'),
 (91005,'test:goat-butter',90001,'Masło kozie 82% 125g',125,'g'),
 (91006,'test:rice',90001,'Ryż basmati 500g',500,'g'),
 (91007,'test:mixed-rice',90001,'RYŻ JAŚMIN/BASMATI MIX GO BIO 500g',500,'g');
DO $$ DECLARE a bigint; b bigint; BEGIN
 SELECT comparison_group_id INTO a FROM public.products WHERE id=91001;
 SELECT comparison_group_id INTO b FROM public.products WHERE id=91002;
 IF a<>b THEN RAISE EXCEPTION 'Equivalent milk brands split'; END IF;
 IF (SELECT group_key FROM public.comparison_groups WHERE id=a)<>'milk:uht:3.2:z laktozą' THEN RAISE EXCEPTION 'UTF-8 group key changed'; END IF;
 IF a=(SELECT comparison_group_id FROM public.products WHERE id=91003) THEN RAISE EXCEPTION 'Lactose variants merged'; END IF;
 IF (SELECT comparison_group_id FROM public.products WHERE id=91004)=(SELECT comparison_group_id FROM public.products WHERE id=91005) THEN RAISE EXCEPTION 'Goat butter substituted'; END IF;
 IF (SELECT comparison_group_id FROM public.products WHERE id=91006)=(SELECT comparison_group_id FROM public.products WHERE id=91007) THEN RAISE EXCEPTION 'Mixed rice substituted'; END IF;
END $$;
INSERT INTO public.products(id,product_key,base_product_id,canonical_name,quantity_value,quantity_unit) VALUES
 (90001,'test:500',90001,'Test 500g',500,'g'),(90002,'test:250',90001,'Test 250g',250,'g'),
 (90003,'test:unit',90001,'Test sztuka',1,'szt'),(90004,'test:bulk',90001,'Banany luzem 1kg',1000,'g');
INSERT INTO public.comparison_groups(id,group_key,base_product_id,name,normalized_name,unit) VALUES
 (99001,'reviewed:test:g',90001,'Test gramów','test gramow','g'),(99002,'reviewed:test:unit',90001,'Test sztuk','test sztuk','szt');
UPDATE public.products SET comparison_group_id=99001,sale_mode='package',classification_source='reviewed' WHERE id IN(90001,90002);
UPDATE public.products SET comparison_group_id=99002,sale_mode='package',classification_source='reviewed' WHERE id=90003;
UPDATE public.products SET comparison_group_id=99001,sale_mode='bulk',classification_source='reviewed' WHERE id=90004;
INSERT INTO public.store_offers(id,offer_key,store_id,product_id,store_product_name,regular_price,price_status) VALUES
 (90001,'test:a500',90001,90001,'Paczka 500g',4,'prawdziwa'),
 (90002,'test:a250',90001,90002,'Paczka 250g',3,'prawdziwa'),
 (90003,'test:aunit',90001,90003,'Sztuka',6,'prawdziwa'),
 (90004,'test:bbulk',90002,90004,'Banany luzem',8,'prawdziwa');

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.products LIMIT 1; RAISE EXCEPTION 'Guest read unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.compare_basket('[]'); RAISE EXCEPTION 'Guest RPC unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  IF NOT public.can_read_catalog() THEN RAISE EXCEPTION 'Confirmed user denied'; END IF;
  r:=public.plan_group_purchase(99001,90001,750,'g');
  IF (r->>'total_price')::numeric<>7 OR jsonb_array_length(r->'picks')<>2 THEN RAISE EXCEPTION 'Mixed package optimum failed: %',r; END IF;
  r:=public.plan_group_purchase(99001,90002,750,'g');
  IF (r->>'total_price')::numeric<>6 OR (r->>'purchased_quantity')::numeric<>750 THEN RAISE EXCEPTION 'Bulk calculation failed: %',r; END IF;
  r:=public.compare_basket('[{"group_id":99002,"quantity":2,"unit":"szt"}]');
  IF r#>>'{stores,0,total_price}'<>'12.00' OR r#>>'{stores,1,total_price}' IS NOT NULL OR (r#>>'{stores,1,complete}')::boolean THEN RAISE EXCEPTION 'Incomplete basket ranked/priced: %',r; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.search_product_groups('gramow')) THEN RAISE EXCEPTION 'Group search failed'; END IF;
  PERFORM * FROM public.search_offers('paczka');
  BEGIN PERFORM public.compare_basket('[{"group_id":99001,"quantity":1,"unit":"g"},{"group_id":99001,"quantity":1,"unit":"g"}]');
    RAISE EXCEPTION 'Duplicate item accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
INSERT INTO public.shopping_lists(id,name) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Moja lista');
INSERT INTO public.shopping_list_items(id,list_id,group_id,quantity,unit) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',99001,750,'g');
INSERT INTO public.favorite_groups(group_id) VALUES(99001);
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.add_shopping_item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',99001,250,'g');
 IF r.quantity<>1000 THEN RAISE EXCEPTION 'Atomic add did not merge quantities'; END IF;
 UPDATE public.shopping_list_items SET extra_store_ids=ARRAY[90001] WHERE id=r.id;
 UPDATE public.shopping_list_items SET quantity=750 WHERE id=r.id;
 IF EXISTS(SELECT 1 FROM public.shopping_list_items WHERE id=r.id AND cardinality(extra_store_ids)<>0) THEN RAISE EXCEPTION 'Extra choice survived quantity edit'; END IF;
 BEGIN UPDATE public.shopping_list_items SET selected_product_id=90003 WHERE id=r.id;
  RAISE EXCEPTION 'Foreign group product accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;

UPDATE public.store_offers SET promo_price=3,promo_scope='nationwide',promo_evidence_url='https://example.invalid/national',
 promo_price_status='prawdziwa',valid_from=CURRENT_DATE,valid_to=CURRENT_DATE,
 promo_rule='{"kind":"min_quantity","min_quantity":3,"requires_activation":true,"requires_card":true}' WHERE id=90003;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; p jsonb; BEGIN
 r:=public.compare_basket('[{"group_id":99002,"quantity":2,"unit":"szt"}]');
 IF (r#>>'{stores,0,total_price}')::numeric<>12 OR (r#>>'{stores,0,items,0,alternative,total_price}')::numeric<>9 THEN RAISE EXCEPTION 'Extra proposal failed: %',r; END IF;
 IF NOT (r#>>'{stores,0,items,0,alternative,picks,0,requires_activation}')::boolean THEN RAISE EXCEPTION 'Activation condition lost'; END IF;
 r:=public.compare_basket('[{"group_id":99002,"quantity":2,"unit":"szt","extra_store_ids":[90001]}]');
 IF (r#>>'{stores,0,total_price}')::numeric<>9 OR (r#>>'{stores,0,items,0,purchased_quantity}')::numeric<>3 THEN RAISE EXCEPTION 'Accepted proposal failed'; END IF;
 p:=jsonb_build_object('price_status','prawdziwa','regular_price',10,'promo_price',2,'promo_price_status','prawdziwa',
  'promo_scope','personalized','promo_evidence_url','https://example.invalid/promo','valid_from',CURRENT_DATE,'valid_to',CURRENT_DATE,'promo_rule',jsonb_build_object('kind','unit'));
 IF (public.purchase_price(p,1)->>'cost')::numeric<>10 THEN RAISE EXCEPTION 'Personalized promotion used'; END IF;
 p:=p||jsonb_build_object('promo_scope','nationwide','valid_from',CURRENT_DATE+1);
 IF (public.purchase_price(p,1)->>'cost')::numeric<>10 THEN RAISE EXCEPTION 'Future promotion used'; END IF;
 p:=p||jsonb_build_object('valid_from',CURRENT_DATE-5,'valid_to',CURRENT_DATE-1);
 IF (public.purchase_price(p,1)->>'cost')::numeric<>10 THEN RAISE EXCEPTION 'Expired promotion used'; END IF;
 p:=p||jsonb_build_object('price_status','estymowana');
 IF public.purchase_price(p,1)->>'cost' IS NOT NULL THEN RAISE EXCEPTION 'Estimated price used'; END IF;
 p:=jsonb_build_object('regular_price',10,'price_status','prawdziwa','promo_price',6,'promo_scope','nationwide','promo_price_status','prawdziwa',
   'promo_evidence_url','https://example.invalid/national','valid_to',CURRENT_DATE,'promo_rule',jsonb_build_object('kind','bundle','bundle_size',3,'bundle_price',9,'max_discount_quantity',3));
 IF (public.purchase_price(p,5)->>'cost')::numeric<>29 THEN RAISE EXCEPTION 'Bundle and limit calculation failed'; END IF;
 p:=p||jsonb_build_object('promo_rule',jsonb_build_object('kind','min_quantity','min_quantity',3,'max_discount_quantity',3));
 IF (public.purchase_price(p,5)->>'cost')::numeric<>38 THEN RAISE EXCEPTION 'Multibuy limit failed'; END IF;
 IF public.valid_promotion_rule('{"kind":"unit","min_quantity":3}') THEN RAISE EXCEPTION 'Conflicting promotion rule accepted'; END IF;
 p:=p||jsonb_build_object('sale_mode','bulk');
 IF (public.purchase_price(p,5)->>'cost')::numeric<>50 THEN RAISE EXCEPTION 'Bulk mass treated as package count'; END IF;
 r:=public.plan_group_purchase(99001,90002,750.25,'g');
 IF (r->>'total_price')::numeric<>6.00 OR (r->>'purchased_quantity')::numeric<>750.25 THEN RAISE EXCEPTION 'Fractional mass failed: %',r; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN UPDATE public.store_offers SET promo_evidence_url=NULL WHERE id=90003;
  RAISE EXCEPTION 'Nationwide promotion accepted without evidence'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.shopping_lists) OR EXISTS(SELECT 1 FROM public.shopping_list_items) OR EXISTS(SELECT 1 FROM public.favorite_groups) THEN RAISE EXCEPTION 'Other user data leaked'; END IF;
 BEGIN INSERT INTO public.shopping_list_items(list_id,group_id,quantity,unit) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',99002,1,'szt');
  RAISE EXCEPTION 'Cross-owner item insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.shopping_lists(owner_id,name) VALUES('11111111-1111-4111-8111-111111111111','Cudza');
  RAISE EXCEPTION 'Owner spoof allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_table_privilege(current_user,'public.products','TRUNCATE') THEN RAISE EXCEPTION 'TRUNCATE privilege retained'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.can_read_catalog() OR EXISTS(SELECT 1 FROM public.products) THEN RAISE EXCEPTION 'Unconfirmed account read allowed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Database checks: package combinations, bulk, extra promotions, completeness, search, guest/owner/other-user/unconfirmed RLS passed.' AS result;
