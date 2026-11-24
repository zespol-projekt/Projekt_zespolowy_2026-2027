import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, if-none-match',
  'Access-Control-Expose-Headers': 'ETag',
  'Cache-Control': 'private, no-store',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return new Response(null, { status: 401, headers });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return new Response(null, { status: 401, headers });
  if (!data.user.email_confirmed_at || data.user.is_anonymous) {
    return new Response(null, { status: 403, headers });
  }

  const { data: publication, error: publicationError } = await admin
    .from('store_catalog_publication').select('version').single();
  if (publicationError || !publication) return new Response(null, { status: 503, headers });

  const etag = `"${publication.version}"`;
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
  }

  const { data: catalog, error: downloadError } = await admin.storage
    .from('store-catalog').download(`${publication.version}.json.gz`);
  if (downloadError || !catalog) return new Response(null, { status: 503, headers });

  return new Response(catalog.stream(), {
    headers: {
      ...headers,
      ETag: etag,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
    },
  });
});
