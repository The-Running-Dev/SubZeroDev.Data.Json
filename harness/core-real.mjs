// Adapter pointing the harness at the real, built core (J12.9).
//
// harness/core.mjs is the reproduction and stays exactly as it is — README.md is explicit
// that it is not "improved" once a defect it demonstrates is fixed. This file exists only so
// probes-real.mjs can exercise the *actual* `src/core` implementation (via `dist/core`,
// built by `npm run build`) through the same probe shapes, for the one-time comparison
// J12.9 asks for.

import { createJsonLoader as realCreateJsonLoader, JsonError } from '../dist/core/index.js';

export { JsonError };
export const createJsonLoader = realCreateJsonLoader;

/** A plain `CacheStore` (§4) — the real core has no exported factory for one (none is
 * declared in `20-contract.md` §9), so a consumer wanting to share one across loaders writes
 * exactly this, same as the harness's own `makeMemoryStore` did. */
export function makeMemoryStore() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    delete: (k) => void m.delete(k),
    clear: () => m.clear(),
    get size() {
      return m.size;
    },
  };
}
