import { describe, expect, it } from 'vitest';
import { checkRequiredPorts, normalizeSource, normalizeSourceMap } from './config.js';
import { JsonError } from './errors.js';
import type { SourceMap } from './types.js';

describe('normalizeSource (§2)', () => {
  it('maps an http:// string to a http source', () => {
    expect(normalizeSource('http://example.com/a.json')).toEqual({ kind: 'http', url: 'http://example.com/a.json' });
  });

  it('maps an https:// string to a http source', () => {
    expect(normalizeSource('https://example.com/a.json')).toEqual({ kind: 'http', url: 'https://example.com/a.json' });
  });

  it('maps every other string to a file source', () => {
    expect(normalizeSource('./config/a.json')).toEqual({ kind: 'file', path: './config/a.json' });
  });

  it('passes an object form through unchanged, never producing inline from a string', () => {
    const inline = { kind: 'inline', data: { x: 1 } } as const;
    expect(normalizeSource(inline)).toBe(inline);
  });
});

describe('normalizeSourceMap — config.invalidEntry (J1.13)', () => {
  const base = (sources: SourceMap['sources']): SourceMap => ({ version: 1, sources });

  it('rejects a version other than 1', () => {
    expect(() => normalizeSourceMap({ version: 2 as 1, sources: {} })).toThrow(JsonError);
  });

  it('rejects a missing at', () => {
    const map = base({ a: { inline: 1 } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/'at'/);
  });

  it('rejects an http entry with no cache', () => {
    const map = base({ a: { at: 'runtime', url: 'https://x/a.json' } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/'cache'/);
  });

  it('rejects a file entry with no cache', () => {
    const map = base({ a: { at: 'runtime', path: './a.json' } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/'cache'/);
  });

  it('rejects cache declared on an inline entry', () => {
    const map = base({ a: { at: 'build', inline: 1, cache: 'manual' } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/'cache'/);
  });

  it('rejects more than one of url/path/inline', () => {
    const map = base({ a: { at: 'runtime', url: 'https://x/a.json', path: './a.json', cache: 'manual' } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/url.path.inline/);
  });

  it('rejects none of url/path/inline', () => {
    const map = base({ a: { at: 'runtime' } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/url.path.inline/);
  });

  it('rejects an mtime policy on a non-file entry', () => {
    const map = base({ a: { at: 'runtime', url: 'https://x/a.json', cache: { mtime: true } } as never });
    expect(() => normalizeSourceMap(map)).toThrow(/'cache'/);
  });

  it('rejects retry.attempts < 1', () => {
    const map = base({
      a: { at: 'runtime', url: 'https://x/a.json', cache: 'manual', retry: { attempts: 0, delayMs: 0 } } as never,
    });
    expect(() => normalizeSourceMap(map)).toThrow(/retry\.attempts/);
  });

  it('accepts a well-formed inline entry', () => {
    const map = base({ a: { at: 'build', inline: { x: 1 } } as never });
    const normalized = normalizeSourceMap(map);
    expect(normalized.get('a')).toMatchObject({ at: 'build', source: { kind: 'inline', data: { x: 1 } } });
  });

  it('accepts a well-formed file entry with an mtime policy', () => {
    const map = base({ a: { at: 'runtime', path: './a.json', cache: { mtime: true } } as never });
    const normalized = normalizeSourceMap(map);
    expect(normalized.get('a')?.cache).toEqual({ kind: 'mtime' });
  });
});

describe('checkRequiredPorts — config.missingPort (I6, J1.4)', () => {
  const entry = (extra: Record<string, unknown>) =>
    normalizeSourceMap({ version: 1, sources: { a: { at: 'runtime', ...extra } as never } });

  it('requires fetch for an http entry', () => {
    const normalized = entry({ url: 'https://x/a.json', cache: 'manual' });
    expect(() => checkRequiredPorts(normalized, {})).toThrow(/'fetch'/);
  });

  it('requires fs for a file entry', () => {
    const normalized = entry({ path: './a.json', cache: 'manual' });
    expect(() => checkRequiredPorts(normalized, {})).toThrow(/'fs'/);
  });

  it('requires clock for a ttl cache policy', () => {
    const normalized = entry({ url: 'https://x/a.json', cache: { ttlMs: 1000 } });
    expect(() => checkRequiredPorts(normalized, { fetch: async () => new Response(), schedule: () => ({ promise: Promise.resolve(), cancel() {} }) })).toThrow(/'clock'/);
  });

  it('requires rng for retry jitter', () => {
    const normalized = entry({
      url: 'https://x/a.json',
      cache: 'manual',
      retry: { attempts: 2, delayMs: 100, jitter: true },
    });
    const ports = { fetch: async () => new Response(), schedule: () => ({ promise: Promise.resolve(), cancel() {} }) };
    expect(() => checkRequiredPorts(normalized, ports)).toThrow(/'rng'/);
  });

  it('requires schedule for a (default) timeout on an http entry', () => {
    const normalized = entry({ url: 'https://x/a.json', cache: 'manual' });
    expect(() => checkRequiredPorts(normalized, { fetch: async () => new Response() })).toThrow(/'schedule'/);
  });

  it('does not require schedule or rng for an inline entry', () => {
    const normalized = normalizeSourceMap({ version: 1, sources: { a: { at: 'build', inline: 1 } as never } });
    expect(() => checkRequiredPorts(normalized, {})).not.toThrow();
  });

  it('checks exactly the entries supplied, never a wider set', () => {
    // Only 'a' declares http; 'b' is inline and needs nothing. A missing fetch port must
    // name 'a' and must not also demand ports for 'b'.
    const normalized = normalizeSourceMap({
      version: 1,
      sources: {
        a: { at: 'runtime', url: 'https://x/a.json', cache: 'manual' } as never,
        b: { at: 'build', inline: 1 } as never,
      },
    });
    expect(() => checkRequiredPorts(normalized, {})).toThrow(/'a'/);
  });
});
