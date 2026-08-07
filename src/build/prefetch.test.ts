import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonError } from '../core/index.js';
import type { JsonPorts, SourceMap } from '../core/index.js';
import { prefetch } from './prefetch.js';

function fakeFs(files: Record<string, string>): NonNullable<JsonPorts['fs']> {
  return {
    async read(path: string): Promise<string> {
      const text = files[path];
      if (text === undefined) {
        const err = new Error(`ENOENT: no such file '${path}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return text;
    },
    async stat() {
      return { mtimeMs: 0, size: 0 };
    },
  };
}

describe('prefetch (J3.1, J3.2, J3.3, J3.6, J3.7, J3.10)', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'data-json-prefetch-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const map: SourceMap = {
    version: 1,
    sources: {
      projects: { at: 'build', path: '/projects.json', cache: 'manual' },
      liveStatus: { at: 'runtime', url: 'https://api.example.com/status', cache: 'manual' },
    },
  };

  it('J3.1 resolves every at:build source with a digest and writes one artifact per source', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const output = await prefetch(map, outDir, ports);

    expect(output.lock.version).toBe(1);
    expect(output.lock.sources['projects']?.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(output.lock.sources['liveStatus']).toBeUndefined();

    const artifact = await readFile(join(outDir, 'projects.json'), 'utf8');
    expect(artifact).toBe('{"count":2}');
  });

  it('J3.2 writes resolvedAt but nothing reads it back for behaviour', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const output = await prefetch(map, outDir, ports);

    expect(typeof output.lock.sources['projects']?.resolvedAt).toBe('string');
    expect(() => new Date(output.lock.sources['projects']!.resolvedAt)).not.toThrow();
  });

  it('J3.6 never resolves an at:runtime source at build', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const output = await prefetch(map, outDir, ports);

    expect(Object.keys(output.lock.sources)).toEqual(['projects']);
    expect(output.runtimeMap.sources['liveStatus']).toEqual(map.sources['liveStatus']);
  });

  it('I6/I8: an at:runtime http entry needs no fetch or schedule port to build (D43)', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const output = await prefetch(map, outDir, ports);

    expect(output.lock.sources['projects']?.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('a malformed at:runtime entry is rejected, not passed through unvalidated into runtimeMap', async () => {
    const badMap: SourceMap = {
      version: 1,
      sources: {
        projects: { at: 'build', path: '/projects.json', cache: 'manual' },
        liveStatus: { at: 'runtime', url: 'https://api.example.com/status' } as unknown as SourceMap['sources'][string],
      },
    };
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    await expect(prefetch(badMap, outDir, ports)).rejects.toThrow(JsonError);
  });

  it('J3.7 rewrites at:build entries to inline, resolvable by a portless loader', async () => {
    // A map of only at:build sources, so the resulting runtimeMap needs no port at all.
    const buildOnlyMap: SourceMap = {
      version: 1,
      sources: { projects: { at: 'build', path: '/projects.json', cache: 'manual' } },
    };
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const { runtimeMap } = await prefetch(buildOnlyMap, outDir, ports);

    const built = runtimeMap.sources['projects'];
    expect(built).toMatchObject({ at: 'build', inline: { count: 2 } });
    expect('path' in built! ? built.path : undefined).toBeUndefined();

    const { createJsonLoader } = await import('../core/index.js');
    const runtimeLoader = createJsonLoader(runtimeMap);
    const result = await runtimeLoader.loadById('projects');
    expect(result).toMatchObject({ ok: true, data: { count: 2 } });
  });

  it('J3.3 two builds over unchanged bytes produce identical digests and a byte-identical lockfile', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };

    const first = await prefetch(map, outDir, ports);
    const firstLock = await readFile(join(outDir, 'json.lock'), 'utf8');

    await rm(outDir, { recursive: true, force: true });
    const second = await prefetch(map, outDir, ports);
    const secondLock = await readFile(join(outDir, 'json.lock'), 'utf8');

    expect(second.lock.sources['projects']?.digest).toBe(first.lock.sources['projects']?.digest);
    // resolvedAt is excluded because it is informational only and legitimately differs run to
    // run (§7, D19) — comparing it would defeat the point of the byte-identity check.
    const stripResolvedAt = (text: string): string => text.replace(/"resolvedAt":"[^"]*"/, '');
    expect(stripResolvedAt(secondLock)).toBe(stripResolvedAt(firstLock));
  });

  it('J3.3 changed bytes produce a changed digest', async () => {
    const ports: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":2}' }) };
    const first = await prefetch(map, outDir, ports);

    await rm(outDir, { recursive: true, force: true });
    const ports2: JsonPorts = { fs: fakeFs({ '/projects.json': '{"count":3}' }) };
    const second = await prefetch(map, outDir, ports2);

    expect(second.lock.sources['projects']?.digest).not.toBe(first.lock.sources['projects']?.digest);
  });

  it('J3.10 a failure in one at:build source fails the build naming every failed id and writes nothing', async () => {
    const twoBuildMap: SourceMap = {
      version: 1,
      sources: {
        ok: { at: 'build', path: '/ok.json', cache: 'manual' },
        broken: { at: 'build', path: '/missing.json', cache: 'manual' },
      },
    };
    const ports: JsonPorts = { fs: fakeFs({ '/ok.json': '{"x":1}' }) };

    await expect(prefetch(twoBuildMap, outDir, ports)).rejects.toMatchObject({
      code: 'build.failed',
      failures: [{ id: 'broken', reason: 'json.notFound' }],
    });

    await expect(readFile(join(outDir, 'ok.json'), 'utf8')).rejects.toThrow();
  });

  it('J3.10 names every failed id, not only the first', async () => {
    const twoBrokenMap: SourceMap = {
      version: 1,
      sources: {
        brokenOne: { at: 'build', path: '/missing1.json', cache: 'manual' },
        brokenTwo: { at: 'build', path: '/missing2.json', cache: 'manual' },
      },
    };
    const ports: JsonPorts = { fs: fakeFs({}) };

    let error: JsonError | undefined;
    try {
      await prefetch(twoBrokenMap, outDir, ports);
    } catch (e) {
      error = e as JsonError;
    }

    expect(error?.code).toBe('build.failed');
    expect(error?.failures.map((f) => f.id).sort()).toEqual(['brokenOne', 'brokenTwo']);
  });

  it('J3.5 a source missing `at:` fails as config.invalidEntry, and nothing is written', async () => {
    const badMap = {
      version: 1,
      sources: { bad: { path: '/x.json', cache: 'manual' } },
    } as unknown as SourceMap;

    await expect(prefetch(badMap, outDir, {})).rejects.toMatchObject({ code: 'config.invalidEntry' });
    await expect(readFile(join(outDir, 'json.lock'), 'utf8')).rejects.toThrow();
  });

  it('keeps a build-time inline source unresolved by any port', async () => {
    const inlineMap: SourceMap = {
      version: 1,
      sources: { greeting: { at: 'build', inline: { hello: 'world' } } },
    };

    const output = await prefetch(inlineMap, outDir, {});

    expect(output.lock.sources['greeting']?.bytes).toBe(0);
    const artifact = await readFile(join(outDir, 'greeting.json'), 'utf8');
    expect(JSON.parse(artifact)).toEqual({ hello: 'world' });
  });
});
