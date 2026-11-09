export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createSessionStorage(durable: AuthStorage, sessionKey: string) {
  let recovery: Map<string, string> | null = null;
  let recoveryReady: Promise<void> | null = null;
  let mutations = Promise.resolve();

  function mutate(operation: () => Promise<void>) {
    const result = mutations.then(operation);
    // Keep later cleanup runnable while returning the original error to its caller.
    mutations = result.catch(() => {});
    return result;
  }

  return {
    getItem(key: string): Promise<string | null> {
      return recovery ? Promise.resolve(recovery.get(key) ?? null) : durable.getItem(key);
    },
    setItem(key: string, value: string): Promise<void> {
      if (recovery) {
        recovery.set(key, value);
        return Promise.resolve();
      }
      return mutate(() => durable.setItem(key, value));
    },
    removeItem(key: string): Promise<void> {
      if (recovery) {
        recovery.delete(key);
        return Promise.resolve();
      }
      return mutate(() => durable.removeItem(key));
    },
    beginRecovery(): Promise<void> {
      if (recoveryReady) return recoveryReady;
      // Activate before any await: even SDK writes during cleanup stay in memory.
      recovery = new Map();
      recoveryReady = mutate(async () => {
        const results = await Promise.allSettled([
          durable.removeItem(sessionKey),
          durable.removeItem(`${sessionKey}-user`),
        ]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      });
      return recoveryReady;
    },
    endRecovery(): void {
      recovery = null;
      recoveryReady = null;
    },
    isRecovery(): boolean {
      return recovery !== null;
    },
  };
}
