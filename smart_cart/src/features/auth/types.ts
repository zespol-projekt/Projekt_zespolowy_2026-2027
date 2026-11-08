export type AuthUser = {
  id: string;
  email: string;
};

// Kody aplikacji; implementacja mapuje na nie błędy Supabase.
export type AuthErrorCode =
  | 'invalid_email'
  | 'invalid_credentials'
  | 'weak_password'
  | 'invalid_or_expired_code'
  | 'rate_limited'
  | 'session_expired'
  | 'network_error'
  | 'service_unavailable'
  | 'configuration_error'
  | 'cancelled'
  | 'unknown';

export type AuthError = {
  code: AuthErrorCode;
  /** Bezpieczny komunikat po polsku, bez surowej odpowiedzi Supabase. */
  message: string;
  /** Tylko jeśli serwer podał czas oczekiwania. */
  retryAfterSeconds?: number;
};

export type AuthResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };

// Wyłącznie signedIn uprawnia UI do otwarcia chronionych ekranów.
export type AuthState =
  | { status: 'initializing' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'recovery'; phase: 'verifyingCode' | 'settingPassword' }
  | { status: 'error'; error: AuthError };

export type SignupPending = { status: 'confirmationRequired'; email: string };
export type SignInResult = { status: 'signedIn' } | SignupPending;
export type SignupVerificationResult =
  | { status: 'signedIn' }
  | { status: 'signInRequired' };

export interface AuthActions {
  signUp(email: string, password: string): Promise<AuthResult<SignupPending>>;
  verifySignupCode(email: string, code: string): Promise<AuthResult<SignupVerificationResult>>;
  resendSignupCode(email: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult<SignInResult>>;
  sendPasswordResetCode(email: string): Promise<AuthResult>;
  verifyPasswordResetCode(email: string, code: string): Promise<AuthResult>;
  setNewPassword(password: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  retrySession(): Promise<AuthResult>;
}

/** Docelowy wynik useAuth(); tokeny nie należą do kontraktu formularzy. */
export type AuthContextValue = AuthActions & { state: AuthState };

/** Wewnętrzny kontrakt dla pobierania danych, nie dla ekranów ani mapy. */
export interface AuthSessionAccess {
  getAccessToken(): Promise<AuthResult<string>>;
  refreshAfterUnauthorized(rejectedToken: string): Promise<AuthResult<string>>;
  invalidateSession(rejectedToken: string): Promise<AuthResult>;
}
