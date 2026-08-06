// Fake ports. Nothing here touches a network or a real clock.
//
// Ambient calls (setTimeout, Date) are legitimate in this file and nowhere else: ports are
// exactly where the environment is allowed to enter. That split is the isomorphism claim in
// 10-design.md §2, exercised rather than asserted.

/**
 * A programmable fetch port.
 * routes: { [url]: response | (init, callNumber) => response }
 * A response is { status?, body?, delayMs?, throws?, redirectTo? }.
 */
export function fakeFetch(routes) {
  const calls = [];
  let inflight = 0, peakInflight = 0;

  const port = async (url, init) => {
    calls.push({ url, init });
    inflight++;
    peakInflight = Math.max(peakInflight, inflight);
    try {
      const route = routes[url];
      const spec = typeof route === 'function'
        ? route(init, calls.filter((c) => c.url === url).length)
        : route;
      if (!spec) throw Object.assign(new Error(`ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' });
      if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
      if (spec.throws) throw Object.assign(new Error(spec.throws), { code: 'ECONNREFUSED' });

      // A redirect is followed the way a spec-compliant fetch follows one: the init the
      // caller supplied, headers included, is reused against the new origin.
      if (spec.redirectTo) {
        const next = routes[spec.redirectTo];
        calls.push({ url: spec.redirectTo, init, viaRedirect: true });
        const body = typeof next?.body === 'string' ? next.body : JSON.stringify(next?.body ?? null);
        return { ok: true, status: next?.status ?? 200, text: async () => body };
      }

      const status = spec.status ?? 200;
      const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? null);
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    } finally {
      inflight--;
    }
  };

  port.calls = calls;
  port.peak = () => peakInflight;
  return port;
}

/**
 * A programmable filesystem port.
 * files: { [path]: { body, mtimeMs, size? } }
 */
export function fakeFs(files) {
  const watchers = [];
  let openPeak = 0, open = 0;

  let failStat = false;

  const statSync = (path) => {
    if (failStat) return undefined;
    const f = files[path];
    return f ? { mtimeMs: f.mtimeMs, size: f.size ?? f.body.length } : undefined;
  };

  return {
    __failStat(on) { failStat = on; },
    async read(path) {
      const f = files[path];
      if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      open++; openPeak = Math.max(openPeak, open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return f.body;
    },
    async stat(path) {
      if (failStat) throw Object.assign(new Error(`EIO: stat failed on ${path}`), { code: 'EIO' });
      const s = statSync(path);
      if (!s) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return s;
    },
    watch(path, onChange) {
      const w = { path, onChange, active: true };
      watchers.push(w);
      return () => { w.active = false; };
    },
    __statSync: statSync,
    __watchers: watchers,
    __openPeak: () => openPeak,
    /** Rewrite a file in place, optionally keeping mtime and size identical. */
    __write(path, body, { mtimeMs } = {}) {
      const prev = files[path];
      files[path] = { body, mtimeMs: mtimeMs ?? prev?.mtimeMs ?? 0, size: undefined };
      for (const w of watchers) if (w.active && w.path === path) w.onChange();
    },
  };
}

/** A clock the test advances by hand. */
export function fakeClock(start = 0) {
  let now = start;
  const port = () => now;
  port.advance = (ms) => { now += ms; };
  return port;
}

/** A deterministic rng. */
export function fakeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The scheduling port 10-design.md §7 Q1 says the contract does not have. */
export const realSchedule = (ms) => new Promise((r) => setTimeout(r, ms));

export function recordingLog() {
  const events = [];
  const port = (e) => events.push(e);
  port.events = events;
  return port;
}
