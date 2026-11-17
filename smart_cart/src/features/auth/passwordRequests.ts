/** Bind the existing SDK's password request to its UI/session lifetime.
 * Aborting cannot undo a server-side write, but prevents a late SDK response
 * from saving an old session or broadcasting USER_UPDATED for that session.
 */
export function createPasswordRequests(request: typeof fetch) {
  let active: AbortSignal | undefined;
  const check = (signal?: AbortSignal) => {
    if (signal?.aborted) { const error = new Error('Cancelled password request'); error.name = 'AbortError'; throw error; }
  };
  return {
    fetch: (async (input, init) => {
      const signal = active;
      if (!signal || init?.method?.toUpperCase() !== 'PUT') return request(input, init);
      check(signal);
      const response = await request(input, { ...init, signal });
      check(signal);
      // Read before passing to the SDK so invalidation during the body is covered.
      const body = await response.text(); check(signal);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }) as typeof fetch,
    async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
      if (active) throw new Error('Password request already active');
      active = signal;
      try { check(signal); return await operation(); }
      finally { active = undefined; }
    },
  };
}
