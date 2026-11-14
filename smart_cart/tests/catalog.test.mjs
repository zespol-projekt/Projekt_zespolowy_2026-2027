import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataClient } from '../src/features/catalog/client.ts';
import { quantityInput } from '../src/features/catalog/types.ts';
import { createTimeoutFetch } from '../src/features/auth/timeoutFetch.ts';

function session() {
  let key = 'one'; const listeners = new Set(); let refreshes = 0; let invalidations = 0;
  return { getSessionKey: () => key, getAccessToken: async () => ({ ok: true, data: 'token' }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    change(next) { key = next; listeners.forEach(fn => fn()); },
    refreshAfterUnauthorized: async () => { refreshes++; return { ok: true, data: 'fresh' }; },
    invalidateSession: async () => { invalidations++; return { ok: true }; },
    counts: () => ({ refreshes, invalidations, listeners: listeners.size }) };
}
const client = (auth, request, timeout) => createDataClient({ url: 'https://catalog.invalid', key: 'public-test', auth, request, timeout });

test('catalog blocks guests and configuration errors without HTTP', async () => {
  const auth = session(); auth.change(null);
  await assert.rejects(client(auth, () => assert.fail('Guest HTTP'))('products'), /Zaloguj/);
  await assert.rejects(createDataClient({ auth })('products'), /skonfigurowano/);
});
test('catalog retries 401 once using refreshed token, invalidates second rejection', async () => {
  const auth = session(); const tokens = [];
  await assert.rejects(client(auth, async (url, init) => {
    tokens.push(init.headers.Authorization); return Response.json({}, { status: 401 });
  })('products'), /Sesja wygasła/);
  assert.deepEqual(tokens, ['Bearer token', 'Bearer fresh']);
  assert.deepEqual(auth.counts(), { refreshes: 1, invalidations: 1, listeners: 0 });
});
test('catalog rejects late results after another login, even when transport ignores abort', async () => {
  const auth = session(); let release; let start;
  const started = new Promise(resolve => { start = resolve; });
  const pending = client(auth, async () => { start(); return new Promise(resolve => { release = resolve; }); })('shopping_lists');
  await started; auth.change('two');
  await assert.rejects(pending, /przerwana/);
  release(Response.json([{ name: 'private' }]));
  assert.equal(auth.counts().listeners, 0);
});
test('catalog deadline also bounds unresponsive token access', async () => {
  const auth = session(); auth.getAccessToken = () => new Promise(() => {});
  await assert.rejects(client(auth, () => assert.fail('HTTP'), 15)('shopping_lists'), /czas oczekiwania/);
  assert.equal(auth.counts().listeners, 0);
});
test('catalog sanitizes backend errors and preserves quantity validation', async () => {
  await assert.rejects(client(session(), async () => Response.json({ code: '42501', message: 'RAW_SECRET' }, { status: 403 }))('products'), error => !error.message.includes('RAW_SECRET') && /dostępu/.test(error.message));
  assert.equal(quantityInput('750,25', 'g'), 750.25);
  for (const value of ['0', '-1', '1e3', '1.111', '100001']) assert.throws(() => quantityInput(value, 'g'));
  assert.throws(() => quantityInput('1.5', 'szt'));
});
test('SDK fetch deadline aborts transport and preserves successful JSON/204 responses', async () => {
  const fetch = createTimeoutFetch(async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }), 15);
  await assert.rejects(fetch('https://auth.invalid'), /Aborted/);
  assert.deepEqual(await (await createTimeoutFetch(async () => Response.json({ ok: true }))('https://auth.invalid')).json(), { ok: true });
  assert.equal((await createTimeoutFetch(async () => new Response(null, { status: 204 }))('https://auth.invalid')).status, 204);
});
