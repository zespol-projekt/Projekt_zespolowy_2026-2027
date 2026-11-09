import { createClient } from '@supabase/supabase-js';

const denied = status => ({ ok: false, status });

export function createAccessVerifier(env = process.env, { fetch: fetcher = globalThis.fetch, timeoutMs = 5000, now = Date.now } = {}) {
  const rawUrl = (env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL)?.trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  if (!rawUrl || !key) throw new Error('Ustaw SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY (lub odpowiadające im EXPO_PUBLIC_*) w .env.local.');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Nieprawidłowy SUPABASE_URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SUPABASE_URL musi być adresem HTTPS projektu (HTTP tylko dla lokalnego Supabase).');
  }
  if (!key.startsWith('sb_publishable_')) throw new Error('Ustaw publiczny klucz Supabase sb_publishable_*, bez klucza secret/service_role.');
  const issuer = `${url.origin}/auth/v1`;
  const client = createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetcher(input, {
        ...init,
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]),
        redirect: 'error',
      }),
    },
  });

  return async authorization => {
    const token = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)?.[1];
    if (!token) return denied(401);
    try {
      // Supabase verifies the signature against this project's signing keys and
      // supplies current user data. Decoding alone never grants access.
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        if (error.name === 'AuthSessionMissingError') return denied(401);
        if (['user_banned', 'email_not_confirmed'].includes(error.code)) return denied(403);
        if (['bad_jwt', 'session_not_found', 'user_not_found', 'no_authorization'].includes(error.code)) return denied(401);
        if (['invalid_api_key', 'invalid_credentials'].includes(error.code)) return denied(503);
        // Gateway może zwrócić 401 bez kodu Auth, np. dla błędnego apikey.
        // Nie traktuj nieznanej awarii weryfikatora jako utraty sesji klienta.
        return denied(503);
      }
      const user = data.user;
      if (!user?.id) return denied(503);
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      const currentTime = Math.floor(now() / 1000);
      const audience = claims?.aud;
      if (!claims || claims.iss !== issuer || claims.sub !== user.id ||
        !(audience === 'authenticated' || (Array.isArray(audience) && audience.includes('authenticated'))) ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= currentTime ||
        !Number.isSafeInteger(claims.iat) || claims.iat > currentTime + 60 || claims.iat >= claims.exp ||
        (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > currentTime)) ||
        typeof claims.session_id !== 'string' || !claims.session_id) return denied(401);
      if (claims.role !== 'authenticated' || claims.is_anonymous === true || user.is_anonymous === true ||
        typeof user.email !== 'string' || !user.email ||
        typeof user.email_confirmed_at !== 'string' || !Number.isFinite(Date.parse(user.email_confirmed_at))) return denied(403);
      return { ok: true };
    } catch {
      // No raw SDK errors, credentials or JWT contents in responses or logs.
      return denied(503);
    }
  };
}
