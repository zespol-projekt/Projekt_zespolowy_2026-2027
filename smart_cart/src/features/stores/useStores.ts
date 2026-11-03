import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { parseCatalog, type Catalog } from './model';

function storesUrl() {
  const configured = process.env.EXPO_PUBLIC_STORES_API_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Nieprawidłowy adres danych.');
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
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    setLoading(true); setError(null);
    (async () => {
      try {
        const response = await fetch(storesUrl(), { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = parseCatalog(await response.json());
        if (active) setCatalog(result);
      } catch {
        if (active) setError('Nie udało się pobrać sklepów. Sprawdź połączenie i spróbuj ponownie.');
      } finally {
        clearTimeout(timer);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  return { catalog, loading, error, retry: () => setAttempt(n => n + 1) };
}
