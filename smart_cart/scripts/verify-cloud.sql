-- Administrative read-only verification. No account details or private lists returned.
BEGIN READ ONLY;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',
  (SELECT id FROM auth.users WHERE email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) ORDER BY created_at LIMIT 1))::text,true) IS NOT NULL AS claims_ready;
SELECT set_config('role','authenticated',true) IS NOT NULL AS role_ready;
SELECT jsonb_build_object(
  'confirmed_access',public.can_read_catalog(),
  'products',(SELECT count(*) FROM public.products),
  'offers',(SELECT count(*) FROM public.store_offers),
  'groups',(SELECT count(*) FROM public.comparison_groups),
  'used_groups',(SELECT count(DISTINCT comparison_group_id) FROM public.products),
  'networks',(SELECT jsonb_agg(name ORDER BY name) FROM public.stores WHERE is_active),
  'classification',(SELECT jsonb_agg(x) FROM (SELECT classification_source,sale_mode,count(*) FROM public.products GROUP BY 1,2 ORDER BY 1,2) x),
  'price_status',(SELECT jsonb_agg(x) FROM (SELECT price_status,count(*) FROM public.store_offers GROUP BY 1) x),
  'verified_promotions',(SELECT count(*) FROM public.catalog_offers WHERE verified_promotion),
  'observed_dates',(SELECT count(*) FROM public.store_offers WHERE regular_price_observed_at IS NOT NULL),
  'group_search',(SELECT jsonb_agg(x) FROM public.search_product_groups('mleko',3,0) x),
  'legacy_search_count',(SELECT count(*) FROM public.search_offers('mleko',3)),
  'comparison',public.compare_basket(jsonb_build_array((SELECT jsonb_build_object('group_id',id,'quantity',1000,'unit','ml')
    FROM public.comparison_groups WHERE group_key LIKE 'milk:uht:3.2:%' ORDER BY id LIMIT 1))),
  'guest_read_privilege',has_table_privilege('anon','public.products','SELECT'),
  'authenticated_write_privilege',has_table_privilege('authenticated','public.products','INSERT'),
  'authenticated_truncate_privilege',has_table_privilege('authenticated','public.products','TRUNCATE')
) AS verification;
ROLLBACK;
