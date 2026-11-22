-- Rozszerzenie słownika produktów bazowych o pozycje "pozostałe …" i usunięcie piwa z drzewa katalogu.
-- Decyzje Damiana z 19.11.2026: importujemy wyłącznie żywność, bez alkoholu. Istniejące produkty i oferty nie są zmieniane;
-- produkty bazowe piwa zostają w bazie, ale bez podkategorii nie pojawiają się w nawigacji katalogu.
SET lock_timeout = '5s';

UPDATE public.base_products SET subcategory_id = NULL
WHERE subcategory_id IN (SELECT id FROM public.catalog_subcategories WHERE slug = 'napoje-piwo');
DELETE FROM public.catalog_subcategories WHERE slug = 'napoje-piwo';

-- Nowe produkty bazowe (reguły: smart_cart/scripts/import/slownik-rozszerzenie.json).
INSERT INTO public.base_products(category_id, name, subcategory_id)
SELECT c.id, v.name, s.id
FROM (VALUES
  ('Mleko w proszku / zagęszczone', 'Nabiał', 'nabial-mleko'),
  ('Napoje mleczne i mleko smakowe', 'Nabiał', 'nabial-jogurty-kefiry-i-skyry'),
  ('Pozostałe jogurty i desery mleczne', 'Nabiał', 'nabial-jogurty-kefiry-i-skyry'),
  ('Pozostałe sery', 'Nabiał', 'nabial-sery'),
  ('Pozostałe serki i twarogi', 'Nabiał', 'nabial-twarogi-i-serki'),
  ('Pozostałe masła i tłuszcze mleczne', 'Nabiał', 'nabial-maslo-i-margaryna'),
  ('Pozostała śmietana i śmietanka', 'Nabiał', 'nabial-smietana'),
  ('Pozostałe jaja', 'Nabiał', 'nabial-jaja'),
  ('Pozostałe napoje roślinne i tofu', 'Nabiał', 'nabial-napoje-roslinne-i-tofu'),
  ('Pozostałe ryby i owoce morza', 'Mięso i Ryby', 'mieso-i-ryby-ryby'),
  ('Pozostałe wędliny i kiełbasy', 'Mięso i Ryby', 'mieso-i-ryby-wedliny-i-kielbasy'),
  ('Pozostały drób', 'Mięso i Ryby', 'mieso-i-ryby-drob'),
  ('Pozostała wieprzowina i wołowina', 'Mięso i Ryby', 'mieso-i-ryby-wieprzowina-i-wolowina'),
  ('Pozostały chleb', 'Pieczywo', 'pieczywo-chleb'),
  ('Pozostałe bułki i rogale', 'Pieczywo', 'pieczywo-bulki-i-bagietki'),
  ('Pozostałe ciasta i wypieki', 'Pieczywo', 'pieczywo-slodkie-wypieki'),
  ('Pozostałe przyprawy i mieszanki', 'Przyprawy i Pieczenie', 'przyprawy-i-pieczenie-przyprawy'),
  ('Pozostałe produkty do pieczenia i deserów', 'Przyprawy i Pieczenie', 'przyprawy-i-pieczenie-do-pieczenia-i-deserow'),
  ('Pozostałe ciastka, wafle i batony', 'Słodycze i Przekąski', 'slodycze-i-przekaski-batony-wafelki-i-ciastka'),
  ('Pozostałe czekolady, praliny i figurki', 'Słodycze i Przekąski', 'slodycze-i-przekaski-czekolady-i-bombonierki'),
  ('Pozostałe cukierki, gumy i lizaki', 'Słodycze i Przekąski', 'slodycze-i-przekaski-cukierki-i-zelki'),
  ('Pozostałe słone przekąski', 'Słodycze i Przekąski', 'slodycze-i-przekaski-slone-przekaski'),
  ('Pozostałe soki, nektary i syropy', 'Napoje', 'napoje-soki-i-nektary'),
  ('Pozostała woda', 'Napoje', 'napoje-woda'),
  ('Pozostałe napoje gazowane i niegazowane', 'Napoje', 'napoje-napoje-gazowane-i-energetyczne'),
  ('Pozostałe kawy', 'Napoje', 'napoje-kawa'),
  ('Pozostałe herbaty i napary', 'Napoje', 'napoje-herbata'),
  ('Pozostałe makarony', 'Sypkie i Makarony', 'sypkie-i-makarony-makarony'),
  ('Pozostałe kasze, ryże i zboża', 'Sypkie i Makarony', 'sypkie-i-makarony-kasze-i-ryz'),
  ('Pozostałe mąki i cukry', 'Sypkie i Makarony', 'sypkie-i-makarony-maka-i-cukier'),
  ('Pozostałe płatki, musli i owsianki', 'Sypkie i Makarony', 'sypkie-i-makarony-platki-i-musli'),
  ('Pozostałe konserwy i warzywa w słoikach', 'Tłuszcze i Przetwory', 'tluszcze-i-przetwory-konserwy-warzywne-i-owocowe'),
  ('Pozostałe rośliny strączkowe', 'Sypkie i Makarony', 'sypkie-i-makarony-rosliny-straczkowe'),
  ('Pozostałe bakalie, orzechy i nasiona', 'Sypkie i Makarony', 'sypkie-i-makarony-bakalie-orzechy-i-nasiona'),
  ('Pozostałe sosy, dressingi i dodatki', 'Tłuszcze i Przetwory', 'tluszcze-i-przetwory-sosy-i-dodatki'),
  ('Pozostałe oleje, oliwy i tłuszcze', 'Tłuszcze i Przetwory', 'tluszcze-i-przetwory-oleje-oliwa-i-ocet'),
  ('Pozostałe słodkie smarowidła', 'Tłuszcze i Przetwory', 'tluszcze-i-przetwory-slodkie-smarowidla'),
  ('Pozostałe zupy i dania gotowe', 'Tłuszcze i Przetwory', 'tluszcze-i-przetwory-dania-w-sloikach-i-zupy'),
  ('Pozostałe mrożonki i dania gotowe', 'Mrożonki i Gotowe', 'mrozonki-i-gotowe-dania-mrozone-i-gotowe'),
  ('Pozostałe lody i desery mrożone', 'Mrożonki i Gotowe', 'mrozonki-i-gotowe-lody'),
  ('Pozostałe warzywa świeże', 'Warzywa i Owoce', 'warzywa-i-owoce-warzywa'),
  ('Pozostałe owoce świeże', 'Warzywa i Owoce', 'warzywa-i-owoce-owoce')
) AS v(name, category_name, subcategory_slug)
JOIN public.categories c ON c.name = v.category_name
JOIN public.catalog_subcategories s ON s.slug = v.subcategory_slug AND s.category_id = c.id
ON CONFLICT (name) DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.base_products WHERE name LIKE 'Pozostał%' OR name IN ('Mleko w proszku / zagęszczone', 'Napoje mleczne i mleko smakowe')) <> 42 THEN
    RAISE EXCEPTION 'Nie dodano wszystkich nowych produktów bazowych';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
