import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createJsonLoader } from '../core/loader.js';
import { JsonError } from '../core/errors.js';
import type { JsonPorts, SourceMap } from '../core/types.js';
import { parseSourceMap, readSourceMap } from './source-map.js';

const fullPorts: JsonPorts = {
  fetch: async () => new Response('{}'),
  fs: { read: async () => '{}', stat: async () => ({ mtimeMs: 0, size: 0 }) },
  clock: () => 0,
  rng: () => 0,
  schedule: () => ({ promise: Promise.resolve(), cancel() {} }),
};

/**
 * J13.3 — one fixture corpus, asserted against both `createJsonLoader` and `parseSourceMap`,
 * so I42's "exactly the maps `createJsonLoader` accepts" is checkable rather than reviewed.
 * `fullPorts` is supplied to every accepted case so `config.missingPort` never masks a
 * disagreement over entry validity.
 */
const fixtures: ReadonlyArray<{ readonly name: string; readonly accepted: boolean; readonly map: SourceMap }> = [
  {
    name: 'version other than 1',
    accepted: false,
    map: { version: 2 as 1, sources: {} },
  },
  {
    name: 'missing at',
    accepted: false,
    map: { version: 1, sources: { a: { inline: 1 } as never } },
  },
  {
    name: 'http entry with no cache',
    accepted: false,
    map: { version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json' } as never } },
  },
  {
    name: 'file entry with no cache',
    accepted: false,
    map: { version: 1, sources: { a: { at: 'runtime', path: './a.json' } as never } },
  },
  {
    name: 'cache declared on an inline entry',
    accepted: false,
    map: { version: 1, sources: { a: { at: 'build', inline: 1, cache: 'manual' } as never } },
  },
  {
    name: 'more than one of url/path/inline',
    accepted: false,
    map: {
      version: 1,
      sources: { a: { at: 'runtime', url: 'https://x/a.json', path: './a.json', cache: 'manual' } as never },
    },
  },
  {
    name: 'mtime policy on a non-file entry',
    accepted: false,
    map: { version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json', cache: { mtime: true } } as never } },
  },
  {
    name: 'retry.attempts < 1',
    accepted: false,
    map: {
      version: 1,
      sources: {
        a: { at: 'runtime', url: 'https://x/a.json', cache: 'manual', retry: { attempts: 0, delayMs: 0 } } as never,
      },
    },
  },
  {
    name: 'well-formed inline entry',
    accepted: true,
    map: { version: 1, sources: { a: { at: 'build', inline: { x: 1 } } as never } },
  },
  {
    name: 'well-formed http entry',
    accepted: true,
    map: { version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json', cache: 'manual' } as never } },
  },
  {
    name: 'well-formed file entry with an mtime policy',
    accepted: true,
    map: { version: 1, sources: { a: { at: 'runtime', path: './a.json', cache: { mtime: true } } as never } },
  },
];

describe('parseSourceMap / createJsonLoader agreement (J13.3, I42)', () => {
  const accepted = fixtures.filter((f) => f.accepted);
  const rejected = fixtures.filter((f) => !f.accepted);

  it('the corpus states both accepted and rejected counts, and both are non-zero', () => {
    expect(accepted.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`${fixture.accepted ? 'accepts' : 'rejects'}: ${fixture.name}`, () => {
      const text = JSON.stringify(fixture.map); // JSON is valid YAML

      if (fixture.accepted) {
        expect(() => createJsonLoader(fixture.map, fullPorts)).not.toThrow();
        expect(() => parseSourceMap(text)).not.toThrow();
      } else {
        expect(() => createJsonLoader(fixture.map, fullPorts)).toThrow(JsonError);
        expect(() => parseSourceMap(text)).toThrow(JsonError);
      }
    });
  }

  it('rejects with the same code, id, and field as the core, for a shared fault', () => {
    const map: SourceMap = { version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json' } as never } };

    let coreMessage = '';
    try {
      createJsonLoader(map, fullPorts);
    } catch (error) {
      coreMessage = error instanceof JsonError ? error.message : '';
    }

    let readerMessage = '';
    let readerCode = '';
    try {
      parseSourceMap(JSON.stringify(map));
    } catch (error) {
      readerMessage = error instanceof JsonError ? error.message : '';
      readerCode = error instanceof JsonError ? error.code : '';
    }

    expect(readerCode).toBe('config.invalidEntry');
    expect(readerMessage).toBe(coreMessage);
    expect(readerMessage).toContain("'a'");
    expect(readerMessage).toContain('cache');
  });
});

describe('parseSourceMap — the reader-only checks (J13.1, J13.4)', () => {
  it('returns the parsed document unnormalized, and it constructs a working loader (J13.1)', () => {
    const text = JSON.stringify({ version: 1, sources: { a: { at: 'build', inline: { x: 1 } } } });
    const map = parseSourceMap(text);

    expect(map).toEqual({ version: 1, sources: { a: { at: 'build', inline: { x: 1 } } } });
    expect(() => createJsonLoader(map)).not.toThrow();
  });

  it('rejects text that is not YAML with config.invalidEntry naming the file-level fault', () => {
    expect(() => parseSourceMap('{ this is not: [valid')).toThrow(JsonError);
    try {
      parseSourceMap('{ this is not: [valid');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonError);
      expect((error as JsonError).code).toBe('config.invalidEntry');
      expect((error as JsonError).name).not.toBe('YAMLException');
    }
  });

  it('rejects a document that is not an object with config.invalidEntry', () => {
    expect(() => parseSourceMap('42')).toThrow(JsonError);
    try {
      parseSourceMap('42');
    } catch (error) {
      expect((error as JsonError).code).toBe('config.invalidEntry');
    }
  });

  it('rejects a document with no sources record with config.invalidEntry', () => {
    expect(() => parseSourceMap('version: 1')).toThrow(JsonError);
    try {
      parseSourceMap('version: 1');
    } catch (error) {
      expect((error as JsonError).code).toBe('config.invalidEntry');
      expect((error as JsonError).message).toMatch(/sources/);
    }
  });

  it('never lets a YAMLException or a bare TypeError escape (I24, J13.4)', () => {
    for (const text of ['{ broken: [', '42', 'null', '- a\n- b', 'version: 1']) {
      try {
        parseSourceMap(text);
      } catch (error) {
        expect(error).toBeInstanceOf(JsonError);
      }
    }
  });
});

describe('readSourceMap (J13.5, J13.6)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'data-json-source-map-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a well-formed file and returns the parsed source map', async () => {
    const path = join(dir, 'sources.yml');
    await writeFile(path, 'version: 1\nsources:\n  a:\n    at: build\n    inline: 1\n', 'utf8');

    const map = await readSourceMap(path);
    expect(map).toEqual({ version: 1, sources: { a: { at: 'build', inline: 1 } } });
  });

  it('yields config.unreadable, never config.invalidEntry, for a path that does not exist', async () => {
    const path = join(dir, 'missing.yml');
    await expect(readSourceMap(path)).rejects.toMatchObject({ code: 'config.unreadable' });
    await expect(readSourceMap(path)).rejects.toMatchObject({ message: expect.stringContaining(path) });
  });

  it('yields config.unreadable for a directory', async () => {
    const path = join(dir, 'a-directory');
    await mkdir(path);
    await expect(readSourceMap(path)).rejects.toMatchObject({ code: 'config.unreadable' });
  });

  it('yields config.invalidEntry, naming the id and field, for a file that reads cleanly but carries a bad entry (J13.6)', async () => {
    const path = join(dir, 'sources.yml');
    await writeFile(path, 'version: 1\nsources:\n  a:\n    at: runtime\n    url: https://x/a.json\n', 'utf8');

    let readerMessage = '';
    try {
      await readSourceMap(path);
    } catch (error) {
      expect(error).toBeInstanceOf(JsonError);
      expect((error as JsonError).code).toBe('config.invalidEntry');
      readerMessage = (error as JsonError).message;
    }

    let coreMessage = '';
    try {
      createJsonLoader({ version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json' } as never } }, fullPorts);
    } catch (error) {
      coreMessage = (error as JsonError).message;
    }

    expect(readerMessage).toBe(coreMessage);
  });

  it('parseSourceMap never raises config.unreadable — it is handed text and cannot fail that way (D63)', () => {
    try {
      parseSourceMap('not: [valid yaml');
    } catch (error) {
      expect((error as JsonError).code).not.toBe('config.unreadable');
    }
  });
});

describe('exports (J13.7)', () => {
  it('parseSourceMap and readSourceMap are exported from /node', async () => {
    const nodeIndex = await import('./index.js');
    expect(nodeIndex.parseSourceMap).toBe(parseSourceMap);
    expect(nodeIndex.readSourceMap).toBe(readSourceMap);
  });
});

describe('I42 has a test that fails when the invariant is removed (J13.8)', () => {
  it('a reader that skipped the core check would accept an entry the core rejects — demonstrated by bypassing it', () => {
    // I42 removed: the reader validates nothing beyond "is an object with a sources record".
    // This is what J13.3's per-fixture agreement checks catch; restated here narrowly so the
    // failure mode has one dedicated assertion (00-brief.md §7.1).
    const badMap = { version: 1, sources: { a: { at: 'runtime', url: 'https://x/a.json' } } }; // missing cache

    expect(() => parseSourceMap(JSON.stringify(badMap))).toThrow(JsonError);

    function withoutI42(text: string): unknown {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || !('sources' in parsed)) {
        throw new Error('not a source map shape');
      }
      return parsed; // no entry-level check at all
    }

    expect(() => withoutI42(JSON.stringify(badMap))).not.toThrow();
  });
});
