import type { AuthSessionAccess } from '../auth/types.ts';
import { parseCatalog, type Catalog } from './model.ts';

type StoresAuth = AuthSessionAccess & {
  getSessionKey(): string | null;
  subscribe(listener: () => void): () => void;
};

/** Jeden katalog, maksymalnie jedno ponowienie po 401, wyłącznie w tej samej sesji. */
export async function fetchCatalog(
  url: string,
  auth: StoresAuth,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Catalog> {
  const sessionKey = auth.getSessionKey();
  if (!sessionKey) throw new Error('Zaloguj się, aby pobrać sklepy.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const guard = () => {
    if (controller.signal.aborted || auth.getSessionKey() !== sessionKey) {
      throw new Error('Pobieranie zostało przerwane.');
    }
  };
  signal.addEventListener('abort', abort);
  if (signal.aborted) abort();
  const unsubscribe = auth.subscribe(() => {
    if (auth.getSessionKey() !== sessionKey) abort();
  });
  const timer = setTimeout(abort, 15000);
  let rejectAborted: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(new Error('Pobieranie zostało przerwane.'));
    controller.signal.addEventListener('abort', rejectAborted);
  });
  try {
    guard();
    const load = async () => {
      const initial = await auth.getAccessToken();
      guard();
      if (!initial.ok) throw new Error(initial.error.message);
      let token = initial.data;
      const send = () => request(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
      });
      let response = await send();
      guard();
      if (response.status === 401) {
        const refreshed = await auth.refreshAfterUnauthorized(token);
        guard();
        if (!refreshed.ok) throw new Error(refreshed.error.message);
        token = refreshed.data;
        response = await send();
        guard();
        if (response.status === 401) {
          await auth.invalidateSession(token);
          throw new Error('Sesja wygasła. Zaloguj się ponownie.');
        }
      }
      if (response.status === 403) throw new Error('To konto nie ma dostępu do sklepów.');
      if (!response.ok) throw new Error('Nie udało się pobrać sklepów. Spróbuj ponownie.');
      const catalog = parseCatalog(await response.json());
      guard();
      return catalog;
    };
    // Timeout i wylogowanie przerywają także oczekiwanie na odnowienie sesji.
    return await Promise.race([load(), aborted]);
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAborted);
  }
}
