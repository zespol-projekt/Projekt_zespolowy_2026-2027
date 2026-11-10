import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/features/auth/service.ts';

const user = { id: 'access-user', email: 'access@example.test', email_confirmed_at: '2026-11-09T12:00:00Z' };
function session(id = 'first-session', version = 1) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, session_id: id, version })}.fixture`;
  return { user, access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer' };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise(setImmediate);

function setup(initial = session(), overrides = {}) {
  let saved = initial;
  let callback;
  const calls = [];
  const emit = event => callback?.(event, saved);
  const methods = {
    getSession: async () => ({ data: { session: saved }, error: null }),
    getUser: async () => ({ data: { user: saved?.user ?? null }, error: null }),
    refreshSession: async () => {
      saved = session('first-session', 2);
      emit('TOKEN_REFRESHED');
      return { data: { session: saved, user }, error: null };
    },
    signOut: async () => {
      saved = null;
      emit('SIGNED_OUT');
      return { error: null };
    },
    verifyOtp: async () => {
      saved = session('recovery');
      emit('PASSWORD_RECOVERY');
      return { data: { session: saved, user }, error: null };
    },
    ...overrides,
  };
  const auth = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    calls.push(name);
    return method(...args);
  }]));
  auth.onAuthStateChange = listener => {
    callback = listener;
    return { data: { subscription: { unsubscribe() { callback = undefined; } } } };
  };
  return { service: createAuthService(() => auth), calls, emit,
    replace(value) { saved = value; }, saved: () => saved };
}

test('token jest niedostępny podczas inicjalizacji, po wylogowaniu i w recovery', async () => {
  const instance = setup(null);
  assert.equal((await instance.service.getAccessToken()).error.code, 'session_expired');
  await instance.service.initialize();
  assert.equal((await instance.service.getAccessToken()).error.code, 'session_expired');
  await instance.service.verifyPasswordResetCode(user.email, '123456');
  assert.equal(instance.service.getState().status, 'recovery');
  assert.equal(instance.service.getSessionKey(), null);
  assert.equal((await instance.service.getAccessToken()).error.code, 'session_expired');
  assert.equal((await instance.service.refreshAfterUnauthorized('fixture')).error.code, 'session_expired');
  assert.equal(instance.calls.includes('refreshSession'), false);
});

test('pobranie tokenu czyta aktualną sesję SDK; refresh nie zmienia klucza ani snapshotu UI', async () => {
  const instance = setup();
  const release = instance.service.start();
  try {
    await instance.service.initialize();
    const key = instance.service.getSessionKey();
    const state = instance.service.getState();
    let changes = 0;
    instance.service.subscribe(() => { changes += 1; });
    const fresh = session('first-session', 2);
    instance.replace(fresh);
    instance.emit('TOKEN_REFRESHED');
    await flush();
    assert.deepEqual(await instance.service.getAccessToken(), { ok: true, data: fresh.access_token });
    assert.equal(instance.service.getSessionKey(), key);
    assert.equal(instance.service.getState(), state);
    assert.equal(changes, 0);
  } finally { release(); }
});

test('równoległe 401 współdzielą jedno odświeżenie, a spóźnione 401 korzysta z nowego tokenu', async () => {
  const instance = setup();
  await instance.service.initialize();
  const rejected = instance.saved().access_token;
  const key = instance.service.getSessionKey();
  const first = instance.service.refreshAfterUnauthorized(rejected);
  const second = instance.service.refreshAfterUnauthorized(rejected);
  assert.equal(first, second);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], { ok: true, data: session('first-session', 2).access_token });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(await instance.service.refreshAfterUnauthorized(rejected), results[0]);
  assert.equal(instance.calls.filter(name => name === 'refreshSession').length, 1);
  assert.equal(instance.service.getSessionKey(), key);
});

test('401 dla poprzedniego tokenu nie wylogowuje odświeżonej sesji', async () => {
  const instance = setup();
  await instance.service.initialize();
  const rejected = instance.saved().access_token;
  instance.replace(session('first-session', 2));
  assert.equal((await instance.service.invalidateSession(rejected)).ok, true);
  assert.equal(instance.service.getState().status, 'signedIn');
  assert.equal(instance.calls.includes('signOut'), false);
});

test('ponowny 401 dla aktualnego tokenu zamyka dostęp i usuwa sesję', async () => {
  const instance = setup();
  await instance.service.initialize();
  assert.equal((await instance.service.invalidateSession(instance.saved().access_token)).ok, true);
  assert.equal(instance.service.getState().status, 'signedOut');
  assert.equal(instance.service.getSessionKey(), null);
  assert.equal(instance.saved(), null);
});

test('trwała utrata refresh tokenu zamyka sesję, a awaria sieci zachowuje zapis do ponowienia', async () => {
  for (const [error, state, code] of [
    [{ code: 'refresh_token_not_found', status: 400 }, 'signedOut', 'session_expired'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'error', 'network_error'],
    [{ status: 503 }, 'error', 'service_unavailable'],
  ]) {
    const instance = setup(session(), { refreshSession: async () => ({ data: { session: null }, error }) });
    await instance.service.initialize();
    const result = await instance.service.refreshAfterUnauthorized(instance.saved().access_token);
    assert.equal(result.error.code, code);
    assert.equal(instance.service.getState().status, state);
    assert.equal(instance.service.getSessionKey(), null);
    assert.equal(instance.saved() === null, state === 'signedOut');
    assert.equal((await instance.service.getAccessToken()).ok, false);
  }
});

test('wylogowanie podczas refresh natychmiast unieważnia dostęp i odrzuca spóźniony wynik', async () => {
  const started = deferred();
  const response = deferred();
  const instance = setup(session(), { refreshSession: async () => { started.resolve(); return response.promise; } });
  await instance.service.initialize();
  const refresh = instance.service.refreshAfterUnauthorized(instance.saved().access_token);
  await started.promise;
  const logout = instance.service.signOut();
  assert.equal(instance.service.getSessionKey(), null);
  response.resolve({ data: { session: session('first-session', 2) }, error: null });
  assert.equal((await refresh).error.code, 'cancelled');
  assert.equal((await logout).ok, true);
  assert.equal(instance.service.getState().status, 'signedOut');
});

test('zmiana sesji tej samej osoby natychmiast zamyka stary klucz przed weryfikacją nowej', async () => {
  const response = deferred();
  let delay = false;
  const instance = setup(session(), {
    getUser: async () => delay ? response.promise : { data: { user }, error: null },
  });
  const release = instance.service.start();
  try {
    await instance.service.initialize();
    const firstKey = instance.service.getSessionKey();
    const oldToken = instance.saved().access_token;
    const keys = [];
    instance.service.subscribe(() => keys.push(instance.service.getSessionKey()));
    delay = true;
    instance.replace(session('second-session'));
    assert.equal(instance.emit('SIGNED_IN'), undefined, 'callback nigdy nie czeka na SDK');
    assert.equal(instance.service.getSessionKey(), null);
    assert.deepEqual(keys, [null]);
    assert.equal((await instance.service.getAccessToken()).ok, false);
    await flush();
    response.resolve({ data: { user }, error: null });
    await flush();
    assert.equal(instance.service.getState().status, 'signedIn');
    assert.notEqual(instance.service.getSessionKey(), firstKey);
    assert.equal((await instance.service.invalidateSession(oldToken)).ok, true);
    assert.equal(instance.calls.includes('signOut'), false);
  } finally { release(); }
});

test('zewnętrzne wylogowanie blokuje stary klucz synchronicznie w callbacku SDK', async () => {
  const instance = setup();
  const release = instance.service.start();
  try {
    await instance.service.initialize();
    instance.replace(null);
    instance.emit('SIGNED_OUT');
    assert.equal(instance.service.getSessionKey(), null);
    await flush();
    assert.equal(instance.service.getState().status, 'signedOut');
  } finally { release(); }
});

test('zmiana sesji wykryta przez getSession nie udostępnia tokenu przed getUser', async () => {
  const instance = setup();
  await instance.service.initialize();
  const firstKey = instance.service.getSessionKey();
  instance.replace(session('other-session'));
  assert.equal((await instance.service.getAccessToken()).error.code, 'cancelled');
  await flush();
  assert.notEqual(instance.service.getSessionKey(), firstKey);
  assert.deepEqual(await instance.service.getAccessToken(), { ok: true, data: instance.saved().access_token });
});
