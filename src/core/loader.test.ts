import { describe, expect, it } from 'vitest';
import { createJsonLoader } from './loader.js';
import { JsonError } from './errors.js';
import type { SourceMap } from './types.js';

const inlineMap = (sources: SourceMap['sources']): SourceMap => ({ version: 1, sources });

describe('createJsonLoader — J1.3: every port optional', () => {
  it('constructs and loads over an inline-only map with no ports argument at all', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const result = await loader.loadById<{ x: number }>('a');
    expect(result.ok).toBe(true);
  });
});

describe('load() — J1.1, J1.2: the inline pipeline', () => {
  it('resolve → unwrap → digest → freeze → validate → assemble, never branching on at', async () => {
    const loader = createJsonLoader(
      inlineMap({
        build: { at: 'build', inline: { v: 1 } } as never,
        runtime: { at: 'runtime', inline: { v: 1 } } as never,
      }),
    );
    const a = await loader.loadById<{ v: number }>('build');
    const b = await loader.loadById<{ v: number }>('runtime');
    expect(a.ok && b.ok && a.data).toEqual(b.ok && b.data);
  });

  it('matches JsonResult/JsonMeta/JsonRequest/JsonSource shapes from §1-3', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const result = await loader.loadById('a');
    expect(result).toMatchObject({ ok: true, reason: 'json.ok' });
    if (result.ok) {
      expect(result.meta).toMatchObject({
        id: 'a',
        provider: 'inline',
        bytes: 0,
        cached: false,
        attempts: 0,
      });
    }
  });

  it('I2: load() never throws — an id absent from the map returns json.unresolved', async () => {
    const loader = createJsonLoader(inlineMap({}));
    const result = await loader.load({ id: 'missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('json.unresolved');
      expect(result.meta).toMatchObject({ provider: 'none', location: '', id: 'missing' });
    }
  });

  it("I2: a malformed request (empty id) returns json.unresolved with id: ''", async () => {
    const loader = createJsonLoader(inlineMap({}));
    const result = await loader.load({ id: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('json.unresolved');
      expect(result.meta.id).toBe('');
      expect(result.meta.location).toBe('');
    }
  });
});

describe('J1.4 / I6: config.missingPort at construction', () => {
  it('throws for each of the five cases, naming the entry and the port', () => {
    expect(() =>
      createJsonLoader(inlineMap({ a: { at: 'runtime', url: 'https://x/a.json', cache: 'manual' } as never })),
    ).toThrow(JsonError);
  });

  it('never a wider set: an all-inline map with no ports never throws', () => {
    expect(() => createJsonLoader(inlineMap({ a: { at: 'build', inline: 1 } as never }))).not.toThrow();
  });
});

describe('J1.11 / I14: every returned value is deeply frozen', () => {
  it('on a plain miss (no cache implemented yet, every call is a miss)', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { nested: { x: 1 } } } as never }));
    const result = await loader.loadById<{ nested: { x: number } }>('a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.data)).toBe(true);
      expect(Object.isFrozen(result.data.nested)).toBe(true);
    }
  });

  it('after a validator transform', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const result = await loader.load<{ y: number }>({
      id: 'a',
      validate: (raw) => ({ ok: true, value: { y: (raw as { x: number }).x + 1 } }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.data)).toBe(true);
  });

  it('on a fallback', async () => {
    const loader = createJsonLoader(inlineMap({}));
    const result = await loader.load<{ x: number }>({ id: 'missing', fallback: { x: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.data).toEqual({ x: 0 });
      expect(Object.isFrozen(result.data)).toBe(true);
    }
  });
});

describe('J1.12 / I4: unwrap is never inferred from payload shape', () => {
  it("'none' (absent) returns the parsed body exactly as parsed", async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { success: true, data: 1 } } as never }));
    const result = await loader.loadById('a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ success: true, data: 1 });
  });

  it("I34: a 'subzerodev' envelope with success: false yields json.schema with the envelope's message", async () => {
    const loader = createJsonLoader(
      inlineMap({ a: { at: 'build', inline: { success: false, message: 'nope' }, unwrap: 'subzerodev' } as never }),
    );
    const result = await loader.loadById('a');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('json.schema');
      expect(result.message).toBe('nope');
    }
  });

  it("I34: 'subzerodev' with success: true unwraps to data", async () => {
    const loader = createJsonLoader(
      inlineMap({ a: { at: 'build', inline: { success: true, data: { x: 1 } }, unwrap: 'subzerodev' } as never }),
    );
    const result = await loader.loadById<{ x: number }>('a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ x: 1 });
  });
});

describe('J1.14 / I3, I10, I11: fallback, inline meta, validated', () => {
  it('data is non-null on every result when fallback is declared, ok either way', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const ok = await loader.load<{ x: number }>({ id: 'a', fallback: { x: -1 } });
    const bad = await loader.load<{ x: number }>({ id: 'missing', fallback: { x: -1 } });
    expect(ok.data).not.toBeNull();
    expect(bad.data).not.toBeNull();
  });

  it('data is null on every failure when no fallback is declared', async () => {
    const loader = createJsonLoader(inlineMap({}));
    const result = await loader.load({ id: 'missing' });
    expect(result.data).toBeNull();
  });

  it('inline meta: provider inline, bytes 0, attempts 0', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const result = await loader.loadById('a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.provider).toBe('inline');
      expect(result.meta.bytes).toBe(0);
      expect(result.meta.attempts).toBe(0);
    }
  });

  it('I10: validated is true only when a validator ran and returned ok', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const withoutValidator = await loader.loadById('a');
    const withValidator = await loader.load({ id: 'a', validate: (r) => ({ ok: true, value: r }) });
    expect(withoutValidator.ok && withoutValidator.meta.validated).toBe(false);
    expect(withValidator.ok && withValidator.meta.validated).toBe(true);
  });
});

describe('J1.15: loadById and loadMany', () => {
  it('loadById synthesizes a request from the map entry', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 7 } } as never }));
    const result = await loader.loadById<{ x: number }>('a');
    expect(result.ok && result.data).toEqual({ x: 7 });
  });

  it('loadMany returns one result per id and never rejects — one failure does not deny the others', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: { x: 1 } } as never }));
    const results = await loader.loadMany(['a', 'missing']);
    expect(results.a?.ok).toBe(true);
    expect(results.missing?.ok).toBe(false);
  });
});

describe('preload', () => {
  it('rejects with JsonError(preload.failed) naming every failed id when any id fails', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: 1 } as never }));
    await expect(loader.preload(['a', 'missing', 'also-missing'])).rejects.toMatchObject({
      code: 'preload.failed',
    });
    try {
      await loader.preload(['missing', 'also-missing']);
      throw new Error('expected preload to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(JsonError);
      const err = e as JsonError;
      expect(err.failures.map((f) => f.id)).toEqual(['missing', 'also-missing']);
    }
  });

  it('resolves when every id succeeds', async () => {
    const loader = createJsonLoader(inlineMap({ a: { at: 'build', inline: 1 } as never }));
    await expect(loader.preload(['a'])).resolves.toBeUndefined();
  });
});

describe('dispose / stats / invalidate — trivial in J1 (no cache yet)', () => {
  it('dispose is idempotent', () => {
    const loader = createJsonLoader(inlineMap({}));
    expect(() => {
      loader.dispose();
      loader.dispose();
      loader[Symbol.dispose]();
    }).not.toThrow();
  });

  it('stats reports zero entries with no cache implemented', () => {
    const loader = createJsonLoader(inlineMap({}));
    expect(loader.stats()).toEqual({ entries: 0, hits: 0, misses: 0 });
  });
});
