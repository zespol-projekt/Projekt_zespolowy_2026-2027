-- Gazetki (19.11.2026): metadane gazetek i ich stron jako obrazów w prywatnym Storage.
-- Klient (czytnik Filipa) nie czyta tabel ani Storage bezpośrednio: dostaje dane przez Edge Function `leaflets`,
-- która sprawdza sesję i potwierdzony email oraz podpisuje czasowe adresy obrazów.
-- Zapis (import, usuwanie wygasłych) wykonuje wyłącznie skrypt administratora kluczem service_role.

CREATE TABLE public.leaflets (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  store_id integer NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  -- true: koniec okresu nie jest podany przez źródło, tylko przyjęty (np. Biedronka podaje tylko „od”).
  valid_to_estimated boolean NOT NULL DEFAULT false,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  source_ref text CHECK (source_ref IS NULL OR length(source_ref) <= 200),
  checked_at timestamptz NOT NULL,
  -- Gazetka jest widoczna dopiero, gdy wszystkie strony są wgrane.
  published boolean NOT NULL DEFAULT false,
  page_count smallint NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from <= valid_to),
  CHECK (NOT published OR page_count >= 1)
);
CREATE INDEX leaflets_visible ON public.leaflets(valid_to, store_id) WHERE published;

CREATE TABLE public.leaflet_pages (
  leaflet_id text NOT NULL REFERENCES public.leaflets(id) ON DELETE CASCADE,
  page_no smallint NOT NULL CHECK (page_no BETWEEN 1 AND 200),
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[a-z0-9][a-z0-9_/.-]{0,250}$' AND storage_path !~ '\.\.'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (leaflet_id, page_no),
  CHECK (width::bigint * height <= 30000000)
);

CREATE TRIGGER leaflets_updated BEFORE UPDATE ON public.leaflets
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Odczyt tylko dla potwierdzonych kont (jak katalog); zapis tylko service_role.
ALTER TABLE public.leaflets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaflet_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.leaflets, public.leaflet_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.leaflets, public.leaflet_pages TO authenticated;
GRANT ALL ON TABLE public.leaflets, public.leaflet_pages TO service_role;
CREATE POLICY leaflets_read ON public.leaflets FOR SELECT TO authenticated
  USING (published AND (SELECT public.can_read_catalog()));
CREATE POLICY leaflet_pages_read ON public.leaflet_pages FOR SELECT TO authenticated
  USING ((SELECT public.can_read_catalog())
    AND EXISTS (SELECT 1 FROM public.leaflets l WHERE l.id = leaflet_id AND l.published));

-- Prywatny bucket na strony (tylko w projekcie z Supabase Storage; lokalny test bazy go nie ma).
-- Bez polityk dla klientów: obrazy są dostępne wyłącznie przez podpisane, czasowe adresy z Edge Function.
DO $bucket$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('leaflets', 'leaflets', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  END IF;
END $bucket$;

NOTIFY pgrst, 'reload schema';
