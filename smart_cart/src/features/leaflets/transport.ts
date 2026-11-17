import type { AuthSessionAccess } from '../auth/types.ts';
import { LeafletError, parseLeaflets, resourceUrl, type LeafletImage } from './model.ts';

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) throw new LeafletError('Plik gazetki jest zbyt duży.');
  // WWW supports streaming; native fetch can fall back to a bounded server response.
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maximum) throw new LeafletError('Plik gazetki jest zbyt duży.');
    return bytes;
  }
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new LeafletError('Plik gazetki jest zbyt duży.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function checkResponse(response: Response) {
  if (response.status === 401 || response.status === 403) throw new LeafletError('Dostęp do gazetki wygasł lub został odmówiony. Odśwież gazetki i spróbuj ponownie.');
  if (response.status === 404 || response.status === 410) throw new LeafletError('Ta gazetka lub strona nie jest już dostępna.');
  if (!response.ok) throw new LeafletError('Serwer gazetek jest chwilowo niedostępny. Spróbuj ponownie.');
}
async function withTimeout<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>, timeout: number): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timer = setTimeout(abort, timeout);
  let rejectAbort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new LeafletError('Pobieranie przerwane lub przekroczono czas oczekiwania. Spróbuj ponownie.'));
    controller.signal.addEventListener('abort', rejectAbort);
  });
  try {
    if (signal.aborted) controller.abort();
    if (controller.signal.aborted) return await cancelled;
    return await Promise.race([action(controller.signal), cancelled]);
  } catch (error) {
    if (error instanceof LeafletError) throw error;
    throw new LeafletError('Nie udało się pobrać gazetki. Sprawdź połączenie i spróbuj ponownie.');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); }
}
export async function fetchLeaflets(endpoint: string | undefined, projectUrl: string | undefined, auth: AuthSessionAccess, signal: AbortSignal, request = fetch) {
  if (!endpoint) throw new LeafletError('Gazetki nie są jeszcze dostępne. Czekamy na udostępnienie materiałów.');
  const url = resourceUrl(endpoint);
  if (!projectUrl || new URL(url).origin !== new URL(projectUrl).origin) throw new LeafletError('Źródło gazetek wymaga konfiguracji przez zespół projektu.');
  const key = auth.getSessionKey();
  if (!key) throw new LeafletError('Zaloguj się, aby przeglądać gazetki.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort); if (signal.aborted) abort();
  const unsubscribe = auth.subscribe(() => { if (auth.getSessionKey() !== key) abort(); });
  const guard = () => { if (controller.signal.aborted || auth.getSessionKey() !== key) throw new LeafletError('Pobieranie przerwane.'); };
  try {
    return await withTimeout(controller.signal, async inner => {
      const initial = await auth.getAccessToken(); guard(); if (inner.aborted) throw new LeafletError('Pobieranie przerwane.');
      if (!initial.ok) throw new LeafletError(initial.error.message);
      let token = initial.data;
      const send = () => request(url, { signal: inner, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      let response = await send(); guard();
      if (response.status === 401) {
        const refreshed = await auth.refreshAfterUnauthorized(token); guard(); if (inner.aborted) throw new LeafletError('Pobieranie przerwane.');
        if (!refreshed.ok) throw new LeafletError(refreshed.error.message);
        token = refreshed.data; response = await send(); guard();
        if (response.status === 401) await auth.invalidateSession(token);
      }
      checkResponse(response);
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new LeafletError('Serwer nie zwrócił katalogu gazetek.');
      const bytes = await boundedBytes(response, 1024 * 1024); guard();
      return parseLeaflets(JSON.parse(new TextDecoder().decode(bytes)));
    }, 15000);
  } finally { unsubscribe(); signal.removeEventListener('abort', abort); }
}
export async function fetchPage(image: LeafletImage, signal: AbortSignal, request = fetch, timeout = 15000): Promise<string> {
  return withTimeout(signal, async inner => {
    // Resources never receive the application's bearer token, apikey or cookies.
    const response = await request(resourceUrl(image.url), { signal: inner, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: image.mimeType } });
    checkResponse(response);
    const mime = response.headers.get('content-type')?.split(';')[0].trim();
    if (mime !== image.mimeType) throw new LeafletError('Serwer zwrócił inny format zamiast obrazu strony.');
    const bytes = await boundedBytes(response, 8 * 1024 * 1024);
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    const valid = mime === 'image/png' ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
      : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (!valid) throw new LeafletError('Plik nie jest prawidłowym obrazem strony gazetki.');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
  }, timeout);
}
