import { describe, expect, it } from 'vitest';
import { canonicalize, digestOf } from './canonical.js';

describe('canonicalize / digestOf (I5, J1.10)', () => {
  it('produces the same digest for JSON-equal values regardless of key order', () => {
    const a = { b: 2, a: 1, c: { y: 2, x: 1 } };
    const b = { a: 1, c: { x: 1, y: 2 }, b: 2 };
    expect(digestOf(a)).toBe(digestOf(b));
  });

  it('produces the same digest regardless of the whitespace a source used before parsing', () => {
    const compact = JSON.parse('{"a":1,"b":[1,2,3]}');
    const spaced = JSON.parse('{\n  "a" : 1,\n  "b" : [ 1, 2, 3 ]\n}');
    expect(digestOf(compact)).toBe(digestOf(spaced));
  });

  it('produces a different digest for values that differ', () => {
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 1, b: 1 }));
  });

  it('digest is a lowercase-hex, sha256-prefixed Digest', () => {
    expect(digestOf({ a: 1 })).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('canonicalize sorts nested object keys at every level', () => {
    expect(canonicalize({ b: 1, a: { d: 1, c: 1 } })).toBe('{"a":{"c":1,"d":1},"b":1}');
  });

  it('canonicalize preserves array order — arrays are not sorted', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('canonicalize domain enforcement (I35)', () => {
  it('rejects NaN rather than silently coercing it (JSON.stringify(NaN) === "null")', () => {
    expect(() => canonicalize(NaN)).toThrow(TypeError);
    expect(() => canonicalize({ x: NaN })).toThrow(TypeError);
  });

  it('rejects ±Infinity', () => {
    expect(() => canonicalize(Infinity)).toThrow(TypeError);
    expect(() => canonicalize(-Infinity)).toThrow(TypeError);
  });

  it('rejects a bare undefined, a function, a bigint, and a symbol', () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
    expect(() => canonicalize(1n)).toThrow(TypeError);
    expect(() => canonicalize(Symbol('s'))).toThrow(TypeError);
  });

  it('filters undefined-valued object keys rather than rejecting them', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('rejects a non-plain object rather than collapsing it to {} (D49)', () => {
    // Each of these has no enumerable own keys, so the pre-D49 record walk emitted '{}' for
    // all four — one serialization, one digest, four different values (I5).
    expect(() => canonicalize(new Date(0))).toThrow(TypeError);
    expect(() => canonicalize(new Map([['a', 1]]))).toThrow(TypeError);
    expect(() => canonicalize(new Set([1]))).toThrow(TypeError);
    expect(() => canonicalize(/x/)).toThrow(TypeError);
  });

  it('rejects a class instance, at depth as well as at the root (D49)', () => {
    class Point {
      constructor(readonly x: number) {}
    }
    expect(() => canonicalize(new Point(1))).toThrow(TypeError);
    expect(() => canonicalize({ a: { b: new Point(1) } })).toThrow(TypeError);
  });

  it('still accepts a null-prototype record — it is a plain record (D49)', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['b'] = 2;
    bare['a'] = 1;
    expect(canonicalize(bare)).toBe('{"a":1,"b":2}');
  });
});

// I13 pins this package's serializer to the engine's. These are the engine's own seven test
// vectors, transcribed from `src/engine/src/core/persistence/canonical.test.ts` in
// SubZeroDev.GameEngine, and every expected string below is the *engine* serializer's measured
// output — not this package's. Read at `b7e21e7` (2026-09-03); `canonical.ts` last changed at
// `d3f0a20`, which added a `sha256Hex` export and left `write()` byte-identical to `f7d8f59`,
// the SHA D39 read, and `canonical.test.ts` is unchanged since `f7d8f59`.
//
// Duplication with the blocks above is the point. These assertions carry the engine's bytes, so
// a "simplification" of an expectation here is visibly a change to what I13 promises, which the
// same expectation written as this package's own behaviour is not. They retire at J9.1, when the
// engine deletes its copy and imports this one.
describe("I13 — the engine's recorded vectors (GameEngine @ b7e21e7)", () => {
  it('v1: is independent of key insertion order', () => {
    expect(canonicalize({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
    expect(canonicalize({ c: 3, a: 1, b: 2 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it('v2: sorts keys deeply', () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [{ n: 2, m: 1 }] })).toBe(
      '{"a":[{"m":1,"n":2}],"z":{"x":2,"y":1}}',
    );
  });

  it('v3: the engine\'s round-trip state vector', () => {
    const state = {
      rng: { algorithm: 'pcg32', state: '00ff', increment: '0001' },
      turn: 4,
      vars: { b: true, a: 3 },
    };
    expect(canonicalize(state)).toBe(
      '{"rng":{"algorithm":"pcg32","increment":"0001","state":"00ff"},"turn":4,"vars":{"a":3,"b":true}}',
    );
    // The engine asserts stability across a JSON round trip; the digest rests on the same
    // property (I5), so it is checked here rather than only implied.
    expect(canonicalize(JSON.parse(canonicalize(state)))).toBe(canonicalize(state));
  });

  it('v4: preserves arrays in order (only object keys are sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('v5: drops undefined-valued keys, matching JSON', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('v6: rejects non-finite numbers', () => {
    expect(() => canonicalize({ x: NaN })).toThrow(TypeError);
    expect(() => canonicalize({ x: Infinity })).toThrow(TypeError);
  });

  it('v7: rejects bigint (the engine requires 64-bit values hex-encoded)', () => {
    expect(() => canonicalize({ x: 1n })).toThrow(TypeError);
  });

  // I13's one permitted asymmetry (D49): this package may reject strictly more, never less.
  // The engine's record walk has no prototype check, so it emits `{}` for a Date, Map, Set or
  // RegExp and `{"a":1}` for a class instance — the collapse D49 rejected. Asserted here as a
  // direction, since the engine's serializer cannot be executed from this repository.
  it('rejects strictly more than the engine, never less (D49)', () => {
    class Thing {
      readonly a = 1;
    }
    for (const stricter of [new Date(0), new Map(), new Set(), /x/, new Thing()]) {
      expect(() => canonicalize(stricter)).toThrow(TypeError);
    }
  });
});
