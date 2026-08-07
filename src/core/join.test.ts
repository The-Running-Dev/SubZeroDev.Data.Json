import { describe, expect, it } from 'vitest';
import { createJsonLoader } from './loader.js';
import type { FileSystemPort, SourceMap } from './types.js';

/**
 * A `FileSystemPort` whose `read` is controlled by the test: it stays pending until
 * `releaseNext`/`failNext` is called, letting a test drive genuine interleaving without
 * elapsed time (J11.7). `stat` and `watch` behave like a normal file table.
 */
function controllableFs(initial: Record<string, { text: string; mtimeMs: number }>) {
  const files = new Map(Object.entries(initial));
  let reads = 0;
  const pendingReads: Array<{ resolve: (text: string) => void; reject: (e: unknown) => void }> = [];
  const watchers = new Map<string, Set<() => void>>();

  const fs: FileSystemPort = {
    read() {
      reads++;
      return new Promise<string>((resolve, reject) => {
        pendingReads.push({ resolve, reject });
      });
    },
    async stat(path: string) {
      const f = files.get(path);
      if (!f) {
        const err = new Error(`ENOENT: no such file, stat '${path}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: f.mtimeMs, size: new TextEncoder().encode(f.text).length };
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
    get reads() {
      return reads;
    },
    releaseNext(text: string) {
      const next = pendingReads.shift();
      if (!next) throw new Error('releaseNext: no pending read');
      next.resolve(text);
    },
    write(path: string, text: string, mtimeMs: number) {
      files.set(path, { text, mtimeMs });
    },
    fireWatch(path: string) {
      for (const cb of watchers.get(path) ?? []) cb();
    },
  };
}

/** Lets pending microtasks (cache lookup, in-flight registration) settle before an assertion. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const fileMap = (path: string, extra: Record<string, unknown> = {}): SourceMap => ({
  version: 1,
  sources: { a: { at: 'runtime', path, cache: 'manual', ...extra } as never },
});

describe('J11.1: concurrent misses for one cache key issue exactly one transport', () => {
  it('the rest join that load and receive the same frozen value', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.loadById<{ v: number }>('a');
    const p2 = loader.loadById<{ v: number }>('a');
    const p3 = loader.loadById<{ v: number }>('a');
    await flush();
    expect(table.reads).toBe(1);

    table.releaseNext('{"v":1}');
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.ok && r1.data).toEqual({ v: 1 });
    expect(r1.ok && r2.ok && r2.data).toBe(r1.ok && r1.data);
    expect(r1.ok && r3.ok && r3.data).toBe(r1.ok && r1.data);
    expect(table.reads).toBe(1);
  });
});

describe('J11.2: a joined caller reports the joined load\'s attempts, and cached: false', () => {
  it('attempts matches the leader\'s, and cached is false for every joiner', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.loadById('a');
    await flush();
    const p2 = loader.loadById('a');
    await flush();
    expect(table.reads).toBe(1); // p2 joined, did not start its own transport

    table.releaseNext('{"v":1}');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok && r1.meta.attempts).toBe(1);
    expect(r2.ok && r2.meta.attempts).toBe(1);
    expect(r2.ok && r2.meta.cached).toBe(false);
  });
});

describe('J11.3: invalidate during an in-flight load', () => {
  it('the result reaches the caller but nothing is written to the cache (invalidate(id))', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p = loader.loadById<{ v: number }>('a');
    await flush();
    loader.invalidate('a');
    table.releaseNext('{"v":1}');
    const r = await p;

    expect(r.ok && r.data).toEqual({ v: 1 });
    expect(loader.stats().entries).toBe(0);

    const readsBefore = table.reads;
    const p2 = loader.loadById('a');
    await flush();
    table.releaseNext('{"v":1}');
    const r2 = await p2;
    expect(r2.ok && !r2.meta.cached).toBe(true); // a fresh miss, not served from a phantom entry
    expect(table.reads).toBe(readsBefore + 1);
  });

  it('the result reaches every caller but nothing is written to the cache (invalidate())', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.loadById<{ v: number }>('a');
    const p2 = loader.loadById<{ v: number }>('a');
    await flush();
    loader.invalidate();
    table.releaseNext('{"v":1}');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok && r1.data).toEqual({ v: 1 });
    expect(r2.ok && r2.data).toEqual({ v: 1 });
    expect(loader.stats().entries).toBe(0);
  });
});

describe('J11.4: a watch callback firing mid-load', () => {
  it('invalidates through the same generation guard as invalidate()', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json', { cache: { mtime: true } }), { fs: table.fs });

    const first = loader.loadById('a');
    await flush();
    table.releaseNext('{"v":1}');
    await first;
    expect(loader.stats().entries).toBe(1); // watch now registered on the successful, uncached read

    loader.invalidate('a'); // force the next load to miss
    const second = loader.loadById<{ v: number }>('a');
    await flush();
    table.fireWatch('/x.json'); // fires mid-load; drops + bumps the generation
    table.releaseNext('{"v":2}');
    const r2 = await second;

    expect(r2.ok && r2.data).toEqual({ v: 2 });
    expect(loader.stats().entries).toBe(0); // write suppressed by the generation guard

    const readsBefore = table.reads;
    const third = loader.loadById('a');
    await flush();
    table.releaseNext('{"v":2}');
    const r3 = await third;
    expect(r3.ok && !r3.meta.cached).toBe(true);
    expect(table.reads).toBe(readsBefore + 1);
  });
});

describe('J11.5: a request supplying its own source', () => {
  it('is never joined to an in-flight load and never joined against', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const declared = loader.loadById('a');
    await flush();
    const adHoc = loader.load({ id: 'a', source: { kind: 'file', path: '/x.json' } });
    await flush();
    expect(table.reads).toBe(2); // the ad-hoc request issued its own transport

    table.releaseNext('{"v":1}');
    table.releaseNext('{"v":1}');
    const [declaredResult, adHocResult] = await Promise.all([declared, adHoc]);

    expect(declaredResult.ok && !declaredResult.meta.cached).toBe(true);
    expect(adHocResult.ok && !adHocResult.meta.cached).toBe(true);
    expect(loader.stats().entries).toBe(1); // only the declared load wrote the cache
  });
});

describe('J11.6: validation still runs per caller against the shared value', () => {
  it('two joiners with different validators do not share a schema', async () => {
    const table = controllableFs({ '/x.json': { text: '{"x":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.load<{ y: number }>({
      id: 'a',
      validate: (raw) => ({ ok: true, value: { y: (raw as { x: number }).x + 1 } }),
    });
    await flush();
    const p2 = loader.load<{ z: number }>({
      id: 'a',
      validate: (raw) => ({ ok: true, value: { z: (raw as { x: number }).x + 2 } }),
    });
    await flush();
    expect(table.reads).toBe(1);

    table.releaseNext('{"x":1}');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok && r1.data).toEqual({ y: 2 });
    expect(r2.ok && r2.data).toEqual({ z: 3 });
  });
});

describe('J11.7: invariant-removal coverage', () => {
  // I17 — concurrent misses for one key issue one transport, and a generation mismatch
  // discards the write instead of racing invalidate.
  it('I17', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.loadById('a');
    const p2 = loader.loadById('a');
    await flush();
    expect(table.reads).toBe(1);
    loader.invalidate('a');
    table.releaseNext('{"v":1}');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(loader.stats().entries).toBe(0);
  });

  // I11 (joined-caller half) — a joined caller reports the attempts made by the load it
  // joined, and cached: false.
  it('I11', async () => {
    const table = controllableFs({ '/x.json': { text: '{"v":1}', mtimeMs: 1 } });
    const loader = createJsonLoader(fileMap('/x.json'), { fs: table.fs });

    const p1 = loader.loadById('a');
    await flush();
    const p2 = loader.loadById('a');
    await flush();
    table.releaseNext('{"v":1}');
    const [, r2] = await Promise.all([p1, p2]);
    expect(r2.ok && r2.meta.attempts).toBe(1);
    expect(r2.ok && r2.meta.cached).toBe(false);
  });
});
