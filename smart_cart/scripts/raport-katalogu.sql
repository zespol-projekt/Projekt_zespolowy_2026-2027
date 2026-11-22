-- Raport stanu katalogu (tylko odczyt). Transakcja READ ONLY kończy się ROLLBACK, więc nic nie może zostać zmienione.
-- Uruchomienie: psql ... -X -P pager=off -f scripts/raport-katalogu.sql
-- "z ceną teraz" = oferta ma dziś cenę do porównania (cena regularna 'prawdziwa' albo aktualna promocja naliczana automatycznie).
BEGIN READ ONLY;

-- 1. Sieci.
SELECT store_slug AS siec, count(*) AS oferty,
  count(*) FILTER (WHERE price_status = 'prawdziwa') AS z_cena_regularna,
  count(*) FILTER (WHERE promo_price IS NOT NULL) AS z_promocja,
  count(*) FILTER (WHERE promo_price IS NOT NULL AND valid_to >= current_date) AS z_promocja_trwajaca,
  count(*) FILTER (WHERE verified_promotion) AS promocja_naliczana_dzis,
  count(*) FILTER (WHERE single_price IS NOT NULL) AS z_cena_teraz,
  min(regular_price_observed_at)::date AS najstarsza_cena_regularna,
  max(regular_price_observed_at)::date AS najnowsza_cena_regularna
FROM public.catalog_offers GROUP BY store_id, store_slug ORDER BY store_id;

-- 2. Kategorie × sieci: "oferty (z ceną teraz)".
SELECT c.name AS kategoria,
  count(*) FILTER (WHERE o.store_slug = 'biedronka') || ' (' || count(*) FILTER (WHERE o.store_slug = 'biedronka' AND o.single_price IS NOT NULL) || ')' AS biedronka,
  count(*) FILTER (WHERE o.store_slug = 'lidl') || ' (' || count(*) FILTER (WHERE o.store_slug = 'lidl' AND o.single_price IS NOT NULL) || ')' AS lidl,
  count(*) FILTER (WHERE o.store_slug = 'kaufland') || ' (' || count(*) FILTER (WHERE o.store_slug = 'kaufland' AND o.single_price IS NOT NULL) || ')' AS kaufland,
  count(*) FILTER (WHERE o.store_slug = 'carrefour') || ' (' || count(*) FILTER (WHERE o.store_slug = 'carrefour' AND o.single_price IS NOT NULL) || ')' AS carrefour,
  count(*) FILTER (WHERE o.store_slug = 'dino') || ' (' || count(*) FILTER (WHERE o.store_slug = 'dino' AND o.single_price IS NOT NULL) || ')' AS dino,
  count(*) AS razem
FROM public.catalog_offers o
JOIN public.base_products b ON b.id = o.base_product_id
JOIN public.categories c ON c.id = b.category_id
GROUP BY c.id, c.name, c.display_order ORDER BY c.display_order NULLS LAST, c.name;

-- 3. Produkty i grupy.
SELECT (SELECT count(*) FROM public.products) AS produkty,
  (SELECT count(*) FROM public.products WHERE ean IS NOT NULL) AS produkty_z_ean,
  (SELECT count(*) FROM (SELECT product_id FROM public.store_offers GROUP BY 1 HAVING count(DISTINCT store_id) > 1) x) AS produkty_w_kilku_sieciach,
  (SELECT count(*) FROM public.comparison_groups) AS grupy;

-- 4. Porównywalność: w ilu sieciach grupa ma dziś cenę.
SELECT sieci_z_cena AS liczba_sieci_z_cena, count(*) AS grupy
FROM (SELECT group_id, count(DISTINCT store_id) FILTER (WHERE single_price IS NOT NULL) AS sieci_z_cena
      FROM public.catalog_offers GROUP BY group_id) x
GROUP BY 1 ORDER BY 1;

-- 5. Ostatnie importy.
SELECT id, started_at, tool, summary->>'pozycje' AS pozycje, summary->>'sprzatanie' AS sprzatanie
FROM public.import_runs ORDER BY id DESC LIMIT 3;

ROLLBACK;
