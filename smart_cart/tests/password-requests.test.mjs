import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createPasswordRequests } from '../src/features/auth/passwordRequests.ts';

test('anulowany wynik prawdziwego SDK nie zapisuje ani nie emituje starej sesji', async t => {
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const begun = new Promise(resolve => { started = resolve; });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.invalid', email_confirmed_at: '2026-01-01' };
  const stored = { access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: 4102444800, user };
  let value = JSON.stringify(stored), writes = 0;
  const guard = createPasswordRequests(async (_url, options) => {
    if (options.method === 'PUT') { started(); await pending; }
    return Response.json(user);
  });
  const client = createClient('https://test.example.invalid', 'fixture-public', {
    global: { fetch: guard.fetch },
    auth: { storageKey: 'fixture', autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: () => value, setItem: (_key, next) => { writes++; value = next; }, removeItem: () => { value = null; } } },
  });
  t.after(() => client.auth.dispose());
  await client.auth.getSession();
  const baseline = writes; const events = [];
  client.auth.onAuthStateChange(event => events.push(event));
  const controller = new AbortController();
  const updating = guard.run(controller.signal, () => client.auth.updateUser({ password: 'fixture-password', nonce: '123456' }));
  await begun;
  controller.abort(); value = null; release();
  const result = await updating;
  assert.ok(result.error); assert.equal(writes, baseline); assert.equal(value, null);
  assert.equal(events.includes('USER_UPDATED'), false);
});
