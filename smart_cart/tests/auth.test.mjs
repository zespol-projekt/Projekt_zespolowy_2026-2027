import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/features/auth/service.ts';

const email = 'test@example.com';
const password = ' test-password ';
const user = {
  id: 'test-user',
  email,
  email_confirmed_at: '2026-11-08T12:00:00Z',
  is_anonymous: false,
};
const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user,
};
const signedIn = () => ({ data: { user, session }, error: null });
const failure = (code, status = 400) => ({
  data: { user: null, session: null },
  error: { code, status, message: 'RAW_SERVER_RESPONSE_WITH_PRIVATE_DETAILS' },
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function setup(overrides = {}) {
  let initialized = false;
  const calls = [];
  const methods = {
    signUp: async () => ({ data: { user: { ...user, email_confirmed_at: null }, session: null }, error: null }),
    verifyOtp: async () => signedIn(),
    resend: async () => ({ data: {}, error: null }),
    signInWithPassword: async () => signedIn(),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user }, error: null }),
    signOut: async () => ({ error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    ...overrides,
  };
  const auth = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    if (!initialized && name === 'getSession') return { data: { session: null }, error: null };
    calls.push({ name, args });
    return method(...args);
  }]));
  const service = createAuthService(() => auth);
  await service.initialize();
  initialized = true;
  return { service, calls };
}

test('rejestracja normalizuje adres, zachowuje hasło i czeka na potwierdzenie', async () => {
  const { service, calls } = await setup();
  assert.deepEqual(await service.signUp(' TEST@EXAMPLE.COM ', password), {
    ok: true, data: { status: 'confirmationRequired', email },
  });
  assert.deepEqual(calls[0], { name: 'signUp', args: [{ email, password }] });
  assert.equal(service.getState().status, 'signedOut');
  assert.equal((await service.signUp(email, 'short')).error.code, 'weak_password');
  assert.equal(calls.length, 1);
});

test('sesja zwrócona przy rejestracji bez wymaganego potwierdzenia jest odrzucana', async () => {
  const { service, calls } = await setup({ signUp: async () => signedIn() });
  assert.equal((await service.signUp(email, password)).error.code, 'configuration_error');
  assert.equal(service.getState().status, 'signedOut');
  assert.deepEqual(calls.at(-1), { name: 'signOut', args: [{ scope: 'local' }] });
});

test('logowanie niepotwierdzonym adresem kieruje do kodu, bez tworzenia sesji', async () => {
  const { service } = await setup({ signInWithPassword: async () => failure('email_not_confirmed') });
  assert.deepEqual(await service.signIn(email, password), {
    ok: true, data: { status: 'confirmationRequired', email },
  });
  assert.equal(service.getState().status, 'signedOut');
});

test('logowanie akceptuje istniejące krótsze hasło i ujawnia UI tylko id oraz email', async () => {
  const { service, calls } = await setup();
  assert.deepEqual(await service.signIn(email, 'short'), { ok: true, data: { status: 'signedIn' } });
  assert.deepEqual(calls[0].args, [{ email, password: 'short' }]);
  assert.deepEqual(service.getState(), { status: 'signedIn', user: { id: user.id, email } });
});

test('potwierdzenie rejestracji używa email OTP; brak sesji wymaga logowania', async () => {
  const { service, calls } = await setup();
  assert.deepEqual(await service.verifySignupCode(email, '123456'), {
    ok: true, data: { status: 'signedIn' },
  });
  assert.deepEqual(calls[0].args, [{ email, token: '123456', type: 'email' }]);
  assert.equal(service.getState().status, 'signedIn');

  const withoutSession = await setup({ verifyOtp: async () => ({ data: { user, session: null }, error: null }) });
  assert.deepEqual(await withoutSession.service.verifySignupCode(email, '123456'), {
    ok: true, data: { status: 'signInRequired' },
  });
  assert.equal(withoutSession.service.getState().status, 'signedOut');
});

test('kod jest sześcioma cyframi i nie jest po cichu przycinany', async () => {
  const { service, calls } = await setup();
  for (const code of [' 123456', '123456 ', '12345', '12345a']) {
    assert.equal((await service.verifySignupCode(email, code)).error.code, 'invalid_or_expired_code');
  }
  assert.deepEqual(calls, []);
});

test('ponowienie rejestracji używa signup, reset nie sprawdza istnienia konta', async () => {
  const { service, calls } = await setup();
  assert.equal((await service.resendSignupCode(email)).ok, true);
  assert.deepEqual(calls[0].args, [{ type: 'signup', email }]);
  assert.equal((await service.sendPasswordResetCode('unknown@example.com')).ok, true);
  assert.deepEqual(calls[1], { name: 'resetPasswordForEmail', args: ['unknown@example.com'] });
  assert.equal(service.getState().status, 'signedOut');
});

test('recovery zaczyna się przed weryfikacją kodu i nigdy nie przechodzi do signedIn', async () => {
  const started = deferred();
  const response = deferred();
  const { service, calls } = await setup({ verifyOtp: async () => { started.resolve(); return response.promise; } });
  const states = [];
  const unsubscribe = service.subscribe(() => states.push(service.getState()));
  const verification = service.verifyPasswordResetCode(email, '123456');
  await started.promise;
  assert.deepEqual(service.getState(), { status: 'recovery', phase: 'verifyingCode' });
  assert.deepEqual(calls[0].args, [{ email, token: '123456', type: 'recovery' }]);
  response.resolve(signedIn());
  assert.equal((await verification).ok, true);
  assert.deepEqual(service.getState(), { status: 'recovery', phase: 'settingPassword' });
  assert.equal(states.some(state => state.status === 'signedIn'), false);
  unsubscribe();
});

test('błędny kod recovery zamyka tryb odzyskiwania', async () => {
  const { service } = await setup({ verifyOtp: async () => failure('otp_expired') });
  assert.equal((await service.verifyPasswordResetCode(email, '123456')).error.code, 'invalid_or_expired_code');
  assert.equal(service.getState().status, 'signedOut');
});

test('kolejka operacji i ponowienie sesji nie zamieniają recovery w zwykłe logowanie', async () => {
  const { service, calls } = await setup({
    getSession: async () => ({ data: { session }, error: null }),
  });
  const states = [];
  const unsubscribe = service.subscribe(() => states.push(service.getState().status));

  // Wszystkie wywołania trafiają do kolejki, zanim pierwsze zdąży zmienić stan.
  const recovery = service.verifyPasswordResetCode(email, '123456');
  const blocked = [
    service.verifyPasswordResetCode(email, '654321'),
    service.signUp(email, password),
    service.verifySignupCode(email, '123456'),
    service.signIn(email, password),
  ];
  assert.equal((await recovery).ok, true);
  for (const result of await Promise.all(blocked)) assert.equal(result.ok, false);
  assert.deepEqual(calls.map(call => call.name), ['verifyOtp']);

  assert.equal((await service.retrySession()).ok, true);
  assert.deepEqual(service.getState(), { status: 'recovery', phase: 'settingPassword' });
  assert.deepEqual(calls.map(call => call.name), ['verifyOtp', 'getSession', 'getUser', 'getSession']);
  assert.equal(states.includes('signedIn'), false);
  unsubscribe();
});

test('wyjątek sieciowy podczas OTP zamyka recovery i ukrywa szczegóły błędu', async () => {
  const { service } = await setup({
    verifyOtp: async () => { throw new TypeError('RAW_SERVER_RESPONSE_WITH_PRIVATE_DETAILS'); },
  });
  const result = await service.verifyPasswordResetCode(email, '123456');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'network_error');
  assert.doesNotMatch(result.error.message, /RAW_SERVER/);
  assert.equal(service.getState().status, 'signedOut');
});

test('ponowienie recovery bez istniejącej sesji wraca do signedOut', async () => {
  const { service } = await setup();
  await service.verifyPasswordResetCode(email, '123456');
  assert.equal((await service.retrySession()).ok, true);
  assert.equal(service.getState().status, 'signedOut');
});

test('zmiana hasła wymaga recovery, zachowuje spacje i kończy się lokalnym wylogowaniem', async () => {
  const { service, calls } = await setup();
  assert.equal((await service.setNewPassword(password)).ok, false);
  assert.deepEqual(calls, []);
  assert.equal((await service.verifyPasswordResetCode(email, '123456')).ok, true);
  assert.equal((await service.setNewPassword('short')).error.code, 'weak_password');
  assert.equal((await service.setNewPassword(password)).ok, true);
  assert.deepEqual(calls.slice(-2), [
    { name: 'updateUser', args: [{ password }] },
    { name: 'signOut', args: [{ scope: 'local' }] },
  ]);
  assert.equal(service.getState().status, 'signedOut');
});

test('zapis hasła i nieudane unieważnienie sesji daje wyraźny częściowy sukces', async () => {
  const { service } = await setup({ signOut: async () => failure('unexpected_failure', 500) });
  await service.verifyPasswordResetCode(email, '123456');
  const result = await service.setNewPassword(password);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /hasł/i);
  assert.match(result.error.message, /zmien|zapis/i);
  assert.doesNotMatch(result.error.message, /RAW_SERVER/);
  assert.equal(service.getState().status, 'signedOut');
});

test('błędy są mapowane według kodu bez surowych szczegółów odpowiedzi', async () => {
  for (const [serverCode, status, appCode] of [
    ['invalid_credentials', 400, 'invalid_credentials'],
    ['weak_password', 422, 'weak_password'],
    ['over_email_send_rate_limit', 429, 'rate_limited'],
    ['session_expired', 403, 'session_expired'],
    ['email_provider_disabled', 403, 'configuration_error'],
    ['unexpected_failure', 500, 'service_unavailable'],
  ]) {
    const { service } = await setup({ signInWithPassword: async () => failure(serverCode, status) });
    const result = await service.signIn(email, password);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, appCode);
    assert.ok(result.error.message.length > 0);
    assert.doesNotMatch(result.error.message, /RAW_SERVER/);
    assert.equal(result.error.retryAfterSeconds, undefined);
  }
});

test('brak konfiguracji zwraca kontrolowany błąd', async () => {
  const service = createAuthService(() => null);
  const result = await service.signIn(email, password);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'configuration_error');
});

test('wylogowanie unieważnia odpowiedź trwającego logowania i czyści sesję po nim', async () => {
  const started = deferred();
  const response = deferred();
  const { service, calls } = await setup({ signInWithPassword: async () => { started.resolve(); return response.promise; } });
  const pendingLogin = service.signIn(email, password);
  await started.promise;
  const pendingLogout = service.signOut();
  assert.equal(service.getState().status, 'signedOut');
  response.resolve(signedIn());
  assert.equal((await pendingLogin).error.code, 'cancelled');
  assert.equal((await pendingLogout).ok, true);
  assert.equal(service.getState().status, 'signedOut');
  assert.deepEqual(calls.map(call => call.name), ['signInWithPassword', 'signOut']);
  assert.deepEqual(calls.at(-1).args, [{ scope: 'local' }]);
});
