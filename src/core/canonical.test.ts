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
