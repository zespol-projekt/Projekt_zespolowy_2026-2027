import type { SupabaseClient, User } from '@supabase/supabase-js';
import { failure, mapAuthError } from './errors.ts';
import type { AuthActions, AuthResult, AuthState, AuthUser, SignInResult, SignupVerificationResult } from './types.ts';

type AuthClient = SupabaseClient['auth'];
export type AuthService = AuthActions & {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
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

export function createAuthService(getAuth: () => AuthClient | null): AuthService {
  let state: AuthState = { status: 'signedOut' };
  let revision = 0;
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();

  function publish(next: AuthState, operationRevision: number) {
    if (operationRevision !== revision) return;
    state = next;
    listeners.forEach((listener) => listener());
  }

  // SDK również zmienia własną sesję. Kolejka gwarantuje, że wylogowanie wykona
  // się po trwającym logowaniu, a spóźniona odpowiedź nie przywróci stanu UI.
  function run<T>(operation: (auth: AuthClient, operationRevision: number) => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
    const operationRevision = revision;
    const result = queue.then(async (): Promise<AuthResult<T>> => {
      if (operationRevision !== revision) return failure('cancelled');
      try {
        const auth = getAuth();
        if (!auth) return failure('configuration_error');
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
    return error ? { ok: false, error: mapAuthError(error) } : success();
  }

  function runSignedOut<T>(operation: (auth: AuthClient, current: number) => Promise<AuthResult<T>>) {
    return run((auth, current) => state.status === 'signedOut'
      ? operation(auth, current)
      : Promise.resolve(failure('cancelled', 'Najpierw zakończ bieżącą sesję lub odzyskiwanie hasła.')));
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
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
        publish({ status: 'signedIn', user }, current);
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
        publish({ status: 'signedIn', user }, current);
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
            publish({ status: 'signedOut' }, current);
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

    retrySession() {
      return run(async (auth, current) => {
        const previous = state;
        try {
          const { data, error } = await auth.getSession();
          if (error) throw error;
          if (!data.session) {
            publish({ status: 'signedOut' }, current);
            return success();
          }
          const checked = await auth.getUser(data.session.access_token);
          if (checked.error) throw checked.error;
          const user = confirmedUser(checked.data.user);
          if (!user) {
            await closeSession(auth, current);
            return failure('session_expired');
          }
          // Ponowienie nie może zamienić sesji odzyskiwania w zwykłe logowanie.
          publish(previous.status === 'recovery' ? previous : { status: 'signedIn', user }, current);
          return success();
        } catch (error) {
          const mapped = mapAuthError(error);
          if (previous.status !== 'recovery') publish({ status: 'error', error: mapped }, current);
          return { ok: false, error: mapped };
        }
      });
    },
  };
}
