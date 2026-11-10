import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCatalog } from '../src/features/stores/fetchCatalog.ts';

const catalog = { version: 1, updatedAt: '2026-11-09T10:00:00Z', count: 0, stores: [] };
const ok = data => ({ ok: true, data });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function session() {
  let key = 'session-1';
  const listeners = new Set();
  return {
    getSessionKey: () => key,
    getAccessToken: async () => ok('first-token'),
    refreshAfterUnauthorized: async () => ok('refreshed-token'),
    invalidateSession: async () => ok(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    change(next) { key = next; listeners.forEach(listener => listener()); },
    listenerCount: () => listeners.size,
  };
}
const load = (auth, request, controller = new AbortController()) =>
  fetchCatalog('https://stores.example.invalid/v1/stores', auth, controller.signal, request);

test('katalog używa bieżącego tokenu, no-store i sprząta subskrypcję', async () => {
  const auth = session();
  let requests = 0;
  const result = await load(auth, async (url, init) => {
    requests++;
    assert.equal(init.headers.Authorization, 'Bearer first-token');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return Response.json(catalog);
  });
  assert.deepEqual(result, catalog);
  assert.equal(requests, 1);
  assert.equal(auth.listenerCount(), 0);
});

test('bez normalnej sesji żądanie nie wychodzi do API', async () => {
  const auth = session();
  auth.change(null);
  await assert.rejects(load(auth, () => assert.fail('Nie wolno pobierać danych')), /Zaloguj/);
});

test('pierwsze 401 odświeża token i ponawia żądanie dokładnie raz', async () => {
  const auth = session();
  let refreshes = 0;
  auth.refreshAfterUnauthorized = async token => {
    assert.equal(token, 'first-token');
    refreshes++;
    return ok('refreshed-token');
  };
  const tokens = [];
  await load(auth, async (_, init) => {
    tokens.push(init.headers.Authorization);
    return tokens.length === 1 ? new Response(null, { status: 401 }) : Response.json(catalog);
  });
  assert.deepEqual(tokens, ['Bearer first-token', 'Bearer refreshed-token']);
  assert.equal(refreshes, 1);
});

test('drugie 401 unieważnia odrzucony token bez trzeciej próby', async () => {
  const auth = session();
  let requests = 0;
  let invalidations = 0;
  auth.invalidateSession = async token => {
    assert.equal(token, 'refreshed-token');
    invalidations++;
    return ok();
  };
  await assert.rejects(load(auth, async () => {
    requests++;
    return new Response(null, { status: 401 });
  }), /Sesja wygasła/);
  assert.equal(requests, 2);
  assert.equal(invalidations, 1);
});

test('403 i 503 nie uruchamiają odświeżania ani wylogowania', async () => {
  for (const status of [403, 503]) {
    const auth = session();
    auth.refreshAfterUnauthorized = () => assert.fail('Nie odświeżaj');
    auth.invalidateSession = () => assert.fail('Nie wylogowuj');
    await assert.rejects(load(auth, async () => new Response(null, { status })));
  }
});

test('wylogowanie przerywa request, spóźnione 401 nie odświeża nowej sesji', async () => {
  const auth = session();
  const pending = deferred();
  const started = deferred();
  let signal;
  auth.refreshAfterUnauthorized = () => assert.fail('Spóźnione 401');
  const result = load(auth, (_, init) => {
    signal = init.signal;
    started.resolve();
    return pending.promise;
  });
  await started.promise;
  auth.change(null);
  auth.change('session-2');
  assert.equal(signal.aborted, true);
  await assert.rejects(result, /przerwane/);
  pending.resolve(new Response(null, { status: 401 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auth.listenerCount(), 0);
});

test('nowa sesja tego samego konta odrzuca spóźniony katalog', async () => {
  const auth = session();
  const body = deferred();
  const parsing = deferred();
  const result = load(auth, async () => ({ ok: true, status: 200, json() {
    parsing.resolve();
    return body.promise;
  } }));
  await parsing.promise;
  auth.change('same-user-new-session');
  await assert.rejects(result, /przerwane/);
  body.resolve(catalog);
});

test('anulowanie podczas refresh kończy oczekiwanie i nie wysyła nowego requestu', async () => {
  const auth = session();
  const refreshed = deferred();
  const refreshing = deferred();
  const controller = new AbortController();
  let requests = 0;
  auth.refreshAfterUnauthorized = () => { refreshing.resolve(); return refreshed.promise; };
  const result = load(auth, async () => {
    requests++;
    return new Response(null, { status: 401 });
  }, controller);
  await refreshing.promise;
  controller.abort();
  await assert.rejects(result, /przerwane/);
  refreshed.resolve(ok('late-token'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
});

test('timeout 15 sekund przerywa nawet oczekiwanie na token', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const auth = session();
  auth.getAccessToken = () => new Promise(() => {});
  const result = load(auth, () => assert.fail('Brak tokenu'));
  t.mock.timers.tick(15000);
  await assert.rejects(result, /przerwane/);
  assert.equal(auth.listenerCount(), 0);
});
