CREATE TABLE public.store_locations (
  id text PRIMARY KEY,
  chain_slug text NOT NULL CHECK (chain_slug IN ('biedronka', 'lidl', 'dino', 'kaufland', 'carrefour')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  address text NOT NULL CHECK (btrim(address) <> ''),
  city text NOT NULL CHECK (btrim(city) <> ''),
  postal_code text CHECK (postal_code ~ '^[0-9]{2}-[0-9]{3}$'),
  latitude double precision NOT NULL CHECK (latitude BETWEEN 48.9 AND 55),
  longitude double precision NOT NULL CHECK (longitude BETWEEN 14 AND 24.3),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT store_locations_id_matches_chain
    CHECK (split_part(id, ':', 1) = chain_slug AND btrim(substr(id, length(chain_slug) + 2)) <> '')
);

ALTER TABLE public.store_locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_locations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.store_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.store_locations TO service_role;

CREATE POLICY store_locations_read ON public.store_locations
  FOR SELECT TO authenticated
  USING (is_active AND (SELECT public.can_read_catalog()));
