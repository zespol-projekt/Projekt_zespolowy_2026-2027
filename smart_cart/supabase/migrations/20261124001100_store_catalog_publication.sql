INSERT INTO storage.buckets (id, name, public)
VALUES ('store-catalog', 'store-catalog', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.store_catalog_publication (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version text NOT NULL CHECK (version ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.store_catalog_publication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_catalog_publication FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.store_catalog_publication TO service_role;
