import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/features/auth/service.ts';

const user = { id: 'profile-user', email: 'profile@example.invalid', email_confirmed_at: '2026-01-01', is_anonymous: false };
const session = { user, access_token: 'fixture', refresh_token: 'fixture' };
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function setup(overrides = {}) {
  const calls = [];
  let live = session;
  const client = {
    getSession: async () => ({ data: { session: live }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    reauthenticate: async () => { calls.push('reauthenticate'); return { error: null }; },
    updateUser: async value => { calls.push(value); return { data: { user }, error: null }; },
    signOut: async () => { live = null; return { error: null }; },
    ...overrides,
  };
  const service = createAuthService(() => client);
  await service.initialize();
  return { service, calls };
}
test('profil wymaga wysłania kodu, waliduje hasło i nonce, zachowuje sesję', async () => {
  const { service, calls } = await setup(); const key = service.getSessionKey();
  assert.equal((await service.changePassword('new-password', '123456')).error.code, 'reauthentication_required');
  assert.equal((await service.sendPasswordChangeCode()).ok, true);
  assert.equal((await service.changePassword('short', '123456')).error.code, 'weak_password');
  assert.equal((await service.changePassword('new-password', 'bad')).error.code, 'invalid_reauthentication_code');
  assert.equal((await service.changePassword(' new-password ', '123456')).ok, true);
  assert.deepEqual(calls, ['reauthenticate', { password: ' new-password ', nonce: '123456' }]);
  assert.equal(service.getSessionKey(), key);
  assert.equal(service.getState().status, 'signedIn');
  assert.equal((await service.setNewPassword('new-password')).ok, false);
});
test('profil nie działa bez sesji ani w recovery, ponowienia kodu mają limit', async () => {
  const { service } = await setup();
  await service.sendPasswordChangeCode();
  assert.equal((await service.sendPasswordChangeCode()).error.code, 'rate_limited');
  await service.signOut();
  assert.equal((await service.sendPasswordChangeCode()).error.code, 'session_expired');
  assert.equal((await service.changePassword('new-password', '123456')).error.code, 'session_expired');
});
test('błędy zapisu nie wylogowują, nie ujawniają serwera i można ponowić', async () => {
  for (const [code, expected] of [['weak_password', 'weak_password'], ['reauthentication_not_valid', 'invalid_reauthentication_code'], ['reauthentication_needed', 'reauthentication_required'], ['current_password_required', 'current_password_required'], ['same_password', 'weak_password']]) {
    const { service } = await setup({ updateUser: async () => ({ error: { code, message: 'SECRET_SERVER_DETAIL' } }) });
    await service.sendPasswordChangeCode();
    const result = await service.changePassword('new-password', '123456');
    assert.equal(result.error.code, expected); assert.doesNotMatch(result.error.message, /SECRET/);
    assert.equal(service.getState().status, 'signedIn');
  }
  const { service } = await setup({ updateUser: async () => { throw new TypeError('SECRET'); } });
  await service.sendPasswordChangeCode();
  assert.equal((await service.changePassword('new-password', '123456')).error.code, 'network_error');
  assert.equal(service.getState().status, 'signedIn');
});
test('anulowanie przed wysłaniem nie zmienia hasła; późny wynik nie zgłasza sukcesu', async () => {
  const started = defer(), pending = defer();
  const { service } = await setup({ updateUser: async () => { started.resolve(); return pending.promise; } });
  await service.sendPasswordChangeCode();
  const controller = new AbortController();
  const saving = service.changePassword('new-password', '123456', controller.signal);
  await started.promise; controller.abort(); pending.resolve({ error: null });
  assert.equal((await saving).error.code, 'cancelled');
  assert.equal(service.getState().status, 'signedIn');
  assert.equal((await service.changePassword('new-password', '123456', controller.signal)).error.code, 'cancelled');
});
test('wylogowanie podczas zapisu odrzuca późną odpowiedź bez przywracania sesji', async () => {
  const started = defer(), pending = defer();
  const { service } = await setup({ updateUser: async () => { started.resolve(); return pending.promise; } });
  await service.sendPasswordChangeCode();
  const saving = service.changePassword('new-password', '123456');
  await started.promise; const logout = service.signOut();
  pending.resolve({ error: null });
  assert.equal((await saving).error.code, 'cancelled'); await logout;
  assert.equal(service.getState().status, 'signedOut');
});


test('zmiana konta podczas żądania odcina operację starej sesji', async () => {
  let callback, resolve;
  const pending = new Promise(done => { resolve = done; });
  const { service } = await setup({
    onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    updateUser: () => pending,
  });
  const stop = service.start(); await service.initialize();
  await service.sendPasswordChangeCode();
  const result = service.changePassword('new-password', '123456');
  await new Promise(done => setImmediate(done));
  callback('SIGNED_IN', { ...session, user: { ...user, id: 'another-user' } });
  assert.equal(service.getSessionKey(), null);
  resolve({ error: null }); assert.equal((await result).error.code, 'cancelled'); stop();
});
