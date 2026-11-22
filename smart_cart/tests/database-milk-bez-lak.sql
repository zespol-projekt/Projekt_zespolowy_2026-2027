-- Reguła mleka (22.11.2026): skrót „BEZ LAK.” = bez laktozy; ponowna klasyfikacja przenosi produkt bez decyzji ręcznej,
-- produkt z decyzją ręczną zostaje; produkt bazowy dopasowany do laktozy grupy. Dane są wycofywane.
BEGIN;
INSERT INTO public.base_products(id, category_id, subcategory_id, name)
SELECT v.id, s.category_id, s.id, v.name FROM public.catalog_subcategories s,
  (VALUES (96501, 'Mleko UHT 3,2%'), (96502, 'Mleko bez laktozy'), (96503, 'Mleko 1,5% - 2,0%')) v(id, name)
WHERE s.slug = 'nabial-mleko' ON CONFLICT (name) DO NOTHING;
CREATE TEMP TABLE bazy ON COMMIT DROP AS
SELECT (SELECT id FROM public.base_products WHERE name = 'Mleko bez laktozy') AS bez,
       (SELECT id FROM public.base_products WHERE name = 'Mleko 1,5% - 2,0%') AS m15;
INSERT INTO public.products(id, product_key, base_product_id, canonical_name, quantity_value, quantity_unit)
SELECT v.id, 'bezlak:' || v.id, b.m15, v.name, v.q, 'ml' FROM bazy b, LATERAL (VALUES
  (96601, 'MLEKO ŚWIEŻE 2% BEZ LAK.MLECZ. DOLINA 1l', 1000::numeric),
  (96602, 'MLEKO UHT BEZ LAK. 1,5% WYDOJONE 6X500ml', 3000),
  (96603, 'Mleko świeże 2% Wiejskie 1 l', 1000),
  (96604, 'MLEKO ŚWIEŻE 2% BEZ LAK. RĘCZNE 1l', 1000)) v(id, name, q);

DO $$
DECLARE z_laktoza bigint := (SELECT comparison_group_id FROM public.products WHERE id = 96603); w jsonb;
BEGIN
  -- Nowe produkty: skrót rozpoznany od razu.
  IF (SELECT array_agg(g.group_key ORDER BY p.id) FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id
      WHERE p.id IN (96601, 96602, 96603)) <> ARRAY['milk:świeże:2:bez laktozy', 'milk:uht:1.5:bez laktozy', 'milk:świeże:2:z laktozą']
    THEN RAISE EXCEPTION 'Skrót BEZ LAK. nie rozpoznany: %', (SELECT array_agg(g.group_key ORDER BY p.id) FROM public.products p
      JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id IN (96601, 96602, 96603)); END IF;

  -- Stan jak na wspólnej bazie przed poprawką: 96601 w grupie „z laktozą” (stara reguła), 96604 tam z decyzją ręczną.
  ALTER TABLE public.products DISABLE TRIGGER classify_product;
  UPDATE public.products SET comparison_group_id = z_laktoza, base_product_id = (SELECT bez FROM bazy) WHERE id = 96601;
  UPDATE public.products SET comparison_group_id = z_laktoza, classification_source = 'reviewed' WHERE id = 96604;
  ALTER TABLE public.products ENABLE TRIGGER classify_product;
  IF (SELECT comparison_group_id FROM public.products WHERE id = 96601) <> z_laktoza THEN RAISE EXCEPTION 'Zły stan początkowy'; END IF;
  w := public.reclassify_milk('test skrótu BEZ LAK.');
  IF (SELECT g.group_key FROM public.products p JOIN public.comparison_groups g ON g.id = p.comparison_group_id WHERE p.id = 96601)
      <> 'milk:świeże:2:bez laktozy' THEN RAISE EXCEPTION 'Ponowna klasyfikacja nie przeniosła produktu: %', w; END IF;
  IF (SELECT comparison_group_id FROM public.products WHERE id = 96604) <> z_laktoza THEN RAISE EXCEPTION 'Zmieniono produkt z decyzją ręczną'; END IF;
  IF (SELECT comparison_group_id FROM public.products WHERE id = 96603) <> z_laktoza THEN RAISE EXCEPTION 'Mleko z laktozą przeniesione'; END IF;

  -- Produkt bazowy zgodny z grupą: 96601 i 96602 „Mleko bez laktozy”, 96603 zostaje.
  PERFORM public.align_milk_base_products();
  IF (SELECT count(*) FROM public.products WHERE id IN (96601, 96602) AND base_product_id = (SELECT bez FROM bazy)) <> 2
    OR (SELECT base_product_id FROM public.products WHERE id = 96603) <> (SELECT m15 FROM bazy)
    THEN RAISE EXCEPTION 'Złe produkty bazowe po poprawce'; END IF;
END $$;
ROLLBACK;
SELECT 'Milk rule BEZ LAK.: abbreviation recognised, reclassification moves unreviewed product only, base products aligned passed.' AS result;
