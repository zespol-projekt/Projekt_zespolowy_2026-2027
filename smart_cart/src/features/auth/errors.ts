import type { AuthError, AuthErrorCode, AuthResult } from './types.ts';

const messages: Record<AuthErrorCode, string> = {
  invalid_email: 'Podaj poprawny adres email.',
  invalid_credentials: 'Nieprawidłowy email lub hasło.',
  weak_password: 'Hasło musi mieć co najmniej 8 znaków.',
  invalid_or_expired_code: 'Kod jest nieprawidłowy lub wygasł. Sprawdź najnowszą wiadomość albo wyślij nowy kod.',
  rate_limited: 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.',
  session_expired: 'Sesja wygasła. Zaloguj się ponownie lub ponów odzyskiwanie hasła.',
  network_error: 'Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.',
  service_unavailable: 'Usługa jest chwilowo niedostępna. Spróbuj ponownie później.',
  configuration_error: 'Konfiguracja logowania jest nieprawidłowa. Skontaktuj się z zespołem projektu.',
  cancelled: 'Operacja została anulowana.',
  unknown: 'Nie udało się wykonać operacji. Spróbuj ponownie.',
};

export function failure(code: AuthErrorCode, message = messages[code]): AuthResult<never> {
  return { ok: false, error: { code, message } };
}

export function mapAuthError(error: unknown): AuthError {
  const value = error && typeof error === 'object' ? error : {};
  const code = 'code' in value ? value.code : undefined;
  const status = 'status' in value ? value.status : undefined;
  const name = 'name' in value ? value.name : undefined;
  let mapped: AuthErrorCode = 'unknown';

  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    mapped = 'rate_limited';
  } else if (typeof status === 'number' && status >= 500) {
    mapped = 'service_unavailable';
  } else if (name === 'AuthRetryableFetchError' || name === 'TypeError') {
    mapped = 'network_error';
  } else if (code === 'invalid_credentials') {
    mapped = 'invalid_credentials';
  } else if (code === 'email_address_invalid') {
    mapped = 'invalid_email';
  } else if (code === 'weak_password' || code === 'same_password') {
    mapped = 'weak_password';
  } else if (code === 'otp_expired' || code === 'otp_disabled') {
    mapped = 'invalid_or_expired_code';
  } else if (code === 'session_expired' || code === 'session_not_found' || code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' || name === 'AuthSessionMissingError') {
    mapped = 'session_expired';
  } else if (code === 'signup_disabled' || code === 'email_provider_disabled' || code === 'email_address_not_authorized') {
    mapped = 'configuration_error';
  }

  return {
    code: mapped,
    message: code === 'same_password' ? 'Nowe hasło musi różnić się od poprzedniego.' : messages[mapped],
  };
}
