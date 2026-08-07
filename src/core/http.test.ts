import { describe, expect, it } from 'vitest';
import { createJsonLoader } from './loader.js';
import { JsonError } from './errors.js';
import type { ScheduledWait, SourceMap } from './types.js';

/**
 * A fetch port controlled by the test: each call stays pending until `resolveNext`/`rejectNext`
 * releases it, letting a test drive genuine interleaving without elapsed time (J12.8). Honors
 * `init.signal` so a timeout's `AbortController.abort()` (D34) is observable the same way a
 * real fetch implementation would reject.
 */
function controllableFetch() {
  let calls = 0;
  const urls: string[] = [];
  const pending: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];

  const fetch = (url: string, init?: RequestInit): Promise<Response> => {
    calls++;
    urls.push(url);
    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  return {
    fetch,
    get calls() {
      return calls;
    },
    get urls() {
      return urls;
    },
    resolveNext(response: Response) {
      const next = pending.shift();
      if (!next) throw new Error('resolveNext: no pending fetch');
      next.resolve(response);
    },
    rejectNext(e: unknown) {
      const next = pending.shift();
      if (!next) throw new Error('rejectNext: no pending fetch');
      next.reject(e);
    },
  };
}

/** A minimal, fully-controllable stand-in for the fetch Response shape the pipeline reads. */
function fakeResponse(opts: { status?: number; body?: string; url?: string; contentLength?: string | null }): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: opts.url ?? '',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? (opts.contentLength ?? null) : null) },
    async text() {
      return opts.body ?? '';
    },
  } as unknown as Response;
}

/**
 * A schedule port controlled by the test: `fireOldest` releases the oldest wait still pending
 * (neither cancelled nor already fired), simulating elapsed time without any of it actually
 * elapsing (J12.8). `calls` records every requested duration for backoff/jitter assertions.
 */
function fakeSchedule() {
  const calls: number[] = [];
  const waits: Array<{ ms: number; fire: () => void; cancelled: boolean; fired: boolean }> = [];

  const schedule = (ms: number): ScheduledWait => {
    calls.push(ms);
    const w = { ms, fire: () => {}, cancelled: false, fired: false };
    const promise = new Promise<void>((res) => {
      w.fire = () => {
        w.fired = true;
        res();
      };
    });
    waits.push(w);
    return {
      promise,
      cancel() {
        w.cancelled = true;
      },
    };
  };

  return {
    schedule,
    get calls() {
      return calls.slice();
    },
    get pendingCount() {
      return waits.filter((w) => !w.cancelled && !w.fired).length;
    },
    fireOldest() {
      const w = waits.find((x) => !x.cancelled && !x.fired);
      if (!w) throw new Error('fireOldest: no pending wait');
      w.fire();
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const httpMap = (url: string, extra: Record<string, unknown> = {}): SourceMap => ({
  version: 1,
  sources: { a: { at: 'runtime', url, cache: 'manual', ...extra } as never },
});

describe('J12.1: an http entry resolves through the fetch port', () => {
  it('a 2xx JSON response resolves ok: true, provider http, attempts 1', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.loadById<{ v: number }>('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' }));
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ v: 1 });
      expect(r.meta.provider).toBe('http');
      expect(r.meta.attempts).toBe(1);
    }
  });

  it('a non-2xx response yields json.status', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 404 }));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.status');
    expect(f.calls).toBe(1);
  });

  it('a rejected fetch yields json.transport', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.loadById('a');
    await flush();
    f.rejectNext(new Error('network down'));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.transport');
  });

  it('a truncated or non-JSON 2xx body yields json.parse and is not retried', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 3, delayMs: 0 } }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: 'not json' }));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.parse');
    expect(f.calls).toBe(1);
  });

  it('meta.location records the location the bytes came from, not the location requested (I30, D37)', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}', url: 'https://cdn.example.test/a.json' }));
    const r = await p;
    expect(r.ok && r.meta.location).toBe('https://cdn.example.test/a.json');
  });
});

describe('J12.2: timeoutMs bounds each attempt, through the schedule port', () => {
  it('a timed-out attempt is aborted with AbortController and yields json.timeout', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { timeoutMs: 50 }), { fetch: f.fetch, schedule: sched.schedule });
    const p = loader.loadById('a');
    await flush();
    expect(sched.calls).toEqual([50]);
    sched.fireOldest();
    await flush();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.timeout');
  });

  it('the scheduled wait is cancelled when the attempt settles first (D23)', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { timeoutMs: 50 }), { fetch: f.fetch, schedule: sched.schedule });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' }));
    await p;
    expect(sched.pendingCount).toBe(0);
  });
});

describe('J12.3: retry applies only to json.transport, json.timeout, and 408/429/5xx', () => {
  it('retries a rejected fetch, waiting the declared delayMs, then succeeds', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 3, delayMs: 10 } }), {
      fetch: f.fetch,
      schedule: sched.schedule,
    });
    const p = loader.loadById<{ v: number }>('a');
    await flush();
    expect(f.calls).toBe(1);
    f.rejectNext(new Error('down'));
    await flush();
    expect(sched.calls.filter((ms) => ms === 10)).toHaveLength(1);
    sched.fireOldest();
    await flush();
    expect(f.calls).toBe(2);
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' }));
    const r = await p;
    expect(r.ok && r.data).toEqual({ v: 1 });
    expect(r.ok && r.meta.attempts).toBe(2);
  });

  it('retries a 503, and a 429, but never a plain 400', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 2, delayMs: 0 } }), {
      fetch: f.fetch,
      schedule: sched.schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 503 }));
    await flush();
    expect(f.calls).toBe(2);
    f.resolveNext(fakeResponse({ status: 200, body: '{}' }));
    const r = await p;
    expect(r.ok).toBe(true);

    const f2 = controllableFetch();
    const loader2 = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 2, delayMs: 0 } }), {
      fetch: f2.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p2 = loader2.loadById('a');
    await flush();
    f2.resolveNext(fakeResponse({ status: 400 }));
    const r2 = await p2;
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('json.status');
    expect(f2.calls).toBe(1);
  });

  it('exponential backoff doubles the delay on each successive retry', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(
      httpMap('https://example.test/a.json', { retry: { attempts: 3, delayMs: 10, backoff: 'exponential' } }),
      { fetch: f.fetch, schedule: sched.schedule },
    );
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 500 }));
    await flush();
    expect(sched.calls).toContain(10);
    sched.fireOldest();
    await flush();
    f.resolveNext(fakeResponse({ status: 500 }));
    await flush();
    expect(sched.calls).toContain(20);
    sched.fireOldest();
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{}' }));
    const r = await p;
    expect(r.ok && r.meta.attempts).toBe(3);
  });

  it('jitter draws only from the rng port', async () => {
    const f = controllableFetch();
    const sched = fakeSchedule();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 2, delayMs: 100, jitter: true } }), {
      fetch: f.fetch,
      schedule: sched.schedule,
      rng: () => 0.25,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 500 }));
    await flush();
    expect(sched.calls).toContain(25);
    sched.fireOldest();
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{}' }));
    await p;
  });
});

describe('J12.4: a body exceeding maxBytes yields json.tooLarge', () => {
  it('checked against Content-Length when present', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { maxBytes: 10 }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}', contentLength: '999' }));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.tooLarge');
  });

  it('checked against the decoded length always, even absent a Content-Length header', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { maxBytes: 5 }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"value":1}' }));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.tooLarge');
  });

  it('is not retried and writes nothing to the cache', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { maxBytes: 5, retry: { attempts: 3, delayMs: 0 } }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"value":1}' }));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(f.calls).toBe(1);
    expect(loader.stats().entries).toBe(0);
  });
});

describe('J12.5: preload resolves every id before failing, naming every failed id', () => {
  const twoSources: SourceMap = {
    version: 1,
    sources: {
      a: { at: 'runtime', url: 'https://example.test/a.json', cache: 'manual' },
      b: { at: 'runtime', url: 'https://example.test/b.json', cache: 'manual' },
    } as never,
  };

  it('writes the cache under each entry\'s declared policy, and rejects with JsonError(\'preload.failed\')', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(twoSources, { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.preload(['a', 'b']);
    await flush();
    f.resolveNext(fakeResponse({ status: 500 })); // a
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' })); // b
    let caught: JsonError | undefined;
    try {
      await p;
    } catch (e) {
      caught = e as JsonError;
    }
    expect(caught).toBeInstanceOf(JsonError);
    expect(caught?.code).toBe('preload.failed');
    expect(loader.stats().entries).toBe(1); // only b's success was cached
  });

  it('names every failed id, never only the first (I20)', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(twoSources, { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.preload(['a', 'b']);
    await flush();
    f.resolveNext(fakeResponse({ status: 500 }));
    f.resolveNext(fakeResponse({ status: 404 }));
    let caught: JsonError | undefined;
    try {
      await p;
    } catch (e) {
      caught = e as JsonError;
    }
    expect(caught?.failures.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('J12.6: a ttl entry preloaded at boot fails like any other expired entry once its window elapses', () => {
  it('issues a fresh transport rather than serving the stale entry', async () => {
    const f = controllableFetch();
    let now = 0;
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { cache: { ttlMs: 1000 } }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
      clock: () => now,
    });

    const boot = loader.preload(['a']);
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' }));
    await boot;
    expect(f.calls).toBe(1);
    expect(loader.stats().entries).toBe(1);

    now += 1000;
    const p2 = loader.loadById<{ v: number }>('a');
    await flush();
    expect(f.calls).toBe(2); // a fresh miss, not served from the expired entry
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":2}' }));
    const r2 = await p2;
    expect(r2.ok && r2.data).toEqual({ v: 2 });
    expect(r2.ok && !r2.meta.cached).toBe(true);
  });
});

describe('J12.8: invariant-removal coverage', () => {
  // I18 — retry applies only to json.transport, json.timeout, and 408/429/5xx.
  it('I18', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { retry: { attempts: 2, delayMs: 0 } }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 400 })); // never retried
    const r = await p;
    expect(r.ok).toBe(false);
    expect(f.calls).toBe(1);
  });

  // I20 — preload resolves every id before failing, and names every failed id.
  it('I20', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(
      {
        version: 1,
        sources: {
          a: { at: 'runtime', url: 'https://example.test/a.json', cache: 'manual' },
          b: { at: 'runtime', url: 'https://example.test/b.json', cache: 'manual' },
        } as never,
      },
      { fetch: f.fetch, schedule: fakeSchedule().schedule },
    );
    const p = loader.preload(['a', 'b']);
    await flush();
    f.resolveNext(fakeResponse({ status: 500 }));
    f.resolveNext(fakeResponse({ status: 500 }));
    let caught: JsonError | undefined;
    try {
      await p;
    } catch (e) {
      caught = e as JsonError;
    }
    expect(caught?.failures).toHaveLength(2);
  });

  // I27 — a body exceeding maxBytes yields json.tooLarge, is not retried, writes nothing.
  it('I27', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json', { maxBytes: 1, retry: { attempts: 2, delayMs: 0 } }), {
      fetch: f.fetch,
      schedule: fakeSchedule().schedule,
    });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}' }));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('json.tooLarge');
    expect(f.calls).toBe(1);
    expect(loader.stats().entries).toBe(0);
  });

  // I30 — meta.location records where the bytes came from, not the location requested.
  it('I30', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}', url: 'https://other.example.test/a.json' }));
    const r = await p;
    expect(r.ok && r.meta.location).toBe('https://other.example.test/a.json');
  });

  // D42 — a redirected source's cache lookup compares source identity, not the resolved
  // location I30 records: a second read of the same declared source hits the cache instead of
  // re-transporting and rewriting the entry it just wrote.
  it('D42', async () => {
    const f = controllableFetch();
    const loader = createJsonLoader(httpMap('https://example.test/a.json'), { fetch: f.fetch, schedule: fakeSchedule().schedule });
    const p1 = loader.loadById('a');
    await flush();
    f.resolveNext(fakeResponse({ status: 200, body: '{"v":1}', url: 'https://other.example.test/a.json' }));
    const r1 = await p1;
    expect(r1.ok && r1.meta.location).toBe('https://other.example.test/a.json');
    expect(f.calls).toBe(1);

    const p2 = loader.loadById('a');
    await flush();
    expect(f.calls).toBe(1); // hit the cache; did not re-transport
    const r2 = await p2;
    expect(r2.ok && r2.meta.cached).toBe(true);
    expect(r2.ok && r2.data).toEqual({ v: 1 });
  });
});
