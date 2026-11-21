-- Gazetki: ograniczenia danych i uprawnienia. Tylko jednorazowa baza testowa, dane są wycofywane.
BEGIN;
INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES
  ('95000000-0000-4000-8000-000000000001', 'gazetki@example.invalid', now(), false),
  ('95000000-0000-4000-8000-000000000002', 'niepotwierdzony@example.invalid', NULL, false);
INSERT INTO public.stores(slug, name) VALUES ('lidl', 'Lidl') ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.leaflets(id, store_id, title, valid_from, valid_to, source_url, checked_at, published, page_count)
SELECT 'lidl-gazetka-test', id, 'Gazetka testowa', '2026-11-19', '2026-11-21', 'https://www.lidl.pl/l/pl/gazetki/test', now(), false, 0
FROM public.stores WHERE slug = 'lidl';
INSERT INTO public.leaflet_pages(leaflet_id, page_no, storage_path, width, height, mime_type, bytes, sha256) VALUES
  ('lidl-gazetka-test', 1, 'lidl/lidl-gazetka-test/001-aaaaaaaa.jpg', 1200, 1800, 'image/jpeg', 250000, repeat('a', 64)),
  ('lidl-gazetka-test', 2, 'lidl/lidl-gazetka-test/002-bbbbbbbb.jpg', 1200, 1800, 'image/jpeg', 260000, repeat('b', 64));
INSERT INTO public.leaflets(id, store_id, title, valid_from, valid_to, source_url, checked_at, published, page_count)
SELECT 'lidl-szkic', id, 'Szkic', '2026-11-19', '2026-11-21', 'https://www.lidl.pl/x', now(), false, 0 FROM public.stores WHERE slug = 'lidl';

DO $$ DECLARE lidl integer := (SELECT id FROM public.stores WHERE slug = 'lidl'); BEGIN
  BEGIN INSERT INTO public.leaflets(id, store_id, title, valid_from, valid_to, source_url, checked_at)
    VALUES ('Zle ID!', lidl, 'x', '2026-11-19', '2026-11-21', 'https://a.pl', now()); RAISE EXCEPTION 'Przyjęto złe ID';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.leaflets(id, store_id, title, valid_from, valid_to, source_url, checked_at)
    VALUES ('odwrocone', lidl, 'x', '2026-11-22', '2026-11-21', 'https://a.pl', now()); RAISE EXCEPTION 'Przyjęto odwrócone daty';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.leaflets(id, store_id, title, valid_from, valid_to, source_url, checked_at)
    VALUES ('http', lidl, 'x', '2026-11-19', '2026-11-21', 'http://a.pl', now()); RAISE EXCEPTION 'Przyjęto adres bez HTTPS';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.leaflets SET published = true WHERE id = 'lidl-szkic'; RAISE EXCEPTION 'Opublikowano gazetkę bez stron';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.leaflet_pages VALUES ('lidl-gazetka-test', 3, 'lidl/x/003.jpg', 8000, 8000, 'image/jpeg', 100, repeat('c', 64));
    RAISE EXCEPTION 'Przyjęto stronę ponad 30 mln pikseli';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.leaflet_pages VALUES ('lidl-gazetka-test', 3, 'lidl/x/003.pdf', 100, 100, 'application/pdf', 100, repeat('c', 64));
    RAISE EXCEPTION 'Przyjęto PDF jako stronę';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.leaflet_pages VALUES ('lidl-gazetka-test', 3, 'lidl/../x.jpg', 100, 100, 'image/jpeg', 100, repeat('c', 64));
    RAISE EXCEPTION 'Przyjęto ścieżkę z ..';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.leaflets SET published = true, page_count = 2 WHERE id = 'lidl-gazetka-test';

-- Potwierdzone konto: tylko opublikowane gazetki i ich strony, bez zapisu.
SELECT set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leaflets) <> 1 THEN RAISE EXCEPTION 'Konto widzi nieopublikowane gazetki'; END IF;
  IF (SELECT count(*) FROM public.leaflet_pages) <> 2 THEN RAISE EXCEPTION 'Konto nie widzi stron'; END IF;
  BEGIN UPDATE public.leaflets SET title = 'x'; RAISE EXCEPTION 'Konto zmienia gazetki';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.leaflet_pages; RAISE EXCEPTION 'Konto usuwa strony';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Niepotwierdzone konto: nic.
SELECT set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.leaflets) OR EXISTS (SELECT 1 FROM public.leaflet_pages) THEN
    RAISE EXCEPTION 'Niepotwierdzone konto widzi gazetki'; END IF;
END $$;
RESET ROLE;
-- Gość: brak dostępu.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.leaflets; RAISE EXCEPTION 'Gość widzi gazetki';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Usunięcie gazetki usuwa jej strony.
DELETE FROM public.leaflets WHERE id = 'lidl-gazetka-test';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.leaflet_pages) THEN RAISE EXCEPTION 'Strony zostały po usunięciu gazetki'; END IF; END $$;
ROLLBACK;
SELECT 'Leaflet checks: id/date/https/page limits, publish guard, confirmed/unconfirmed/guest access, cascade delete passed.' AS result;
