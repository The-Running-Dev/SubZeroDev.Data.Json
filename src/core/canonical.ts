import { sha256Hex } from './sha256.js';
import type { Digest } from './types.js';

/**
 * Canonical serialization: object keys sorted, no insignificant whitespace. Two JSON-equal
 * values serialize identically regardless of key order (I5). Operates on the parsed JSON
 * value space only — the digest is computed post-unwrap, pre-validation (D14), which is
 * always plain JSON: no `undefined`, no functions, no `Date`.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    );
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

/** The core's own digest (I5, I13): canonical serialization, then this module's SHA-256. */
export function digestOf(value: unknown): Digest {
  return `sha256-${sha256Hex(canonicalize(value))}`;
}
