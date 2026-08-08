// Real-shaped port adapters for J12.9.
//
// The real core's `fetch` and `schedule` ports carry more structure than
// harness/fakes.mjs's `fakeFetch` and `realSchedule` provide: `20-contract.md` §4 types
// `fetch` as `(url, init) => Promise<Response>` (so a caller can read `.headers` and `.url`)
// and `schedule` as `(ms) => ScheduledWait` — a `{ promise, cancel() }` pair, not a bare
// Promise (D34, J12.2). `fakeFs`, `fakeClock`, `fakeRng`, and `recordingLog` from
// harness/fakes.mjs are unchanged and already match the real `FileSystemPort` and friends,
// so probes-real.mjs imports those directly rather than duplicating them here.

/**
 * A programmable fetch port shaped like the real `JsonPorts.fetch` (Response-like: `ok`,
 * `status`, `url`, `headers.get()`, `text()`). Same `routes` shape as `fakeFetch`.
 */
export function fakeFetchReal(routes) {
  const calls = [];

  const port = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    const spec =
      typeof route === 'function' ? route(init, calls.filter((c) => c.url === url).length) : route;
    if (!spec) throw Object.assign(new Error(`ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' });
    if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
    if (spec.throws) throw Object.assign(new Error(spec.throws), { code: 'ECONNREFUSED' });

    if (spec.redirectTo) {
      const next = routes[spec.redirectTo];
      calls.push({ url: spec.redirectTo, init, viaRedirect: true });
      const body = typeof next?.body === 'string' ? next.body : JSON.stringify(next?.body ?? null);
      return makeResponse({ status: next?.status ?? 200, url: spec.redirectTo, body, contentLength: next?.contentLength });
    }

    const status = spec.status ?? 200;
    const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? null);
    return makeResponse({ status, url, body, contentLength: spec.contentLength });
  };

  port.calls = calls;
  return port;
}

function makeResponse({ status, url, body, contentLength }) {
  const headers = new Map();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => (headers.has(name.toLowerCase()) ? headers.get(name.toLowerCase()) : null) },
    text: async () => body,
  };
}

/** The real `schedule` port: `(ms) => { promise, cancel() }` (§4 `ScheduledWait`). */
export function realScheduledWait(ms) {
  let id;
  const promise = new Promise((resolve) => {
    id = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(id) };
}
