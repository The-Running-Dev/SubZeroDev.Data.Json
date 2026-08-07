import { sha256Hex } from './sha256.js';
import type { Digest } from './types.js';

/**
 * Canonical serialization: object keys sorted, no insignificant whitespace. Two JSON-equal
 * values serialize identically regardless of key order (I5). Accepts exactly `CanonicalValue`
 * (20-contract.md §3, I35): filters `undefined`-valued object keys, and throws on a non-finite
 * number, a bare `undefined`, a `bigint`, a symbol, or a function. This walk is also the I36
 * domain check the pipeline runs on every load — see `runInlinePipeline` in pipeline.ts.
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
