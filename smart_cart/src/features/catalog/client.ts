import type { AuthSessionAccess } from '../auth/types.ts';

export class DataError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'DataError'; this.code = code; }
}
const errorMessages: Record<string, string> = {
  '42501': 'Brak dostępu. Zaloguj się potwierdzonym kontem.',
  '23505': 'Taka pozycja już istnieje. Odśwież listę.',
  '23503': 'Produkt lub lista zostały zmienione. Odśwież dane.',
  '23514': 'Sprawdź nazwę, ilość i jednostkę produktu.',
  '22023': 'Sprawdź ilość, jednostkę i wybrany produkt. Spróbuj mniejszej ilości lub konkretnego opakowania.',
  '42P01': 'Moduł produktów i list wymaga aktualizacji bazy. Skontaktuj się z zespołem projektu.',
  'PGRST202': 'Moduł porównania wymaga aktualizacji bazy. Skontaktuj się z zespołem projektu.',
  'PGRST205': 'Moduł produktów i list wymaga aktualizacji bazy. Skontaktuj się z zespołem projektu.',
  '57014': 'Obliczenia trwały zbyt długo. Wybierz konkretny produkt lub zmniejsz ilość.',
};
export function createDataClient({ url, key, auth, request = fetch, timeout = 30000 }: {
  url: string | undefined; key: string | undefined; auth: AuthSessionAccess; request?: typeof fetch; timeout?: number;
}) {
  return async function call<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    if (!url || !key) throw new DataError('configuration', 'Nie skonfigurowano połączenia z katalogiem produktów.');
    const session = auth.getSessionKey();
    if (!session) throw new DataError('session', 'Zaloguj się, aby korzystać z produktów i list.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort);
    if (options.signal?.aborted) abort();
    const unsubscribe = auth.subscribe(() => { if (auth.getSessionKey() !== session) abort(); });
    const timer = setTimeout(abort, timeout);
    const guard = () => {
      if (controller.signal.aborted || auth.getSessionKey() !== session) throw new DataError('cancelled', 'Operacja została przerwana.');
    };
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new DataError('cancelled', 'Operacja została przerwana lub przekroczono czas oczekiwania.')); controller.signal.addEventListener('abort', rejectAbort); });
    try {
      const work = async () => {
        guard();
        const initial = await auth.getAccessToken(); guard();
        if (!initial.ok) throw new DataError(initial.error.code, initial.error.message);
        let token = initial.data;
        const send = () => request(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
          method: options.method ?? 'GET', signal: controller.signal, cache: 'no-store', redirect: 'error',
          headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
        let response = await send(); guard();
        if (response.status === 401) {
          const refreshed = await auth.refreshAfterUnauthorized(token); guard();
          if (!refreshed.ok) throw new DataError(refreshed.error.code, refreshed.error.message);
          token = refreshed.data; response = await send(); guard();
          if (response.status === 401) { await auth.invalidateSession(token); throw new DataError('session', 'Sesja wygasła. Zaloguj się ponownie.'); }
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({})); guard();
          const code = typeof data.code === 'string' ? data.code : String(response.status);
          throw new DataError(code, errorMessages[code] ?? (response.status === 403 ? errorMessages['42501'] : 'Nie udało się pobrać lub zapisać danych. Spróbuj ponownie.'));
        }
        const result = response.status === 204 ? undefined : await response.json(); guard();
        return result as T;
      };
      return await Promise.race([work(), aborted]);
    } catch (error) {
      if (error instanceof DataError) throw error;
      throw new DataError('network', 'Nie udało się połączyć z bazą. Sprawdź połączenie i spróbuj ponownie.');
    } finally {
      clearTimeout(timer); unsubscribe(); options.signal?.removeEventListener('abort', abort);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    }
  };
}
