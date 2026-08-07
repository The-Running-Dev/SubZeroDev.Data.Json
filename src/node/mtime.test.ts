import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonLoader } from '../core/index.js';
import { nodeFileSystem } from './fs.js';

describe('mtime cache policy against a real file (J2.2)', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'data-json-mtime-'));
    path = join(dir, 'a.json');
    await writeFile(path, '{"x":1}', 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hits while (path, mtimeMs, size) are unchanged, and misses once the file changes', async () => {
    const loader = createJsonLoader(
      { version: 1, sources: { a: { at: 'runtime', path, cache: { mtime: true } } } },
      { fs: nodeFileSystem() },
    );

    const first = await loader.load<{ x: number }>({ id: 'a' });
    expect(first.ok && first.data).toEqual({ x: 1 });
    expect(first.ok && first.meta.cached).toBe(false);

    const second = await loader.load<{ x: number }>({ id: 'a' });
    expect(second.ok && second.meta.cached).toBe(true);
    expect(second.ok && second.data).toEqual({ x: 1 });

    // Change size and force mtimeMs forward so the change is unambiguous (D36's documented
    // gap is a same-size edit inside the filesystem's mtime resolution, not exercised here).
    await writeFile(path, '{"x":22}', 'utf8');
    const future = new Date(Date.now() + 60_000);
    await utimes(path, future, future);

    const third = await loader.load<{ x: number }>({ id: 'a' });
    expect(third.ok && third.meta.cached).toBe(false);
    expect(third.ok && third.data).toEqual({ x: 22 });
  });

  it('never returns a stale read: the stamp is taken before the read (I25, D36)', async () => {
    const loader = createJsonLoader(
      { version: 1, sources: { a: { at: 'runtime', path, cache: { mtime: true } } } },
      { fs: nodeFileSystem() },
    );

    await loader.load<{ x: number }>({ id: 'a' });

    await writeFile(path, '{"x":99}', 'utf8');
    const future = new Date(Date.now() + 60_000);
    await utimes(path, future, future);

    const result = await loader.load<{ x: number }>({ id: 'a' });
    expect(result.ok && result.data).toEqual({ x: 99 });
  });
});
