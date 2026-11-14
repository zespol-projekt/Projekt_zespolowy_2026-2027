-- Read-only administrative report of ambiguous data; no customer/account data.
SELECT p.id,p.canonical_name,p.quantity_value,p.quantity_unit,p.sale_mode,p.classification_source,
 g.group_key,g.name AS comparison_group,count(o.id) AS offers,
 bool_or(o.regular_price_observed_at IS NULL) AS missing_price_observation,
 bool_or(o.promo_price IS NOT NULL AND o.promo_scope='unknown') AS unverified_promotion
FROM public.products p LEFT JOIN public.comparison_groups g ON g.id=p.comparison_group_id
LEFT JOIN public.store_offers o ON o.product_id=p.id
WHERE p.sale_mode='unknown' OR p.classification_source='exact_product'
GROUP BY p.id,g.id ORDER BY p.id;
