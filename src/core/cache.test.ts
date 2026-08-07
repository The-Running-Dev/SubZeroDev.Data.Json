import { describe, expect, it, vi } from 'vitest';
import { createJsonLoader } from './loader.js';
import { createMemoryCacheStore } from './cache.js';
import type { CacheStore, FileCacheSpec, FileSystemPort, SourceMap } from './types.js';

/** A fake FileSystemPort over an in-memory file table, with call counting for J10 tests. */
function fakeFs(initial: Record<string, { text: string; mtimeMs: number; size?: number }>) {
  const files = new Map(Object.entries(initial));
  let reads = 0;
  let stats = 0;
  const watchers = new Map<string, Set<() => void>>();

  const fs: FileSystemPort = {
    async read(path: string) {
      reads++;
      const f = files.get(path);
      if (!f) {
        const err = new Error(`ENOENT: no such file, open '${path}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return f.text;
    },
    async stat(path: string) {
      stats++;
      const f = files.get(path);
      if (!f) {
        const err = new Error(`ENOENT: no such file, stat '${path}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: f.mtimeMs, size: f.size ?? new TextEncoder().encode(f.text).length };
    },
    watch(path: string, onChange: () => void) {
      let set = watchers.get(path);
      if (!set) {
        set = new Set();
        watchers.set(path, set);
      }
      set.add(onChange);
      return () => {
        set!.delete(onChange);
      };
    },
  };

  return {
    fs,
    write(path: string, text: string, mtimeMs: number) {
      files.set(path, { text, mtimeMs });
    },
    remove(path: string) {
      files.delete(path);
    },
    fireWatch(path: string) {
      for (const cb of watchers.get(path) ?? []) cb();
    },
    get reads() {
      return reads;
    },
    get stats() {
      return stats;
    },
    get watcherCount() {
      let n = 0;
      for (const set of watchers.values()) n += set.size;
      return n;
    },
  };
}

function fakeClock(startMs: number) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const fileMap = (path: string, cache: FileCacheSpec, extra: Record<string, unknown> = {}): SourceMap => ({
  version: 1,
  sources: { a: { at: 'runtime', path, cache, ...extra } as never },
});

describe('J10.1: file entries resolve through FileSystemPort', () => {
  it('a path that does not exist yields json.notFound and is not retried', async () => {
    const { fs } = fakeFs({});
    const loader = createJsonLoader(fileMap('/missing.json', 'manual'), { fs });
    const result = await loader.loadById('a');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('json.notFound');
      expect(result.meta.attempts).toBe(1);
    }
  });

  it('a permission/IO failure yields json.transport', async () => {
    const fs: FileSystemPort = {
      read: async () => {
        throw new Error('EACCES: permission denied');
      },
      stat: async () => ({ mtimeMs: 1, size: 1 }),
    };
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs });
    const result = await loader.loadById('a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('json.transport');
  });

  it('meta.bytes is the UTF-8 byte length as read and meta.location is the path', async () => {
    const { fs } = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs });
    const result = await loader.loadById<{ v: number }>('a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.bytes).toBe(new TextEncoder().encode('{"v":1}').length);
      expect(result.meta.location).toBe('/x.json');
      expect(result.meta.provider).toBe('file');
    }
  });
});

describe('J10.2: three cache policies', () => {
  it("'manual' hits until invalidate", async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    const first = await loader.loadById('a');
    const second = await loader.loadById('a');
    expect(first.ok && !first.meta.cached).toBe(true);
    expect(second.ok && second.meta.cached).toBe(true);
    expect(table.reads).toBe(1);

    loader.invalidate('a');
    const third = await loader.loadById('a');
    expect(third.ok && !third.meta.cached).toBe(true);
    expect(table.reads).toBe(2);
  });

  it("'ttl' hits inside the window and misses outside it", async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const clock = fakeClock(1_000_000);
    const loader = createJsonLoader(fileMap('/x.json', { ttlMs: 1000 }), { fs: table.fs, clock: clock.now });

    const first = await loader.loadById('a');
    expect(first.ok && !first.meta.cached).toBe(true);

    clock.advance(500);
    const second = await loader.loadById('a');
    expect(second.ok && second.meta.cached).toBe(true);
    expect(table.reads).toBe(1);

    clock.advance(600); // total 1100ms > 1000ms ttl
    const third = await loader.loadById('a');
    expect(third.ok && !third.meta.cached).toBe(true);
    expect(table.reads).toBe(2);
  });

  it("'mtime' hits while (path, mtimeMs, size) is unchanged and misses when it changes", async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 100 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });

    const first = await loader.loadById<{ v: number }>('a');
    expect(first.ok && !first.meta.cached).toBe(true);

    const second = await loader.loadById<{ v: number }>('a');
    expect(second.ok && second.meta.cached).toBe(true);
    expect(table.reads).toBe(1);

    table.write('/x.json', '{"v":2}', 200);
    const third = await loader.loadById<{ v: number }>('a');
    expect(third.ok && !third.meta.cached).toBe(true);
    expect(third.ok && third.data.v).toBe(2);
    expect(table.reads).toBe(2);
  });
});

describe('J10.3: the mtime stamp is captured before the read', () => {
  it('a stat failure is treated as a miss and the read proceeds; the resulting entry carries a null stamp and is never a hit', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const brokenStatFs: FileSystemPort = {
      read: table.fs.read,
      stat: async () => {
        throw new Error('stat exploded');
      },
    };
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: brokenStatFs });

    const first = await loader.loadById('a');
    expect(first.ok).toBe(true);
    const second = await loader.loadById('a');
    expect(second.ok && !second.meta.cached).toBe(true); // null stamp is never a hit
  });

  it('stat is called before read on every load under an mtime policy', async () => {
    const calls: string[] = [];
    const fs: FileSystemPort = {
      read: async (p) => {
        calls.push(`read:${p}`);
        return '{"v":1}';
      },
      stat: async (p) => {
        calls.push(`stat:${p}`);
        return { mtimeMs: 1, size: 7 };
      },
    };
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs });
    await loader.loadById('a');
    expect(calls[0]).toBe('stat:/x.json');
    expect(calls.indexOf('stat:/x.json')).toBeLessThan(calls.indexOf('read:/x.json'));
  });
});

describe('J10.4: the cache line is post-unwrap, pre-validation', () => {
  it('two call sites with different validators each get their own validated value from one shared entry', async () => {
    const table = fakeFs({ '/x.json': { text: '{"x":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });

    const a = await loader.load<{ y: number }>({
      id: 'a',
      validate: (raw) => ({ ok: true, value: { y: (raw as { x: number }).x + 1 } }),
    });
    const b = await loader.load<{ z: number }>({
      id: 'a',
      validate: (raw) => ({ ok: true, value: { z: (raw as { x: number }).x + 2 } }),
    });

    expect(a.ok && a.data).toEqual({ y: 2 });
    expect(b.ok && b.data).toEqual({ z: 3 });
    expect(b.ok && b.meta.cached).toBe(true);
    expect(table.reads).toBe(1);
  });

  it('meta.validated reflects the call, never the entry', async () => {
    const table = fakeFs({ '/x.json': { text: '{"x":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.load({ id: 'a', validate: (r) => ({ ok: true, value: r }) });
    const plain = await loader.loadById('a');
    expect(plain.ok && plain.meta.validated).toBe(false);
  });

  it('a hit returns data equal to the first success for an equal validator, cached true, attempts 0', async () => {
    const table = fakeFs({ '/x.json': { text: '{"x":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    const first = await loader.loadById<{ x: number }>('a');
    const second = await loader.loadById<{ x: number }>('a');
    expect(second.ok && second.data).toEqual(first.ok && first.data);
    expect(second.ok && second.meta.cached).toBe(true);
    expect(second.ok && second.meta.attempts).toBe(0);
  });
});

describe('J10.5: the cache key is the source id, scoped to the loader instance', () => {
  it('a request supplying its own source is neither read from, written to, nor stored in the cache', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.loadById('a'); // populates the declared entry's cache line
    expect(loader.stats().entries).toBe(1);

    const adHoc = await loader.load({ id: 'a', source: { kind: 'file', path: '/x.json' } });
    expect(adHoc.ok && adHoc.meta.cached).toBe(false);
    expect(loader.stats().entries).toBe(1); // unchanged — ad-hoc never writes
  });
});

describe('J10.6: one CacheStore handed to two loaders serves neither the other', () => {
  it('invalidate on one loader leaves the other intact', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const shared: CacheStore = createMemoryCacheStore();
    const loaderA = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs, cache: shared });
    const loaderB = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs, cache: shared });

    await loaderA.loadById('a');
    await loaderB.loadById('a');
    expect(table.reads).toBe(2); // neither loader served the other's entry

    loaderA.invalidate();
    const afterInvalidateA = await loaderA.loadById('a');
    const afterInvalidateB = await loaderB.loadById('a');
    expect(afterInvalidateA.ok && !afterInvalidateA.meta.cached).toBe(true);
    expect(afterInvalidateB.ok && afterInvalidateB.meta.cached).toBe(true); // B untouched
  });

  it('the loader never calls CacheStore.clear()', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const clearSpy = vi.fn();
    const inner = createMemoryCacheStore();
    const store: CacheStore = {
      get: (key) => inner.get(key),
      set: (key, entry) => inner.set(key, entry),
      delete: (key) => inner.delete(key),
      clear: clearSpy,
      get size() {
        return inner.size;
      },
    };
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs, cache: store });
    await loader.loadById('a');
    loader.invalidate();
    loader.invalidate('a');
    loader.dispose();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe('J10.7: invalidate and stats', () => {
  it("invalidate(id) drops that id; invalidate() bumps the epoch and drops every key this loader owns", async () => {
    const table = fakeFs({
      '/a.json': { text: '{"v":1}', mtimeMs: 1 },
      '/b.json': { text: '{"v":2}', mtimeMs: 1 },
    });
    const loader = createJsonLoader(
      {
        version: 1,
        sources: {
          a: { at: 'runtime', path: '/a.json', cache: 'manual' } as never,
          b: { at: 'runtime', path: '/b.json', cache: 'manual' } as never,
        },
      },
      { fs: table.fs },
    );
    await loader.loadById('a');
    await loader.loadById('b');
    expect(loader.stats().entries).toBe(2);

    loader.invalidate('a');
    expect(loader.stats().entries).toBe(1);
    const missA = await loader.loadById('a');
    expect(missA.ok && !missA.meta.cached).toBe(true);
    const hitB = await loader.loadById('b');
    expect(hitB.ok && hitB.meta.cached).toBe(true);

    loader.invalidate();
    expect(loader.stats().entries).toBe(0);
    const missBAgain = await loader.loadById('b');
    expect(missBAgain.ok && !missBAgain.meta.cached).toBe(true);
  });

  it('invalidate() covers keys that hold no entry yet without throwing', async () => {
    const loader = createJsonLoader({ version: 1, sources: {} });
    expect(() => loader.invalidate()).not.toThrow();
    expect(() => loader.invalidate('never-declared')).not.toThrow();
  });

  it('stats() returns entries, hits, and misses', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.loadById('a');
    await loader.loadById('a');
    await loader.loadById('a');
    expect(loader.stats()).toEqual({ entries: 1, hits: 2, misses: 1 });
  });
});

describe('J10.8: a failed load neither populates nor evicts the cache', () => {
  it('a stale entry is not a hit and is not deleted; no failure path returns it', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 100 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    const first = await loader.loadById('a');
    expect(first.ok).toBe(true);

    // Change mtime so the entry goes stale, then make the file disappear so the refresh fails.
    table.write('/x.json', '{"v":1}', 200);
    table.remove('/x.json');
    const second = await loader.loadById('a');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('json.notFound');
      expect(second.data).toBeNull();
    }
    expect(loader.stats().entries).toBe(1); // the stale entry was not evicted
  });

  it('a failed load never writes a new cache entry', async () => {
    const table = fakeFs({});
    const loader = createJsonLoader(fileMap('/missing.json', 'manual'), { fs: table.fs });
    await loader.loadById('a');
    expect(loader.stats().entries).toBe(0);
  });
});

describe('J10.9: digest is memoized into a cached entry on demand', () => {
  it('computes the digest from the cached value without re-transporting', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });

    const first = await loader.loadById('a'); // digest not requested
    expect(first.ok && first.meta.digest).toBeNull();
    expect(table.reads).toBe(1);

    const second = await loader.load({ id: 'a', digest: true });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.meta.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(table.reads).toBe(1); // no re-transport

    const third = await loader.load({ id: 'a', digest: true });
    expect(third.ok && third.meta.digest).toBe(second.ok && second.meta.digest);
  });
});

describe('J10.10: dispose() unsubscribes watchers and is idempotent', () => {
  it('a watch is registered lazily on the first successful read of an mtime entry, never at construction', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    expect(table.watcherCount).toBe(0);
    await loader.loadById('a');
    expect(table.watcherCount).toBe(1);
  });

  it('dispose unsubscribes every watcher and is idempotent', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    await loader.loadById('a');
    expect(table.watcherCount).toBe(1);
    loader.dispose();
    expect(table.watcherCount).toBe(0);
    expect(() => loader.dispose()).not.toThrow();
    expect(() => loader[Symbol.dispose]()).not.toThrow();
  });

  it('a watched file changing invalidates that id in process', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    await loader.loadById('a');
    expect(loader.stats().entries).toBe(1);
    table.fireWatch('/x.json');
    expect(loader.stats().entries).toBe(0);
  });
});

describe('J10.11: maxBytes bounds a file read', () => {
  it('a file body exceeding maxBytes yields json.tooLarge, is not retried, and writes nothing to the cache', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":"01234567890123456789"}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual', { maxBytes: 10 }), { fs: table.fs });
    const result = await loader.loadById('a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('json.tooLarge');
    expect(loader.stats().entries).toBe(0);
  });
});

describe('J10.12: the three FileCacheSpec forms drive behaviour, frozen on every path', () => {
  it('entries are frozen on a cache hit', async () => {
    const table = fakeFs({ '/x.json': { text: '{"nested":{"x":1}}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.loadById('a');
    const hit = await loader.loadById<{ nested: { x: number } }>('a');
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(Object.isFrozen(hit.data)).toBe(true);
      expect(Object.isFrozen(hit.data.nested)).toBe(true);
    }
  });
});

describe('J10.13: invariant-removal coverage', () => {
  // I12 — a cache hit returns data equal to the first success and meta.cached is true.
  it('I12', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    const first = await loader.loadById('a');
    const second = await loader.loadById('a');
    expect(second.ok && second.meta.cached).toBe(true);
    expect(second.ok && first.ok && second.data).toEqual(first.data);
  });

  // I15 — the cache line holds the post-unwrap, pre-validation value.
  it('I15', async () => {
    const table = fakeFs({ '/x.json': { text: '{"success":true,"data":{"x":1}}', mtimeMs: 1 } });
    const loader = createJsonLoader(
      { version: 1, sources: { a: { at: 'runtime', path: '/x.json', cache: 'manual', unwrap: 'subzerodev' } as never } },
      { fs: table.fs },
    );
    const first = await loader.loadById('a');
    expect(first.ok && first.data).toEqual({ x: 1 }); // unwrapped, not the envelope
    const second = await loader.loadById('a');
    expect(second.ok && second.meta.cached).toBe(true);
    expect(second.ok && second.data).toEqual({ x: 1 });
  });

  // I16 — an ad-hoc request.source is never read from, written to, or joined against the cache.
  it('I16', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    const adHoc = await loader.load({ id: 'a', source: { kind: 'file', path: '/x.json' } });
    expect(adHoc.ok && adHoc.meta.cached).toBe(false);
    expect(loader.stats().entries).toBe(0);
  });

  // I19 — a failed load neither populates nor evicts the cache.
  it('I19', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 100 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    await loader.loadById('a');
    table.write('/x.json', '{"v":1}', 200);
    table.remove('/x.json');
    await loader.loadById('a');
    expect(loader.stats().entries).toBe(1);
  });

  // I25 — the mtime stamp is captured before the read; a null stamp is never a hit.
  it('I25', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const brokenStatFs: FileSystemPort = {
      read: table.fs.read,
      stat: async () => {
        throw new Error('stat failed');
      },
    };
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: brokenStatFs });
    await loader.loadById('a');
    const second = await loader.loadById('a');
    expect(second.ok && !second.meta.cached).toBe(true);
  });

  // I26 — every watcher a loader registered is unsubscribed by dispose().
  it('I26', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', { mtime: true }), { fs: table.fs });
    await loader.loadById('a');
    loader.dispose();
    expect(table.watcherCount).toBe(0);
  });

  // I27 — a body exceeding maxBytes yields json.tooLarge, not retried, writes nothing to the cache.
  it('I27', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":"01234567890123456789"}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual', { maxBytes: 10 }), { fs: table.fs });
    const result = await loader.loadById('a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('json.tooLarge');
  });

  // I29 — one CacheStore handed to two loaders serves neither the other's entries.
  it('I29', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const shared: CacheStore = createMemoryCacheStore();
    const loaderA = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs, cache: shared });
    const loaderB = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs, cache: shared });
    await loaderA.loadById('a');
    const bFirst = await loaderB.loadById('a');
    expect(bFirst.ok && !bFirst.meta.cached).toBe(true);
  });

  // I32 — a digest: true request against an entry stored without one computes and memoizes it.
  it('I32', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.loadById('a');
    const withDigest = await loader.load({ id: 'a', digest: true });
    expect(withDigest.ok).toBe(true);
    if (withDigest.ok) expect(withDigest.meta.digest).not.toBeNull();
    expect(table.reads).toBe(1);
  });
});

describe('ports.cache omitted: the loader supplies its own default CacheStore', () => {
  it('caches without an injected CacheStore', async () => {
    const table = fakeFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', 'manual'), { fs: table.fs });
    await loader.loadById('a');
    const second = await loader.loadById('a');
    expect(second.ok && second.meta.cached).toBe(true);
  });
});
