import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DependencyList } from 'react';
import { authService } from '../auth/instance';
import { DataError } from './client';

export function useSessionKey() { return useSyncExternalStore(authService.subscribe, authService.getSessionKey, () => null); }
export function useSessionQuery<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: DependencyList) {
  const key = useSessionKey();
  const scope = `${key}:${JSON.stringify(dependencies)}`;
  const loader = useRef(load);
  useLayoutEffect(() => { loader.current = load; });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope?: string; attempt: number; data?: T; error: string | null }>({ attempt: -1, error: null });
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const valid = () => !controller.signal.aborted && authService.getSessionKey() === key;
    void loader.current(controller.signal).then(data => {
      if (valid()) setResult({ scope, attempt, data, error: null });
    }).catch((error: unknown) => {
      if (valid()) setResult(previous => ({ scope, attempt, data: previous.scope === scope ? previous.data : undefined,
        error: error instanceof Error ? error.message : 'Nie udało się pobrać danych.' }));
    });
    return () => controller.abort();
    // Serialized parameters identify the query, independently of callback identity.
  }, [key, attempt, scope]);
  const current = key !== null && scope === result.scope;
  return { data: current ? result.data : undefined, loading: key !== null && (!current || result.attempt !== attempt), error: current && result.attempt === attempt ? result.error : null, reload };
}
export function useSessionAction() {
  const key = useSessionKey();
  const [status, setStatus] = useState<{ key: string | null; busy: boolean; message: string | null }>({ key: null, busy: false, message: null });
  const setMessage = (message: string | null) => setStatus(previous => ({ ...previous, key, message }));
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    pending.current = false;
    return () => { controller.current?.abort(); };
  }, [key]);
  async function run<T>(action: (signal: AbortSignal) => Promise<T>, done?: (result: T) => void) {
    if (pending.current || !key) return;
    const request = new AbortController(); controller.current = request;
    pending.current = true; setStatus({ key, busy: true, message: null });
    const valid = () => !request.signal.aborted && authService.getSessionKey() === key;
    try {
      const result = await action(request.signal);
      if (valid()) done?.(result);
    } catch (error) {
      if (valid()) setMessage(error instanceof DataError || error instanceof Error ? error.message : 'Nie udało się zapisać danych.');
    } finally {
      if (valid()) { pending.current = false; setStatus(previous => ({ ...previous, busy: false })); }
    }
  }
  return { busy: status.key === key && status.busy, message: status.key === key ? status.message : null, run, setMessage };
}

export function useDebounced(value: string, delay = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setResult(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return result;
}
