import { sha256Hex } from './sha256.js';
import type { Digest } from './types.js';

/**
 * Canonical serialization: object keys sorted, no insignificant whitespace. Two JSON-equal
 * values serialize identically regardless of key order (I5). Accepts exactly `CanonicalValue`
 * (20-contract.md §3, I35): filters `undefined`-valued object keys, and throws on a non-finite
 * number, a bare `undefined`, a `bigint`, a symbol, a function, or a non-plain object (D49).
 * This walk is also the I36 domain check the pipeline runs on every load — `digestAndFreeze`
 * for an inline entry, and `fetchFileCore`/`httpAttempt` for the transported ones.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    // D49: `CanonicalValue`'s object arm is a plain record. A Date, Map, Set, RegExp, or class
    // instance is `typeof 'object'` and has no enumerable own keys, so walking it as a record
    // emitted `{}` — every such value collapsing to one serialization, and one digest (I5).
    // Reachable through a hand-written `inline` entry, and guaranteed once a YAML reader lands
    // (js-yaml DEFAULT_SCHEMA resolves a bare timestamp to a Date, D41).
    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto !== null && proto !== Object.prototype) {
      throw new TypeError(`canonicalize: unsupported object ${Object.prototype.toString.call(value)}`);
    }
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

/** The core's own digest (I5, I13): canonical serialization, then this module's SHA-256. */
export function digestOf(value: unknown): Digest {
  return `sha256-${sha256Hex(canonicalize(value))}`;
}
