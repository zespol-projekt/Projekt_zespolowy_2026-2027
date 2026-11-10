import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessVerifier } from '../server/auth.mjs';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const time = 1_800_000_000;
const user = { id: 'user-1', email: 'user@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
const claims = { iss: `${env.SUPABASE_URL}/auth/v1`, aud: 'authenticated', sub: user.id, role: 'authenticated', session_id: 'session-1', iat: time - 100, exp: time + 100, is_anonymous: false };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = fields => `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({ ...claims, ...fields })}.signature`;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
const verifier = (fetch, extra = {}) => createAccessVerifier(env, { fetch, now: () => time * 1000, ...extra });

test('konfiguracja wymaga adresu i publicznego klucza; wspólne EXPO_PUBLIC są obsługiwane', () => {
  for (const config of [{}, { SUPABASE_URL: env.SUPABASE_URL }, { ...env, SUPABASE_URL: 'not-url' },
    { ...env, SUPABASE_URL: 'http://example.com' }, { ...env, SUPABASE_URL: 'https://user:secret@example.com' },
    { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_use' }]) assert.throws(() => createAccessVerifier(config));
  assert.equal(typeof createAccessVerifier({ EXPO_PUBLIC_SUPABASE_URL: env.SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY }), 'function');
});

test('brak Bearer, klucz projektu i nieprawidłowy format są odrzucane bez sieci', async () => {
  const verify = verifier(() => { throw new Error('Nie powinno być żądania sieciowego.'); });
  for (const header of [undefined, '', 'Basic secret', `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`, 'Bearer abc', `Bearer ${token()} extra`]) {
    assert.deepEqual(await verify(header), { ok: false, status: 401 });
  }
});

test('prawdziwy SDK weryfikuje token przez /user konkretnego projektu, bez trwałej sesji', async () => {
  const seen = [];
  const verify = verifier(async (url, init) => {
    seen.push([url, new Headers(init.headers)]);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    return response(user);
  });
  const jwt = token();
  assert.deepEqual(await verify(`Bearer ${jwt}`), { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], `${env.SUPABASE_URL}/auth/v1/user`);
  assert.equal(seen[0][1].get('authorization'), `Bearer ${jwt}`);
  assert.equal(seen[0][1].get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  assert.deepEqual(await verify(`Bearer ${token({ aud: ['authenticated'] })}`), { ok: true });
});

test('odrzucenie podpisu przez Supabase nie może zostać zastąpione dekodowaniem claims', async () => {
  const verify = verifier(async () => response({ code: 'bad_jwt', message: 'invalid signature' }, 403));
  assert.deepEqual(await verify(`Bearer ${token()}`), { ok: false, status: 401 });
});

test('dodatkowe ograniczenia odrzucają obcy projekt, odbiorcę, tożsamość i nieważny czas', async () => {
  const verify = verifier(async () => response(user));
  for (const fields of [{ iss: 'https://other.supabase.co/auth/v1' }, { aud: 'other' }, { sub: 'other-user' },
    { exp: time }, { exp: String(time + 100) }, { iat: time + 61 }, { iat: undefined }, { nbf: time + 1 },
    { session_id: undefined }]) {
    assert.deepEqual(await verify(`Bearer ${token(fields)}`), { ok: false, status: 401 });
  }
});

test('dostęp wymaga potwierdzonego konta; metadane klienta nie potwierdzają emaila', async () => {
  for (const account of [
    { ...user, email_confirmed_at: undefined, user_metadata: { email_verified: true, email_confirmed_at: '2026-01-01' } },
    { ...user, email_confirmed_at: 'invalid-date' }, { ...user, is_anonymous: true }, { ...user, email: '' },
  ]) {
    assert.deepEqual(await verifier(async () => response(account))(`Bearer ${token()}`), { ok: false, status: 403 });
  }
  const verify = verifier(async () => response(user));
  for (const fields of [{ role: 'anon' }, { role: 'service_role' }, { is_anonymous: true }]) {
    assert.deepEqual(await verify(`Bearer ${token(fields)}`), { ok: false, status: 403 });
  }
});

test('awarie usługi i limit są 503, błędne sesje 401, zablokowane konto 403', async () => {
  for (const [status, code, expected] of [[503, 'unexpected_failure', 503], [429, 'over_request_rate_limit', 503],
    [401, 'invalid_api_key', 503], [401, undefined, 503], [401, 'session_not_found', 401], [403, 'user_banned', 403]]) {
    const verify = verifier(async () => response({ code, message: 'technical detail' }, status));
    assert.deepEqual(await verify(`Bearer ${token()}`), { ok: false, status: expected });
  }
  assert.deepEqual(await verifier(async () => { throw new TypeError('network'); })(`Bearer ${token()}`), { ok: false, status: 503 });
});

test('timeout przerywa zewnętrzną weryfikację i zwraca kontrolowane 503', async () => {
  let aborted = false;
  const verify = verifier((_url, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error('test timeout')), 1000);
    init.signal.addEventListener('abort', () => { aborted = true; clearTimeout(keepAlive); reject(init.signal.reason); }, { once: true });
  }), { timeoutMs: 20 });
  assert.deepEqual(await verify(`Bearer ${token()}`), { ok: false, status: 503 });
  assert.equal(aborted, true);
});
