// Edge Function: GET /functions/v1/leaflets - lista aktualnych gazetek dla czytnika w aplikacji.
// Wymaga sesji potwierdzonego, nieanonimowego konta. Obrazy stron leżą w prywatnym bucketcie `leaflets`;
// klient dostaje czasowe, podpisane adresy (bez tokenów aplikacji w żądaniach obrazów).
// Wdrożenie: npx.cmd supabase@3.1.0 functions deploy leaflets
// Opcjonalnie: secret LEAFLETS_ALLOWED_ORIGINS (lista originów aplikacji WWW, domyślnie '*').
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dzisWPolsce, naglowkiCors, zbudujOdpowiedz, type WierszGazetki } from './odpowiedz.ts';

const WAZNOSC_LINKU_S = 3600;

Deno.serve(async (req: Request) => {
  const cors = naglowkiCors(req.headers.get('Origin'), Deno.env.get('LEAFLETS_ALLOWED_ORIGINS'));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return json(401, { error: 'unauthorized' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: eAuth } = await admin.auth.getUser(token);
  if (eAuth || !u?.user) return json(401, { error: 'unauthorized' });
  if (!u.user.email_confirmed_at || u.user.is_anonymous) return json(403, { error: 'email_not_confirmed' });

  const dzis = dzisWPolsce();
  const { data, error } = await admin.from('leaflets')
    .select('id, title, valid_from, valid_to, stores(slug, name), leaflet_pages(page_no, storage_path, width, height, mime_type)')
    .eq('published', true).gte('valid_to', dzis).order('valid_from').limit(200);
  if (error) {
    console.error('leaflets query', error.message);
    return json(503, { error: 'unavailable' });
  }
  const wiersze = (data ?? []) as unknown as WierszGazetki[];
  const sciezki = wiersze.flatMap(g => (g.leaflet_pages ?? []).map(p => p.storage_path));
  const podpisane = new Map<string, string>();
  for (let i = 0; i < sciezki.length; i += 1000) {
    const { data: linki, error: eLinki } = await admin.storage.from('leaflets').createSignedUrls(sciezki.slice(i, i + 1000), WAZNOSC_LINKU_S);
    if (eLinki) {
      console.error('leaflets sign', eLinki.message);
      return json(503, { error: 'unavailable' });
    }
    for (const l of linki ?? []) if (l.path && l.signedUrl && !l.error) podpisane.set(l.path, l.signedUrl);
  }
  return json(200, zbudujOdpowiedz(wiersze, podpisane, dzis));
});
