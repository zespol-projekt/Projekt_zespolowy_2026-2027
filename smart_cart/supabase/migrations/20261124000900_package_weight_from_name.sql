-- Gramatura zamiast liczby sztuk (24.11.2026).
-- Carrefour podaje opakowanie jako „450 g (15 sztuk)”, a importer brał ostatnią liczbę, więc produkt miał „15 szt”.
-- Taki produkt nie mógł trafić do rodzaju liczonego w gramach (np. „FRoSTA Złote paluszki rybne 450 g (15 sztuk)” poza „Paluszki rybne”).
-- Importer (scripts/import/normalizacja.mjs, funkcja ilosc) bierze teraz gramaturę; tu poprawiamy produkty już zapisane.
-- Wyjątki zostają w sztukach: jaja, słodzik w tabletkach, bulion / rosół w kostkach (tak samo jak w importerze).
-- Pozycje list z takim produktem (w sztukach) są przeliczane na gramy: 2 szt z 15 w 450 g -> 60 g.

-- Przeliczenie rodzajów trwa na wspólnej bazie dłużej niż jej domyślny limit czasu polecenia (db push zgłosił „statement timeout”).
SET statement_timeout = '15min';

CREATE TEMP TABLE gramatura_z_nazwy ON COMMIT DROP AS
SELECT p.id, p.quantity_value AS stara, x.wartosc * CASE x.j WHEN 'kg' THEN 1000 WHEN 'dag' THEN 10 WHEN 'l' THEN 1000 WHEN 'cl' THEN 10 ELSE 1 END AS nowa,
  CASE WHEN x.j IN ('kg', 'dag', 'g') THEN 'g' ELSE 'ml' END AS jednostka
FROM public.products p
CROSS JOIN LATERAL regexp_match(lower(p.canonical_name),
  '(?:^|[^0-9,.])([0-9]+(?:[.,][0-9]+)?)\s*(kg|dag|g|ml|cl|l)\.?\s*\(\s*([0-9]+)\s*(?:szt|sztuk)\.?\s*\)') AS m
CROSS JOIN LATERAL (SELECT replace(m[1], ',', '.')::numeric AS wartosc, m[2] AS j, m[3]::numeric AS sztuki) AS x
WHERE p.quantity_unit = 'szt' AND p.quantity_value = x.sztuki AND x.wartosc > 0
  AND lower(p.canonical_name) !~ '(jaj|słodzik|slodzik|bulion|rosół|rosol)';

UPDATE public.products p SET quantity_value = round(g.nowa, 2), quantity_unit = g.jednostka
FROM gramatura_z_nazwy g WHERE g.id = p.id;

UPDATE public.shopping_list_items i SET quantity = greatest(round(i.quantity * g.nowa / g.stara, 2), 0.01), unit = g.jednostka
FROM gramatura_z_nazwy g JOIN public.comparison_groups cg ON cg.group_key = 'product:' || g.id
WHERE i.group_id = cg.id AND i.unit = 'szt';

-- Korekty dla produktów, które po zmianie ilości trafiłyby do złego rodzaju (jak w migracji 000700, notatka „korekta”).
INSERT INTO public.product_type_rules(product_type_id, priority, base_product_names, include_pattern, exclude_pattern, note)
SELECT t.id, v.priority, v.names, v.include_pattern, NULL, 'korekta'
FROM (VALUES
  ('Guma do żucia', -99380, ARRAY['Żelki / Cukierki / Draże (np. Haribo / M&M''s / Skittles)'], 'guma do zucia'),
  ('Cukier biały', -99370, ARRAY['Cukier biały 1kg'], 'cukier bialy w saszetkach'),
  ('Tortilla pełnoziarnista', -99360, ARRAY['Pozostałe mąki i cukry'], 'placki z maki pszennej pelnoziarn')
) AS v(typ, priority, names, include_pattern)
JOIN public.product_types t ON t.name = v.typ;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.product_type_rules WHERE note = 'korekta' AND priority IN (-99380, -99370, -99360)) <> 3 THEN
    RAISE EXCEPTION 'Rodzaje 000900: brak rodzajów „Guma do żucia”, „Cukier biały” albo „Tortilla pełnoziarnista”.';
  END IF;
END $$;

ALTER TABLE public.products DISABLE TRIGGER trg_products_updated_at;
SELECT public.refresh_product_types();
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated_at;

SELECT count(*) AS produkty_z_gramatura FROM gramatura_z_nazwy;

NOTIFY pgrst, 'reload schema';
