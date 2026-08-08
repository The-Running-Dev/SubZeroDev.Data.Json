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
