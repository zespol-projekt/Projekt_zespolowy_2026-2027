import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStorage } from '../src/features/auth/storage.ts';

const sessionKey = 'test-auth-session';

function setup(entries = []) {
  const values = new Map(entries);
  const durable = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  return { values, durable, storage: createSessionStorage(durable, sessionKey) };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('normal session survives a new adapter and can be removed', async () => {
  const { durable, storage } = setup();
  assert.equal(storage.isRecovery(), false);
  await storage.setItem(sessionKey, 'normal-session');
  const restarted = createSessionStorage(durable, sessionKey);
  assert.equal(await restarted.getItem(sessionKey), 'normal-session');
  await restarted.removeItem(sessionKey);
  assert.equal(await storage.getItem(sessionKey), null);
});

test('recovery starts synchronously, uses only memory and does not survive restart', async () => {
  const { values, durable, storage } = setup([
    [sessionKey, 'normal-session'],
    [`${sessionKey}-user`, 'normal-user'],
    ['unrelated', 'preserved'],
  ]);
  const ready = storage.beginRecovery();
  assert.equal(storage.isRecovery(), true);
  assert.equal(await storage.getItem('unrelated'), null);
  await storage.setItem(sessionKey, 'recovery-session');
  await storage.setItem(`${sessionKey}-user`, 'recovery-user');
  await ready;
  assert.equal(await storage.getItem(sessionKey), 'recovery-session');
  assert.deepEqual([...values], [['unrelated', 'preserved']]);
  const restarted = createSessionStorage(durable, sessionKey);
  assert.equal(restarted.isRecovery(), false);
  assert.equal(await restarted.getItem(sessionKey), null);
  assert.equal(await restarted.getItem(`${sessionKey}-user`), null);
});

test('ending recovery leaves a newer durable session from another tab intact', async () => {
  const { values, durable, storage } = setup();
  await storage.beginRecovery();
  await storage.setItem(sessionKey, 'recovery-session');
  await durable.setItem(sessionKey, 'other-tab-session');
  await durable.setItem(`${sessionKey}-user`, 'other-tab-user');
  assert.equal(await storage.getItem('missing'), null);
  await storage.removeItem(sessionKey);
  assert.equal(await storage.getItem(sessionKey), null);
  await storage.beginRecovery();
  storage.endRecovery();
  assert.equal(storage.isRecovery(), false);
  assert.equal(await storage.getItem(sessionKey), 'other-tab-session');
  assert.equal(values.get(`${sessionKey}-user`), 'other-tab-user');
  await storage.beginRecovery();
  assert.equal(await storage.getItem(`${sessionKey}-user`), null);
});

test('an earlier pending durable write cannot recreate a session after recovery cleanup', async () => {
  const { values, durable } = setup();
  const pending = deferred();
  const originalSetItem = durable.setItem;
  durable.setItem = async (key, value) => {
    await pending.promise;
    await originalSetItem(key, value);
  };
  const storage = createSessionStorage(durable, sessionKey);
  const earlierWrite = storage.setItem(sessionKey, 'normal-session');
  const ready = storage.beginRecovery();
  await storage.setItem(sessionKey, 'recovery-session');
  pending.resolve();
  await Promise.all([earlierWrite, ready]);
  assert.equal(values.has(sessionKey), false);
  assert.equal(await storage.getItem(sessionKey), 'recovery-session');
});

test('durable read and write errors propagate and do not block later cleanup', async () => {
  const { values, durable } = setup([[sessionKey, 'normal-session']]);
  const readError = new Error('read unavailable');
  const writeError = new Error('write unavailable');
  durable.getItem = async () => { throw readError; };
  durable.setItem = async () => { throw writeError; };
  const storage = createSessionStorage(durable, sessionKey);
  await assert.rejects(storage.getItem(sessionKey), error => error === readError);
  await assert.rejects(storage.setItem(sessionKey, 'new-session'), error => error === writeError);
  await storage.beginRecovery();
  assert.equal(values.has(sessionKey), false);
  assert.equal(await storage.getItem(sessionKey), null);
});

test('failed recovery cleanup propagates after both removal attempts, without durable fallback', async () => {
  const { durable } = setup([[sessionKey, 'normal-session']]);
  const removalError = new Error('remove unavailable');
  const calls = [];
  durable.removeItem = async key => { calls.push(key); throw removalError; };
  const storage = createSessionStorage(durable, sessionKey);
  await assert.rejects(storage.removeItem('other'), error => error === removalError);
  await assert.rejects(storage.beginRecovery(), error => error === removalError);
  assert.deepEqual(calls, ['other', sessionKey, `${sessionKey}-user`]);
  assert.equal(storage.isRecovery(), true);
  assert.equal(await storage.getItem(sessionKey), null);
});
