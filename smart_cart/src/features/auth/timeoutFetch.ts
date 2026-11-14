/** Bound SDK requests, including response bodies; the SDK handles retry policy. */
export function createTimeoutFetch(request: typeof fetch = fetch, milliseconds = 20000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstream = init?.signal;
    const abort = () => controller.abort();
    upstream?.addEventListener('abort', abort);
    if (upstream?.aborted) abort();
    const timer = setTimeout(abort, milliseconds);
    try {
      const response = await request(input, { ...init, signal: controller.signal });
      // Supabase Auth uses small JSON bodies. Read them while the deadline is active.
      const body = response.status === 204 || response.status === 205 || response.status === 304 ? null : await response.text();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timer); upstream?.removeEventListener('abort', abort);
    }
  };
}
