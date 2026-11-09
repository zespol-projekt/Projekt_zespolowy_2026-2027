import Constants from 'expo-constants';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { authService } from '../auth/instance';
import { fetchCatalog } from './fetchCatalog';
import type { Catalog } from './model';

function storesUrl() {
  const configured = process.env.EXPO_PUBLIC_STORES_API_URL;
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && !(__DEV__ && url.protocol === 'http:')) {
      throw new Error('API sklepów wymaga HTTPS poza trybem deweloperskim.');
    }
    return url.toString();
  }
  if (__DEV__) {
    // Expo Go zna adres komputera z Metro; przeglądarka korzysta ze swojego hosta.
    const host = typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : new URL(`http://${Constants.expoConfig?.hostUri ?? 'localhost:8081'}`).hostname;
    return `http://${host.includes(':') ? `[${host}]` : host}:8787/v1/stores`;
  }
  throw new Error('Nie skonfigurowano źródła danych.');
}

export function useStores() {
  const authState = useSyncExternalStore(authService.subscribe, authService.getState, authService.getState);
  const sessionKey = useSyncExternalStore(authService.subscribe, authService.getSessionKey, authService.getSessionKey);
  const [result, setResult] = useState<{
    sessionKey: string | null; catalog: Catalog | null; loading: boolean; error: string | null;
  }>({ sessionKey: null, catalog: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  // Wspólna, zliczana subskrypcja działa również przed podłączeniem AuthProvider przez UI.
  useEffect(() => authService.start(), []);
  useEffect(() => {
    if (!sessionKey) {
      setResult({ sessionKey: null, catalog: null, loading: false, error: null });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setResult({ sessionKey, catalog: null, loading: true, error: null });
    (async () => {
      try {
        const catalog = await fetchCatalog(storesUrl(), authService, controller.signal);
        if (active) setResult({ sessionKey, catalog, loading: false, error: null });
      } catch {
        if (active) setResult({ sessionKey, catalog: null, loading: false,
          error: 'Nie udało się pobrać sklepów. Sprawdź połączenie i spróbuj ponownie.' });
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
