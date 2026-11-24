import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeafletImage } from './model';
import { fetchPage, LeafletPageAccessError } from './transport';

// Covers and reader pages share the same validated, credential-free image transport.
export function useLeafletImage(page: LeafletImage, ready: boolean, refreshCatalog: () => void) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ page: LeafletImage; attempt: number; uri?: string; error?: string; expired?: boolean } | null>(null);
  const refreshed = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void fetchPage(page, controller.signal).then(uri => {
      if (controller.signal.aborted) return;
      refreshed.current = false;
      setResult({ page, attempt, uri });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const expired = error instanceof LeafletPageAccessError;
      if (expired && !refreshed.current) {
        refreshed.current = true;
        refreshCatalog();
        return;
      }
      setResult({ page, attempt, expired, error: error instanceof Error ? error.message : 'Nie udało się wczytać obrazu gazetki.' });
    });
    return () => controller.abort();
  }, [page, attempt, ready, refreshCatalog]);
  const current = ready && result?.page === page && result.attempt === attempt ? result : null;
  const reportError = useCallback(() => setResult({ page, attempt, error: 'Plik jest uszkodzony lub nieobsługiwany. Spróbuj ponownie.' }), [page, attempt]);
  return { current, reportError, retry: () => setAttempt(n => n + 1) };
}
