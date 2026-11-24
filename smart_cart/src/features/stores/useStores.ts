import { useEffect, useState, useSyncExternalStore } from 'react';
import { authService } from '../auth/instance';
import { CatalogError, fetchCatalog, type CatalogCache } from './fetchCatalog';
import type { Catalog } from './model';

function storesUrl() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) return new URL('/functions/v1/store-catalog', supabaseUrl).toString();
  throw new Error('Nie skonfigurowano źródła danych.');
}

// Keep the parsed catalog between visits within the same authenticated session.
const catalogCache: { sessionKey: string | null; value: CatalogCache } = {
  sessionKey: null, value: null,
};

export function useStores() {
  const authState = useSyncExternalStore(authService.subscribe, authService.getState, authService.getState);
  const sessionKey = useSyncExternalStore(authService.subscribe, authService.getSessionKey, authService.getSessionKey);
  const [result, setResult] = useState<{
    sessionKey: string | null; catalog: Catalog | null; loading: boolean; error: string | null;
  }>({ sessionKey: null, catalog: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  // Wspólna, zliczana subskrypcja działa również przed podłączeniem AuthProvider przez UI.
  useEffect(() => authService.start(), []);
  useEffect(() => authService.subscribe(() => {
    if (catalogCache.sessionKey !== authService.getSessionKey()) catalogCache.value = null;
  }), []);
  useEffect(() => {
    if (!sessionKey) {
      // Clear cached catalog on logout; render also guards the session key.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ sessionKey: null, catalog: null, loading: false, error: null });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setResult({ sessionKey, catalog: null, loading: true, error: null });
    (async () => {
      try {
        const url = storesUrl();
        const publishCache = (value: CatalogCache) => {
          if (!active || authService.getSessionKey() !== sessionKey) return;
          catalogCache.sessionKey = sessionKey;
          catalogCache.value = value;
        };
        const cached = catalogCache.sessionKey === sessionKey ? catalogCache.value : null;
        const catalog = await fetchCatalog(url, authService, controller.signal, fetch, cached, publishCache);
        if (active) setResult({ sessionKey, catalog, loading: false, error: null });
      } catch (error) {
        if (active) setResult({ sessionKey, catalog: null, loading: false,
          error: error instanceof CatalogError ? error.message : 'Nie można połączyć się z serwerem sklepów. Sprawdź połączenie i spróbuj ponownie.' });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [attempt, sessionKey]);
  const current = sessionKey !== null && result.sessionKey === sessionKey;
  return {
    // Ukryj poprzednie dane już przy renderze zmiany sesji, przed sprzątaniem efektu.
    catalog: current ? result.catalog : null,
    loading: authState.status === 'initializing' || (sessionKey !== null && (!current || result.loading)),
    error: sessionKey ? (current ? result.error : null)
      : authState.status === 'error' ? authState.error.message : 'Zaloguj się, aby wyświetlić sklepy.',
    retry: () => {
      if (!sessionKey) void authService.retrySession();
      setAttempt(n => n + 1);
    },
  };
}
