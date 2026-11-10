import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { failure, mapAuthError } from './errors.ts';
import type { AuthActions, AuthResult, AuthSessionAccess, AuthState, AuthUser, SignInResult, SignupVerificationResult } from './types.ts';

type AuthClient = SupabaseClient['auth'];
type ServiceOptions = {
  storage?: {
    beginRecovery(): Promise<void>;
    endRecovery(): void;
    isRecovery(): boolean;
  };
  /** Tylko native. Widocznością karty WWW zarządza SDK. */
  lifecycle?: {
    getState(): string | null;
    subscribe(listener: (state: string) => void): () => void;
  };
};
export type AuthService = AuthActions & AuthSessionAccess & {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<AuthResult>;
  start(): () => void;
};

// Wartości odpowiadają ustawieniom projektu opisanym w docs/supabase-setup.md.
export const authPolicy = {
  minimumPasswordLength: 8,
  codeLength: 6,
  codeExpiresInSeconds: 600,
  resendIntervalSeconds: 60,
} as const;

const success = <T = void>(data: T = undefined as T): AuthResult<T> => ({ ok: true, data });
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validCode = (code: string) => /^[0-9]{6}$/.test(code);
const normalizeEmail = (email: string) => email.trim().toLowerCase();

function confirmedUser(user: User | null): AuthUser | null {
  return user?.id && user.email && user.email_confirmed_at && !user.is_anonymous
    ? { id: user.id, email: user.email }
    : null;
}

function sessionIdentity(session: Session): string {
  // Tylko identyfikacja zmiany sesji, nigdy weryfikacja JWT ani uprawnienie do API.
  try {
    const payload = session.access_token.split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims.session_id === 'string') return `${session.user.id}:${claims.session_id}`;
  } catch { /* Niepełną sesję nadal zweryfikuje serwer; token nie trafia do snapshotu. */ }
  return session.user.id;
}

export function createAuthService(getAuth: () => AuthClient | null, options: ServiceOptions = {}): AuthService {
  let state: AuthState = { status: 'initializing' };
  let revision = 0;
  let queue = Promise.resolve();
  let checking: Promise<AuthResult> | null = null;
  let mounts = 0;
  let unsubscribeAuth: (() => void) | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;
  let eventPending = false;
  let refreshReady = false;
  let foreground = false;
  let refreshQueue = Promise.resolve();
  let sessionKey: string | null = null;
  let identity: string | null = null;
  let sessionGeneration = 0;
  let refreshing: { key: string; promise: Promise<AuthResult<string>> } | null = null;
  const listeners = new Set<() => void>();

  function publish(next: AuthState, operationRevision: number, session?: Session) {
    if (operationRevision !== revision) return;
    const previousKey = sessionKey;
    if (next.status !== 'signedIn') {
      sessionKey = null;
      identity = null;
    } else if (session) {
      const nextIdentity = sessionIdentity(session);
      if (sessionKey === null || nextIdentity !== identity) sessionKey = String(++sessionGeneration);
      identity = nextIdentity;
    }
    // Token nie jest częścią snapshotu UI; sam refresh nie renderuje ekranów ponownie.
    const stateChanged = JSON.stringify(state) !== JSON.stringify(next);
    if (!stateChanged && previousKey === sessionKey) return;
    if (stateChanged) state = next;
    listeners.forEach((listener) => listener());
    syncRefresh();
  }

  function syncRefresh() {
    if (!options.lifecycle || !refreshReady) return;
    refreshQueue = refreshQueue.then(async () => {
      const auth = getAuth();
      if (!auth) return;
      if (mounts > 0 && foreground && state.status === 'signedIn') await auth.startAutoRefresh();
      else await auth.stopAutoRefresh();
    }).catch((error: unknown) => {
      publish({ status: 'error', error: mapAuthError(error) }, revision);
    });
  }

  function scheduleReconcile() {
    eventPending = true;
    if (checking) return;
    queueMicrotask(() => {
      if (!mounts || !eventPending || checking) return;
      eventPending = false;
      void service.retrySession();
    });
  }

  // SDK również zmienia własną sesję. Kolejka gwarantuje, że wylogowanie wykona
  // się po trwającym logowaniu, a spóźniona odpowiedź nie przywróci stanu UI.
  function run<T>(operation: (auth: AuthClient, operationRevision: number) => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
    const operationRevision = revision;
    const result = queue.then(async (): Promise<AuthResult<T>> => {
      if (operationRevision !== revision) return failure('cancelled');
      try {
        const auth = getAuth();
        if (!auth) {
          const result = failure('configuration_error');
          if (!result.ok) publish({ status: 'error', error: result.error }, operationRevision);
          return result;
        }
        const response = await operation(auth, operationRevision);
        return operationRevision === revision ? response : failure('cancelled');
      } catch (error) {
        return operationRevision === revision
          ? { ok: false, error: mapAuthError(error) }
          : failure('cancelled');
      }
    });
    queue = result.then(() => undefined);
    return result;
  }

  async function closeSession(auth: AuthClient, operationRevision: number): Promise<AuthResult> {
    publish({ status: 'signedOut' }, operationRevision);
    // W przypiętej wersji SDK local usuwa sesję przed żądaniem sieciowym.
    const { error } = await auth.signOut({ scope: 'local' });
    options.storage?.endRecovery();
    return error ? { ok: false, error: mapAuthError(error) } : success();
  }

  function runSignedOut<T>(operation: (auth: AuthClient, current: number) => Promise<AuthResult<T>>) {
    if (state.status === 'initializing') {
      return service.initialize().then((result): Promise<AuthResult<T>> | AuthResult<T> =>
        result.ok ? runSignedOut(operation) : result);
    }
    return run((auth, current) => state.status === 'signedOut'
      ? operation(auth, current)
      : Promise.resolve(failure('cancelled', 'Najpierw zakończ bieżącą sesję lub odzyskiwanie hasła.')));
  }

  function runWithSession<T>(operation: (auth: AuthClient, current: number, key: string) => Promise<AuthResult<T>>) {
    const key = sessionKey;
    if (state.status !== 'signedIn' || key === null) return Promise.resolve(failure('session_expired'));
    return run(async (auth, current) => {
      if (sessionKey !== key || state.status !== 'signedIn') return failure('cancelled');
      try {
        return await operation(auth, current, key);
      } catch (error) {
        if (current !== revision || sessionKey !== key) return failure('cancelled');
        const mapped = mapAuthError(error);
        if (mapped.code === 'session_expired') await closeSession(auth, current);
        else publish({ status: 'error', error: mapped }, current);
        return { ok: false, error: mapped };
      }
    });
  }

  async function currentSession(auth: AuthClient, current: number, key: string): Promise<AuthResult<Session>> {
    const { data, error } = await auth.getSession();
    if (current !== revision || sessionKey !== key) return failure('cancelled');
    if (error) throw error;
    if (!data.session) {
      await closeSession(auth, current);
      return failure('session_expired');
    }
    if (sessionIdentity(data.session) !== identity) {
      publish({ status: 'initializing' }, current);
      // Odczyt SDK zauważył zmianę przed callbackiem; nowa sesja wymaga getUser.
      void service.retrySession();
      return failure('cancelled');
    }
    return success(data.session);
  }

  const service: AuthService = {
    getState: () => state,
    getSessionKey: () => sessionKey,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    initialize: () => service.retrySession(),
    start() {
      mounts += 1;
      if (mounts === 1) {
        refreshReady = false;
        try {
          const auth = getAuth();
          if (auth) {
            const { data } = auth.onAuthStateChange((event, session) => {
              // Callback nigdy nie czeka na SDK; payload może pochodzić ze starej karty.
              if (event === 'INITIAL_SESSION') return;
              if (sessionKey !== null && (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' ||
                (session && sessionIdentity(session) !== identity))) {
                publish({ status: 'initializing' }, revision);
              }
              scheduleReconcile();
            });
            unsubscribeAuth = () => data.subscription.unsubscribe();
          }
          unsubscribeLifecycle = options.lifecycle?.subscribe((next) => {
            foreground = next === 'active';
            syncRefresh();
            if (foreground) void service.retrySession();
          });
        } catch (error) {
          publish({ status: 'error', error: mapAuthError(error) }, revision);
        }
        void service.initialize().then(() => {
          refreshReady = true;
          foreground = options.lifecycle?.getState() === 'active';
          syncRefresh();
        });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        mounts -= 1;
        if (mounts === 0) {
          unsubscribeAuth?.();
          unsubscribeLifecycle?.();
          unsubscribeAuth = undefined;
          unsubscribeLifecycle = undefined;
          eventPending = false;
          syncRefresh();
        }
      };
    },

    signUp(rawEmail, password) {
      const email = normalizeEmail(rawEmail);
      return runSignedOut(async (auth, current) => {
        if (!validEmail(email)) return failure('invalid_email');
        if (password.length < authPolicy.minimumPasswordLength) return failure('weak_password');
        const { data, error } = await auth.signUp({ email, password });
        if (error) return { ok: false, error: mapAuthError(error) };
        if (data.session) {
          await closeSession(auth, current);
          return failure('configuration_error');
        }
        publish({ status: 'signedOut' }, current);
        return success({ status: 'confirmationRequired' as const, email });
      });
    },

    verifySignupCode(rawEmail, code) {
      const email = normalizeEmail(rawEmail);
      return runSignedOut<SignupVerificationResult>(async (auth, current) => {
        if (!validEmail(email)) return failure('invalid_email');
        if (!validCode(code)) return failure('invalid_or_expired_code');
        const { data, error } = await auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) return { ok: false, error: mapAuthError(error) };
        if (!data.session) {
          publish({ status: 'signedOut' }, current);
          return success({ status: 'signInRequired' as const });
        }
        const user = confirmedUser(data.user);
        if (!user) {
          await closeSession(auth, current);
          return failure('session_expired');
        }
        publish({ status: 'signedIn', user }, current, data.session);
        return success({ status: 'signedIn' as const });
      });
    },

    resendSignupCode(rawEmail) {
      const email = normalizeEmail(rawEmail);
      return run(async (auth) => {
        if (!validEmail(email)) return failure('invalid_email');
        const { error } = await auth.resend({ email, type: 'signup' });
        return error ? { ok: false, error: mapAuthError(error) } : success();
      });
    },

    signIn(rawEmail, password) {
      const email = normalizeEmail(rawEmail);
      return runSignedOut<SignInResult>(async (auth, current) => {
        if (!validEmail(email)) return failure('invalid_email');
        if (!password) return failure('invalid_credentials');
        const { data, error } = await auth.signInWithPassword({ email, password });
        if (error?.code === 'email_not_confirmed') {
          return success({ status: 'confirmationRequired' as const, email });
        }
        if (error) return { ok: false, error: mapAuthError(error) };
        const user = confirmedUser(data.user);
        if (!data.session || !user) {
          await closeSession(auth, current);
          return failure('session_expired');
        }
        publish({ status: 'signedIn', user }, current, data.session);
        return success({ status: 'signedIn' as const });
      });
    },

    sendPasswordResetCode(rawEmail) {
      const email = normalizeEmail(rawEmail);
      return run(async (auth) => {
        if (!validEmail(email)) return failure('invalid_email');
        const { error } = await auth.resetPasswordForEmail(email);
        // Supabase zwraca neutralny sukces również dla nieistniejącego konta.
        return error ? { ok: false, error: mapAuthError(error) } : success();
      });
    },

    verifyPasswordResetCode(rawEmail, code) {
      const email = normalizeEmail(rawEmail);
      return runSignedOut(async (auth, current) => {
        if (!validEmail(email)) return failure('invalid_email');
        if (!validCode(code)) return failure('invalid_or_expired_code');
        publish({ status: 'recovery', phase: 'verifyingCode' }, current);
        try {
          await options.storage?.beginRecovery();
          const { data, error } = await auth.verifyOtp({ email, token: code, type: 'recovery' });
          if (error) return { ok: false, error: mapAuthError(error) };
          if (!data.session || !confirmedUser(data.user)) {
            await closeSession(auth, current);
            return failure('session_expired');
          }
          publish({ status: 'recovery', phase: 'settingPassword' }, current);
          return success();
        } finally {
          if (state.status === 'recovery' && state.phase === 'verifyingCode') {
            await closeSession(auth, current);
          }
        }
      });
    },

    setNewPassword(password) {
      return run(async (auth, current) => {
        if (state.status !== 'recovery' || state.phase !== 'settingPassword') return failure('session_expired');
        if (password.length < authPolicy.minimumPasswordLength) return failure('weak_password');
        const { error } = await auth.updateUser({ password });
        if (error) return { ok: false, error: mapAuthError(error) };
        try {
          const closed = await closeSession(auth, current);
          if (closed.ok) return success();
          return failure(closed.error.code, 'Hasło zostało zmienione. Nie udało się potwierdzić zakończenia sesji na serwerze. Zaloguj się nowym hasłem.');
        } catch (error) {
          return failure(mapAuthError(error).code, 'Hasło zostało zmienione, ale zakończenie sesji nie powiodło się. Ponów wylogowanie.');
        }
      });
    },

    signOut() {
      revision += 1;
      publish({ status: 'signedOut' }, revision);
      return run(closeSession);
    },

    getAccessToken() {
      return runWithSession(async (auth, current, key) => {
        const result = await currentSession(auth, current, key);
        return result.ok ? success(result.data.access_token) : result;
      });
    },

    refreshAfterUnauthorized(rejectedToken) {
      const key = sessionKey;
      if (key !== null && refreshing?.key === key) return refreshing.promise;
      const promise = runWithSession(async (auth, current, activeKey) => {
        const before = await currentSession(auth, current, activeKey);
        if (!before.ok) return before;
        if (before.data.access_token !== rejectedToken) return success(before.data.access_token);
        const { error } = await auth.refreshSession();
        if (current !== revision || sessionKey !== activeKey) return failure('cancelled');
        if (error) throw error;
        const after = await currentSession(auth, current, activeKey);
        return after.ok ? success(after.data.access_token) : after;
      }).finally(() => {
        if (refreshing?.promise === promise) refreshing = null;
      });
      if (key !== null) refreshing = { key, promise };
      return promise;
    },

    invalidateSession(rejectedToken) {
      return runWithSession(async (auth, current, key) => {
        const result = await currentSession(auth, current, key);
        if (!result.ok) return result;
        return result.data.access_token === rejectedToken ? closeSession(auth, current) : success();
      });
    },

    retrySession() {
      if (checking) return checking;
      checking = run(async (auth, current) => {
        const previous = state;
        try {
          const { data, error } = await auth.getSession();
          if (error) throw error;
          if (!data.session) {
            options.storage?.endRecovery();
            publish({ status: 'signedOut' }, current);
            return success();
          }
          const checked = await auth.getUser(data.session.access_token);
          // Inna karta mogła zalogować nową osobę w czasie zapytania getUser.
          const latest = await auth.getSession();
          if (latest.error) throw latest.error;
          if (latest.data.session?.access_token !== data.session.access_token) {
            scheduleReconcile();
            return failure('cancelled');
          }
          if (checked.error) throw checked.error;
          const user = confirmedUser(checked.data.user);
          if (!user) {
            await closeSession(auth, current);
            return failure('session_expired');
          }
          // Ponowienie nie może zamienić sesji odzyskiwania w zwykłe logowanie.
          const recovering = options.storage?.isRecovery() || previous.status === 'recovery';
          publish(recovering ? { status: 'recovery', phase: 'settingPassword' } : { status: 'signedIn', user }, current, data.session);
          return success();
        } catch (error) {
          const mapped = mapAuthError(error);
          if (mapped.code === 'session_expired') await closeSession(auth, current);
          else publish({ status: 'error', error: mapped }, current);
          return { ok: false, error: mapped };
        }
      }).then((result) => {
        if (!result.ok && state.status === 'initializing' && result.error.code !== 'cancelled') {
          publish({ status: 'error', error: result.error }, revision);
        }
        return result;
      }).finally(() => {
        checking = null;
        if (eventPending) scheduleReconcile();
      });
      return checking;
    },
  };
  return service;
}
