import { JsonError } from './errors.js';
import type {
  CachePolicy,
  JsonPorts,
  JsonSource,
  RetryPolicy,
  SourceEntry,
  SourceId,
  SourceMap,
  SourceSpec,
  Unwrap,
} from './types.js';

/**
 * Maps a string beginning `http://` or `https://` to `{ kind: 'http' }` and every other
 * string to `{ kind: 'file' }`. Never produces `inline`; an inline source must be declared
 * in its object form (20-contract.md §2).
 */
export function normalizeSource(spec: SourceSpec): JsonSource {
  if (typeof spec !== 'string') return spec;
  return /^https?:\/\//.test(spec) ? { kind: 'http', url: spec } : { kind: 'file', path: spec };
}

export interface NormalizedEntry {
  readonly at: 'build' | 'runtime';
  readonly source: JsonSource;
  readonly unwrap: Unwrap;
  readonly cache: CachePolicy;
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  readonly maxBytes: number | undefined;
}

function invalidEntry(id: SourceId, field: string, detail: string): never {
  throw new JsonError('config.invalidEntry', `source '${id}': invalid '${field}' — ${detail}`);
}

/** Structural validation and normalization of every entry (I31, I24, §10.1). Fail-fast. */
export function normalizeSourceMap(map: SourceMap): Map<SourceId, NormalizedEntry> {
  if (map.version !== 1) {
    throw new JsonError('config.invalidEntry', `source map: invalid 'version' — must be 1, got ${JSON.stringify(map.version)}`);
  }

  const normalized = new Map<SourceId, NormalizedEntry>();

  for (const [id, entry] of Object.entries(map.sources) as [SourceId, SourceEntry][]) {
    if (entry.at !== 'build' && entry.at !== 'runtime') {
      invalidEntry(id, 'at', `must be 'build' or 'runtime', got ${JSON.stringify(entry.at)}`);
    }

    const declared = ['url' in entry && entry.url !== undefined, 'path' in entry && entry.path !== undefined, 'inline' in entry && entry.inline !== undefined];
    const declaredCount = declared.filter(Boolean).length;
    if (declaredCount !== 1) {
      invalidEntry(id, 'url/path/inline', `exactly one of 'url', 'path', 'inline' must be declared, got ${declaredCount}`);
    }

    let source: JsonSource;
    let cache: CachePolicy;

    if ('url' in entry && entry.url !== undefined) {
      if (entry.cache === undefined) invalidEntry(id, 'cache', 'required on an http entry, no default');
      cache = normalizeCacheSpec(id, entry.cache, false);
      source = { kind: 'http', url: entry.url, ...(entry.headers !== undefined ? { headers: entry.headers } : {}) };
    } else if ('path' in entry && entry.path !== undefined) {
      if (entry.cache === undefined) invalidEntry(id, 'cache', 'required on a file entry, no default');
      cache = normalizeCacheSpec(id, entry.cache, true);
      source = { kind: 'file', path: entry.path };
    } else {
      if ((entry as { cache?: unknown }).cache !== undefined) {
        invalidEntry(id, 'cache', 'forbidden on an inline entry — nothing is transported');
      }
      cache = { kind: 'manual' };
      source = { kind: 'inline', data: (entry as { inline: unknown }).inline };
    }

    if (cache.kind === 'mtime' && source.kind !== 'file') {
      invalidEntry(id, 'cache', "an 'mtime' policy is only valid on a file entry");
    }

    // timeoutMs and retry are http-only fields (§6); file and inline entries have no
    // transport attempt for either to bound, so they get inert defaults rather than the
    // http default — an inert default must never trigger a schedule/rng port requirement.
    const retrySpec = source.kind === 'http' && 'retry' in entry ? entry.retry : undefined;
    if (retrySpec !== undefined && retrySpec.attempts < 1) {
      invalidEntry(id, 'retry.attempts', `must be >= 1, got ${retrySpec.attempts}`);
    }
    const retry: RetryPolicy = retrySpec ?? { attempts: 1, delayMs: 0 };

    const timeoutMs = source.kind === 'http' ? ('timeoutMs' in entry && entry.timeoutMs !== undefined ? entry.timeoutMs : 10_000) : 0;

    const maxBytes = 'maxBytes' in entry ? entry.maxBytes : undefined;

    normalized.set(id, {
      at: entry.at,
      source,
      unwrap: entry.unwrap ?? 'none',
      cache,
      timeoutMs,
      retry,
      maxBytes,
    });
  }

  return normalized;
}

function normalizeCacheSpec(id: SourceId, spec: unknown, fileEntry: boolean): CachePolicy {
  if (spec === 'manual') return { kind: 'manual' };
  if (spec !== null && typeof spec === 'object') {
    if ('ttlMs' in spec) return { kind: 'ttl', ttlMs: (spec as { ttlMs: number }).ttlMs };
    if (fileEntry && 'mtime' in spec) return { kind: 'mtime' };
  }
  invalidEntry(id, 'cache', `unrecognized cache spec ${JSON.stringify(spec)}`);
}

/**
 * I6, checked against exactly the entries in the map supplied: `fetch` for an http entry,
 * `fs` for a file entry, `clock` for a `ttl` policy, `rng` for retry jitter, `schedule` for
 * a timeout or non-zero delay. Never a silent downgrade.
 */
export function checkRequiredPorts(normalized: Map<SourceId, NormalizedEntry>, ports: JsonPorts): void {
  for (const [id, entry] of normalized) {
    if (entry.source.kind === 'http' && !ports.fetch) {
      missingPort(id, 'fetch', 'declares an http source');
    }
    if (entry.source.kind === 'file' && !ports.fs) {
      missingPort(id, 'fs', 'declares a file source');
    }
    if (entry.cache.kind === 'ttl' && !ports.clock) {
      missingPort(id, 'clock', "declares a 'ttl' cache policy");
    }
    if (entry.retry.jitter && !ports.rng) {
      missingPort(id, 'rng', 'declares retry jitter');
    }
    if ((entry.timeoutMs > 0 || entry.retry.delayMs > 0) && !ports.schedule) {
      missingPort(id, 'schedule', 'declares a timeout or a non-zero retry delay');
    }
  }
}

function missingPort(id: SourceId, port: string, because: string): never {
  throw new JsonError('config.missingPort', `source '${id}' ${because} and no '${port}' port was supplied`);
}
