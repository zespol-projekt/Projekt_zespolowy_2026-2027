import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/features/auth/service.ts';

const user = {
  id: 'session-user',
  email: 'session@example.com',
  email_confirmed_at: '2026-11-09T12:00:00Z',
  is_anonymous: false,
};
const makeSession = (account = user, token = 'session-access-token') => ({
  user: account,
  access_token: token,
  refresh_token: 'session-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flushEvents = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

function setup(initialSession = null, overrides = {}, options = {}) {
  const calls = [];
  const handlers = new Set();
  let currentSession = initialSession;
  let recovering = false;
  let subscriptions = 0;
  let unsubscriptions = 0;
  const emit = (event, payload = currentSession) => [...handlers].map(callback => callback(event, payload));
  const methods = {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    getUser: async () => ({ data: { user: currentSession?.user ?? null }, error: null }),
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
    signOut: async () => {
      currentSession = null;
      emit('SIGNED_OUT', null);
      return { error: null };
    },
    verifyOtp: async () => {
      currentSession = makeSession();
      emit('PASSWORD_RECOVERY');
      return { data: { user, session: currentSession }, error: null };
    },
    ...overrides,
  };
  const auth = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    calls.push({ name, args });
    return method(...args);
  }]));
  auth.onAuthStateChange = callback => {
    subscriptions += 1;
    handlers.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe() {
            if (handlers.delete(callback)) unsubscriptions += 1;
          },
        },
      },
    };
  };
  const storage = {
    async beginRecovery() { recovering = true; },
    endRecovery() { recovering = false; },
    isRecovery() { return recovering; },
  };
  return {
    service: createAuthService(() => auth, { storage, ...options }),
    calls,
    emit,
    storage,
    replaceSession(value) { currentSession = value; },
    savedSession: () => currentSession,
    subscriptions: () => subscriptions,
    unsubscriptions: () => unsubscriptions,
    activeSubscriptions: () => handlers.size,
  };
}

function nativeLifecycle(initialState = 'active') {
  let state = initialState;
  const listeners = new Set();
  let subscriptions = 0;
  let unsubscriptions = 0;
  return {
    getState: () => state,
    subscribe(listener) {
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        if (listeners.delete(listener)) unsubscriptions += 1;
      };
    },
    change(next) {
      state = next;
      for (const listener of listeners) listener(next);
    },
    subscriptions: () => subscriptions,
    unsubscriptions: () => unsubscriptions,
    activeSubscriptions: () => listeners.size,
  };
}

test('odtworzenie sesji zaczyna się od initializing i sprawdza użytkownika na serwerze', async () => {
  const cachedUser = { ...user, email: 'outdated@example.com', email_confirmed_at: null };
  const { service, calls } = setup(makeSession(cachedUser), {
    getUser: async () => ({ data: { user }, error: null }),
  });
  assert.deepEqual(service.getState(), { status: 'initializing' });
  assert.equal((await service.initialize()).ok, true);
  assert.deepEqual(service.getState(), { status: 'signedIn', user: { id: user.id, email: user.email } });
  assert.deepEqual(calls.map(call => call.name), ['getSession', 'getUser', 'getSession']);
  assert.deepEqual(calls[1].args, ['session-access-token']);
});

test('równoległe initialize współdzielą trwające odtworzenie sesji', async () => {
  const response = deferred();
  const { service, calls } = setup(makeSession(), { getSession: () => response.promise });
  const first = service.initialize();
  const second = service.initialize();
  await flushEvents();
  assert.equal(calls.filter(call => call.name === 'getSession').length, 1);
  response.resolve({ data: { session: makeSession() }, error: null });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(service.getState().status, 'signedIn');
});

test('brak zapisanej sesji kończy inicjalizację bez zapytania o użytkownika', async () => {
  const { service, calls } = setup();
  assert.equal((await service.initialize()).ok, true);
  assert.deepEqual(service.getState(), { status: 'signedOut' });
  assert.deepEqual(calls.map(call => call.name), ['getSession']);
});

test('brak konfiguracji kończy initializing kontrolowanym błędem zamiast zostawiać ekran ładowania', async () => {
  const service = createAuthService(() => null);
  const result = await service.initialize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'configuration_error');
  assert.equal(service.getState().status, 'error');
  assert.equal(service.getState().error.code, 'configuration_error');
});

test('odtworzenie używa tokenu odświeżonego przez SDK zamiast starego tokenu z pamięci', async () => {
  const stale = { ...makeSession(user, 'old-access-token'), expires_at: 1 };
  const fresh = makeSession(user, 'refreshed-access-token');
  const { service, calls } = setup(stale, {
    getSession: async () => ({ data: { session: fresh }, error: null }),
  });
  assert.equal((await service.initialize()).ok, true);
  assert.deepEqual(calls.find(call => call.name === 'getUser').args, ['refreshed-access-token']);
  assert.equal(service.getState().status, 'signedIn');
});

test('odrzucona sesja wraca do signedOut zamiast pozostawać w stanie błędu', async () => {
  for (const code of ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used']) {
    const { service } = setup(makeSession(), {
      getSession: async () => ({ data: { session: null }, error: { code, status: 400 } }),
    });
    const result = await service.initialize();
    assert.equal(result.ok, false, code);
    assert.equal(result.error.code, 'session_expired', code);
    assert.equal(service.getState().status, 'signedOut', code);
  }
});

test('brak internetu i błąd serwera nie kasują zapisanej sesji; retrySession pozwala wrócić', async () => {
  for (const [error, expectedCode] of [
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network_error'],
    [{ code: 'unexpected_failure', status: 503 }, 'service_unavailable'],
  ]) {
    let unavailable = true;
    const saved = makeSession();
    const { service, calls, savedSession } = setup(saved, {
      getUser: async () => unavailable
        ? { data: { user: null }, error }
        : { data: { user }, error: null },
    });
    const first = await service.initialize();
    assert.equal(first.ok, false);
    assert.equal(first.error.code, expectedCode);
    assert.equal(service.getState().status, 'error');
    assert.equal(savedSession(), saved);
    assert.equal(calls.some(call => call.name === 'signOut'), false);

    unavailable = false;
    assert.equal((await service.retrySession()).ok, true);
    assert.equal(service.getState().status, 'signedIn');
  }
});

test('niepotwierdzone konto z zapisanej sesji nie otrzymuje dostępu do aplikacji', async () => {
  const unconfirmed = { ...user, email_confirmed_at: null };
  const { service, calls, savedSession } = setup(makeSession(unconfirmed));
  const result = await service.initialize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'session_expired');
  assert.equal(service.getState().status, 'signedOut');
  assert.equal(savedSession(), null);
  assert.deepEqual(calls.at(-1), { name: 'signOut', args: [{ scope: 'local' }] });
});

test('start współdzieli jedną subskrypcję SDK i usuwa ją po ostatnim odbiorcy', async () => {
  const { service, subscriptions, unsubscriptions, activeSubscriptions, calls } = setup();
  const releaseFirst = service.start();
  const releaseSecond = service.start();
  await flushEvents();
  assert.equal(subscriptions(), 1);
  assert.equal(activeSubscriptions(), 1);
  assert.equal(calls.filter(call => call.name === 'getSession').length, 1);
  releaseFirst();
  releaseFirst();
  assert.equal(activeSubscriptions(), 1);
  releaseSecond();
  assert.equal(activeSubscriptions(), 0);
  assert.equal(unsubscriptions(), 1);

  const releaseRemount = service.start();
  await flushEvents();
  assert.equal(subscriptions(), 2);
  assert.equal(calls.filter(call => call.name === 'getSession').length, 2);
  releaseRemount();
  assert.equal(activeSubscriptions(), 0);
  assert.equal(calls.some(call => call.name === 'startAutoRefresh' || call.name === 'stopAutoRefresh'), false);
});

test('spóźnione SIGNED_OUT z innej karty odczytuje aktualną sesję zamiast wylogować nowe konto', async () => {
  const instance = setup(makeSession());
  const release = instance.service.start();
  try {
    await instance.service.initialize();
    const otherUser = { ...user, id: 'another-user', email: 'another@example.com' };
    instance.replaceSession(makeSession(otherUser, 'new-account-token'));
    const callbackResults = instance.emit('SIGNED_OUT', null);
    assert.deepEqual(callbackResults, [undefined], 'callback SDK nie może oczekiwać na kolejne wywołanie SDK');
    await flushEvents();
    assert.deepEqual(instance.service.getState(), {
      status: 'signedIn', user: { id: otherUser.id, email: otherUser.email },
    });
    assert.equal(instance.calls.some(call => call.name === 'signOut'), false);
  } finally {
    release();
  }
});

test('SIGNED_OUT po rzeczywistym usunięciu sesji wylogowuje bieżącą kartę', async () => {
  const instance = setup(makeSession());
  const release = instance.service.start();
  try {
    await instance.service.initialize();
    assert.equal(instance.service.getState().status, 'signedIn');
    instance.replaceSession(null);
    instance.emit('SIGNED_OUT', null);
    await flushEvents();
    assert.equal(instance.service.getState().status, 'signedOut');
  } finally {
    release();
  }
});

test('błąd sprawdzania starego tokenu nie usuwa konta zalogowanego równolegle w innej karcie', async () => {
  const response = deferred();
  const started = deferred();
  const otherUser = { ...user, id: 'new-user', email: 'new@example.com' };
  const instance = setup(makeSession(), {
    getUser: async token => {
      if (token === 'new-token') return { data: { user: otherUser }, error: null };
      started.resolve();
      return response.promise;
    },
  });
  const states = [];
  const unsubscribe = instance.service.subscribe(() => states.push(instance.service.getState()));
  const release = instance.service.start();
  try {
    await started.promise;
    instance.replaceSession(makeSession(otherUser, 'new-token'));
    response.resolve({ data: { user: null }, error: { code: 'session_not_found', status: 401 } });
    await flushEvents();
    assert.deepEqual(instance.service.getState(), {
      status: 'signedIn', user: { id: otherUser.id, email: otherUser.email },
    });
    assert.equal(instance.calls.some(call => call.name === 'signOut'), false);
    assert.equal(states.some(state => state.status === 'signedOut' || state.status === 'error'), false);
  } finally {
    unsubscribe();
    release();
  }
});

test('odświeżenie tokenu tej samej osoby nie powiadamia UI o pozornej zmianie użytkownika', async () => {
  const instance = setup(makeSession());
  const release = instance.service.start();
  await instance.service.initialize();
  const before = instance.service.getState();
  let changes = 0;
  const unsubscribe = instance.service.subscribe(() => { changes += 1; });
  try {
    instance.replaceSession(makeSession(user, 'refreshed-token'));
    instance.emit('TOKEN_REFRESHED');
    await flushEvents();
    assert.equal(instance.service.getState(), before);
    assert.equal(changes, 0);
    assert.deepEqual(instance.calls.filter(call => call.name === 'getUser').at(-1).args, ['refreshed-token']);
  } finally {
    unsubscribe();
    release();
  }
});

test('zdarzenia SDK i ponowienie sesji nie zmieniają recovery w zwykłe logowanie', async () => {
  const instance = setup();
  const release = instance.service.start();
  await instance.service.initialize();
  const states = [];
  const unsubscribe = instance.service.subscribe(() => states.push(instance.service.getState().status));
  try {
    assert.equal((await instance.service.verifyPasswordResetCode(user.email, '123456')).ok, true);
    assert.equal(instance.storage.isRecovery(), true);
    instance.emit('SIGNED_IN');
    instance.emit('TOKEN_REFRESHED');
    await flushEvents();
    assert.equal((await instance.service.retrySession()).ok, true);
    assert.deepEqual(instance.service.getState(), { status: 'recovery', phase: 'settingPassword' });
    assert.equal(states.includes('signedIn'), false);
  } finally {
    unsubscribe();
    release();
  }
});

test('wylogowanie podczas odtwarzania blokuje spóźnione przywrócenie zalogowanego stanu', async () => {
  const started = deferred();
  const response = deferred();
  const { service, calls } = setup(makeSession(), {
    getSession: async () => { started.resolve(); return response.promise; },
  });
  const states = [];
  service.subscribe(() => states.push(service.getState().status));
  const initialization = service.initialize();
  await started.promise;
  const logout = service.signOut();
  assert.equal(service.getState().status, 'signedOut');
  response.resolve({ data: { session: makeSession() }, error: null });
  assert.equal((await initialization).error.code, 'cancelled');
  assert.equal((await logout).ok, true);
  assert.equal(service.getState().status, 'signedOut');
  assert.equal(states.includes('signedIn'), false);
  assert.deepEqual(calls.at(-1), { name: 'signOut', args: [{ scope: 'local' }] });
});

test('przejście native do tła podczas inicjalizacji nie uruchamia spóźnionego odświeżania', async () => {
  const lifecycle = nativeLifecycle();
  const response = deferred();
  const started = deferred();
  let initializing = true;
  const instance = setup(makeSession(), {
    getSession: async () => {
      if (!initializing) return { data: { session: makeSession() }, error: null };
      started.resolve();
      return response.promise;
    },
  }, { lifecycle });
  const release = instance.service.start();
  try {
    await started.promise;
    lifecycle.change('background');
    initializing = false;
    response.resolve({ data: { session: makeSession() }, error: null });
    await flushEvents();
    assert.equal(instance.service.getState().status, 'signedIn');
    assert.equal(instance.calls.some(call => call.name === 'startAutoRefresh'), false);
    assert.equal(instance.calls.some(call => call.name === 'stopAutoRefresh'), true);

    lifecycle.change('active');
    await flushEvents();
    assert.equal(instance.calls.some(call => call.name === 'startAutoRefresh'), true);
    lifecycle.change('inactive');
    await flushEvents();
    assert.equal(instance.calls.filter(call => /AutoRefresh$/.test(call.name)).at(-1).name, 'stopAutoRefresh');
  } finally {
    release();
    await flushEvents();
  }
});

test('native montowanie, odmontowanie i ponowny montaż nie pozostawiają starych listenerów ani tickera', async () => {
  const lifecycle = nativeLifecycle();
  const instance = setup(makeSession(), {}, { lifecycle });
  const releaseFirst = instance.service.start();
  releaseFirst();
  releaseFirst();
  const releaseSecond = instance.service.start();
  await flushEvents();
  assert.equal(instance.service.getState().status, 'signedIn');
  assert.equal(instance.subscriptions(), 2);
  assert.equal(instance.unsubscriptions(), 1);
  assert.equal(instance.activeSubscriptions(), 1);
  assert.equal(lifecycle.subscriptions(), 2);
  assert.equal(lifecycle.unsubscriptions(), 1);
  assert.equal(lifecycle.activeSubscriptions(), 1);

  releaseSecond();
  await flushEvents();
  assert.equal(instance.activeSubscriptions(), 0);
  assert.equal(lifecycle.activeSubscriptions(), 0);
  assert.equal(instance.calls.filter(call => /AutoRefresh$/.test(call.name)).at(-1).name, 'stopAutoRefresh');
  const completedCalls = instance.calls.length;
  lifecycle.change('active');
  instance.emit('TOKEN_REFRESHED');
  await flushEvents();
  assert.equal(instance.calls.length, completedCalls);
});
