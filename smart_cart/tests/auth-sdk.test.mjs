import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createAuthService } from '../src/features/auth/service.ts';
import { createSessionStorage } from '../src/features/auth/storage.ts';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'sdk@example.test',
  email_confirmed_at: '2026-11-09T12:00:00Z',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-11-09T12:00:00Z',
};
function session(expired = false) {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + (expired ? -60 : 3600);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  // Fixture transportu: SDK dekoduje JWT, a weryfikację serwera zastępuje fetch poniżej.
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires, iat: now - 120 })}.fixture`;
  return { user, access_token: token, refresh_token: 'fixture-refresh-token', token_type: 'bearer',
    expires_in: 3600, expires_at: expires };
}
function durableStorage() {
  const values = new Map();
  return {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}
function fixture(t, key) {
  const durable = durableStorage();
  const requests = [];
  const clients = [];
  const releases = [];
  const fresh = session();
  async function fetch(url, options) {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path: parsed.pathname, grant: parsed.searchParams.get('grant_type'), body });
    if (parsed.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
    if (parsed.pathname.endsWith('/user')) return Response.json(user);
    if (parsed.pathname.endsWith('/token') || parsed.pathname.endsWith('/verify')) return Response.json(fresh);
    throw new Error(`Unexpected fixture endpoint: ${parsed.pathname}`);
  }
  function open() {
    const storage = createSessionStorage(durable, key);
    const client = createClient('https://project.example.test', 'fixture-public-key', {
      global: { fetch },
      auth: { storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const service = createAuthService(() => client.auth, { storage });
    clients.push(client);
    releases.push(service.start());
    return { client, storage, service };
  }
  t.after(async () => {
    releases.forEach(release => release());
    await Promise.all(clients.map(client => client.auth.dispose()));
  });
  return { durable, requests, fresh, open };
}

test('SDK zapisuje zwykłą sesję, odtwarza ją w nowej instancji i usuwa przy wylogowaniu', async t => {
  const { open, durable } = fixture(t, 'sdk-normal');
  const first = open();
  await first.service.initialize();
  assert.equal((await first.service.signIn(user.email, 'fixture-password')).ok, true);
  assert.ok(await durable.getItem('sdk-normal'));
  const restarted = open();
  assert.equal((await restarted.service.initialize()).ok, true);
  assert.deepEqual(restarted.service.getState(), { status: 'signedIn', user: { id: user.id, email: user.email } });
  assert.equal((await restarted.service.signOut()).ok, true);
  assert.equal(await durable.getItem('sdk-normal'), null);
  assert.equal((await restarted.client.auth.getSession()).data.session, null);
});

test('SDK używa recovery wyłącznie w pamięci; restart nie loguje, zmiana hasła kończy sesję', async t => {
  const { open, durable, requests } = fixture(t, 'sdk-recovery');
  const original = open();
  await original.service.initialize();
  assert.equal((await original.service.verifyPasswordResetCode(user.email, '123456')).ok, true);
  assert.equal((await original.client.auth.getSession()).data.session.user.id, user.id);
  assert.equal(await durable.getItem('sdk-recovery'), null);
  const restarted = open();
  assert.equal((await restarted.service.initialize()).ok, true);
  assert.equal(restarted.service.getState().status, 'signedOut');
  assert.equal((await original.service.retrySession()).ok, true);
  assert.deepEqual(original.service.getState(), { status: 'recovery', phase: 'settingPassword' });
  assert.equal((await original.service.setNewPassword('fixture-new-password')).ok, true);
  assert.equal(original.service.getState().status, 'signedOut');
  assert.equal(original.storage.isRecovery(), false);
  assert.equal((await original.client.auth.getSession()).data.session, null);
  assert.equal(await durable.getItem('sdk-recovery'), null);
  assert.equal(requests.find(request => request.path.endsWith('/verify')).body.type, 'recovery');
  assert.ok(requests.some(request => request.body?.password === 'fixture-new-password'));
});

test('SDK odświeża wygasłą zapisaną sesję przed odtworzeniem użytkownika', async t => {
  const { open, durable, requests, fresh } = fixture(t, 'sdk-refresh');
  await durable.setItem('sdk-refresh', JSON.stringify(session(true)));
  const restored = open();
  assert.equal((await restored.service.initialize()).ok, true);
  assert.equal(restored.service.getState().status, 'signedIn');
  assert.equal(requests.filter(request => request.grant === 'refresh_token').length, 1);
  assert.equal(JSON.parse(await durable.getItem('sdk-refresh')).access_token, fresh.access_token);
});
