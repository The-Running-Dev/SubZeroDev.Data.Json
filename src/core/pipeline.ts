import { canonicalize, digestOf } from './canonical.js';
import { normalizeSource } from './config.js';
import { sha256Hex, utf8ByteLength } from './sha256.js';
import type { CacheManager, CacheToken } from './cache-manager.js';
import type { InFlightManager } from './in-flight.js';
import type { NormalizedEntry } from './config.js';
import type {
  CacheEntry,
  CachePolicy,
  Digest,
  JsonMeta,
  JsonPorts,
  JsonRequest,
  JsonResult,
  JsonSource,
  ReasonCode,
  SourceId,
  Unwrap,
} from './types.js';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function locationOf(source: JsonSource): string {
  if (source.kind === 'http') return source.url;
  if (source.kind === 'file') return source.path;
  return '';
}

function emptyMeta(id: SourceId): JsonMeta {
  return {
    id,
    provider: 'none',
    location: '',
    bytes: 0,
    digest: null,
    cached: false,
    attempts: 0,
    validated: false,
  };
}

function fileMeta(id: SourceId, location: string, bytes: number, attempts: number, digest: Digest | null = null): JsonMeta {
  return { id, provider: 'file', location, bytes, digest, cached: false, attempts, validated: false };
}

function fail<T>(
  request: JsonRequest<T>,
  id: SourceId,
  reason: Exclude<ReasonCode, 'json.ok'>,
  message: string,
  meta: JsonMeta,
): JsonResult<T> {
  const hasFallback = 'fallback' in request && request.fallback !== undefined;
  return {
    ok: false,
    reason,
    message,
    data: hasFallback ? deepFreeze(request.fallback as T) : null,
    meta,
  };
}

function applyUnwrap(parsed: unknown, unwrap: Unwrap): unknown {
  if (unwrap === 'none') return parsed;
  if (typeof unwrap === 'function') return unwrap(parsed);
  if (unwrap === 'subzerodev') {
    if (parsed === null || typeof parsed !== 'object' || !('success' in parsed)) {
      throw new Error("declared envelope 'subzerodev' absent");
    }
    const envelope = parsed as { success: boolean; data?: unknown; message?: string };
    if (envelope.success === false) {
      throw new Error(envelope.message ?? "envelope reported 'success: false'");
    }
    if (envelope.data === undefined) {
      throw new Error("declared envelope 'subzerodev' reported success with no data");
    }
    return envelope.data;
  }
  throw new Error(`unknown unwrap mode ${String(unwrap)}`);
}

/** Runs the request's validator, if any, against an already-frozen value and assembles the result. */
function assembleValidated<T>(request: JsonRequest<T>, id: SourceId, value: unknown, baseMeta: JsonMeta): JsonResult<T> {
  if (!request.validate) {
    return { ok: true, reason: 'json.ok', data: value as T, meta: baseMeta };
  }
  let verdict;
  try {
    verdict = request.validate(value);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(request, id, 'json.schema', `validator threw: ${message}`, baseMeta);
  }
  if (!verdict.ok) {
    return fail(request, id, 'json.schema', verdict.message, { ...baseMeta, validated: false });
  }
  return {
    ok: true,
    reason: 'json.ok',
    data: deepFreeze(verdict.value),
    meta: { ...baseMeta, validated: true },
  };
}

/**
 * Domain-checks (I35/I36) and digests a post-unwrap value, on every load, before freeze or
 * cache. Canonicalizing here also produces the string a digest would hash, so it is computed
 * once and reused rather than canonicalizing a second time.
 */
function digestAndFreeze<T>(
  request: JsonRequest<T>,
  id: SourceId,
  value: unknown,
  meta: (bytes: number, attempts: number, digest: Digest | null) => JsonMeta,
  bytes: number,
  attempts: number,
): { ok: true; frozen: unknown; canonical: string; digest: Digest | null } | { ok: false; result: JsonResult<T> } {
  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, result: fail(request, id, 'json.schema', message, meta(bytes, attempts, null)) };
  }
  const digest: Digest | null = request.digest ? (`sha256-${sha256Hex(canonical)}` as Digest) : null;
  const frozen = deepFreeze(value);
  return { ok: true, frozen, canonical, digest };
}

/** The 10-design.md §3.1 pipeline for an `inline` entry. Inline is never cached (§6). */
function resolveInline<T>(request: JsonRequest<T>, id: SourceId, source: Extract<JsonSource, { kind: 'inline' }>, unwrap: Unwrap): JsonResult<T> {
  const location = locationOf(source);
  let value: unknown;
  try {
    value = applyUnwrap(source.data, unwrap);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(request, id, 'json.schema', message, fileMeta(id, location, 0, 0));
  }

  const digested = digestAndFreeze(
    request,
    id,
    value,
    (bytes, attempts, digest) => ({ id, provider: 'inline', location, bytes, digest, cached: false, attempts, validated: false }),
    0,
    0,
  );
  if (!digested.ok) return digested.result;

  const baseMeta: JsonMeta = { id, provider: 'inline', location, bytes: 0, digest: digested.digest, cached: false, attempts: 0, validated: false };
  return assembleValidated(request, id, digested.frozen, baseMeta);
}

interface CacheHit {
  readonly hit: true;
  readonly entry: CacheEntry;
}
interface CacheMiss {
  readonly hit: false;
  readonly stamp: { readonly mtimeMs: number; readonly size: number } | null;
}

/** J10.2, J10.3, D36: stat runs before any read, and is reused as the pre-read stamp on a miss. */
async function checkFileCache(
  id: SourceId,
  path: string,
  location: string,
  policy: CachePolicy,
  ports: JsonPorts,
  cache: CacheManager,
): Promise<CacheHit | CacheMiss> {
  const existing = cache.lookup(id);

  if (policy.kind === 'manual') {
    if (existing && existing.location === location) return { hit: true, entry: existing };
    return { hit: false, stamp: null };
  }

  if (policy.kind === 'ttl') {
    if (existing && existing.location === location && existing.storedAt !== null && ports.clock!() - existing.storedAt < policy.ttlMs) {
      return { hit: true, entry: existing };
    }
    return { hit: false, stamp: null };
  }

  // mtime
  let stamp: { mtimeMs: number; size: number } | null;
  try {
    stamp = await ports.fs!.stat(path);
  } catch {
    stamp = null;
  }
  if (
    existing &&
    existing.location === location &&
    existing.stamp !== null &&
    stamp !== null &&
    existing.stamp.mtimeMs === stamp.mtimeMs &&
    existing.stamp.size === stamp.size
  ) {
    return { hit: true, entry: existing };
  }
  return { hit: false, stamp };
}

/** The shared, per-request-independent half of a file load: fetch, parse, unwrap, domain-check,
 * freeze. This is exactly what a joined caller shares (I17) — digest, validate, and fallback
 * are per-request and run afterward, in `finalizeCore` (§1.4, I15). */
interface CoreSuccess {
  readonly ok: true;
  readonly value: unknown;
  readonly canonical: string;
  readonly bytes: number;
  readonly attempts: number;
}
interface CoreFailure {
  readonly ok: false;
  readonly reason: Exclude<ReasonCode, 'json.ok'>;
  readonly message: string;
  readonly bytes: number;
  readonly attempts: number;
}
export type CoreFetch = CoreSuccess | CoreFailure;

/** What a leader stores in the in-flight map (I17) and a joiner reads back: the shared outcome
 * plus the cache token the leader captured before starting, so a joiner's own digest
 * memoization (below) can tell whether that token is still current. */
export interface CoreJoin {
  readonly fetch: CoreFetch;
  readonly token: CacheToken;
}

async function fetchFileCore(path: string, unwrap: Unwrap, maxBytes: number | undefined, ports: JsonPorts): Promise<CoreFetch> {
  let text: string;
  try {
    text = await ports.fs!.read(path);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const reason: Exclude<ReasonCode, 'json.ok'> = err?.code === 'ENOENT' ? 'json.notFound' : 'json.transport';
    return { ok: false, reason, message: err?.message ?? String(e), bytes: 0, attempts: 1 };
  }

  const bytes = utf8ByteLength(text);
  if (maxBytes !== undefined && bytes > maxBytes) {
    return { ok: false, reason: 'json.tooLarge', message: `file '${path}' is ${bytes} bytes, exceeds maxBytes ${maxBytes}`, bytes, attempts: 1 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'json.parse', message, bytes, attempts: 1 };
  }

  let value: unknown;
  try {
    value = applyUnwrap(parsed, unwrap);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'json.schema', message, bytes, attempts: 1 };
  }

  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'json.schema', message, bytes, attempts: 1 };
  }

  return { ok: true, value: deepFreeze(value), canonical, bytes, attempts: 1 };
}

/**
 * Per-caller finalization of a `CoreFetch` (I15, §1.4): digest, validate, fallback. `token`
 * non-null means this caller may memoize a digest into the cache entry — but only by a guarded
 * `commit`, so a generation that moved on since (invalidate, or a watch, J11.3/J11.4) is not
 * clobbered with a digest computed from stale data (I17).
 */
function finalizeCore<T>(
  request: JsonRequest<T>,
  id: SourceId,
  core: CoreFetch,
  location: string,
  cache: CacheManager | null,
  token: CacheToken | null,
): JsonResult<T> {
  if (!core.ok) {
    return fail(request, id, core.reason, core.message, fileMeta(id, location, core.bytes, core.attempts));
  }

  let digest: Digest | null = null;
  if (request.digest) {
    if (cache && token) {
      const entry = cache.lookup(id);
      if (entry) {
        if (entry.digest === null) {
          const computed = `sha256-${sha256Hex(core.canonical)}` as Digest;
          // Guarded: a no-op, not a clobber, if the generation moved on since `token`.
          if (cache.commit(id, { ...entry, digest: computed }, token)) entry.digest = computed;
        }
        digest = entry.digest ?? (`sha256-${sha256Hex(core.canonical)}` as Digest);
      } else {
        digest = `sha256-${sha256Hex(core.canonical)}` as Digest;
      }
    } else {
      digest = `sha256-${sha256Hex(core.canonical)}` as Digest;
    }
  }

  const baseMeta: JsonMeta = { id, provider: 'file', location, bytes: core.bytes, digest, cached: false, attempts: core.attempts, validated: false };
  return assembleValidated(request, id, core.value, baseMeta);
}

/** A cache hit: validate per call against the shared, already-frozen value (I12, I15). */
function finishFromCache<T>(request: JsonRequest<T>, id: SourceId, entry: CacheEntry, cache: CacheManager): JsonResult<T> {
  let digest = entry.digest;
  if (request.digest && digest === null) {
    // D29: memoize a digest computed from the cached value; never re-transport.
    digest = digestOf(entry.data);
    entry.digest = digest;
    cache.write(id, entry);
  }
  const baseMeta: JsonMeta = {
    id,
    provider: entry.source.kind,
    location: entry.location,
    bytes: entry.bytes,
    digest,
    cached: true,
    attempts: 0,
    validated: false,
  };
  return assembleValidated(request, id, entry.data, baseMeta);
}

/**
 * The 10-design.md §3.1 pipeline. Handles `inline` and `file` entries with the cache (J10) and
 * single-flight coalescing with a generation guard (J11); `http` (J12) is deliberately left
 * unresolved rather than stubbed, per 30-slices.md's out-of-scope notes.
 */
export async function runPipeline<T>(
  request: JsonRequest<T>,
  declared: NormalizedEntry | undefined,
  ports: JsonPorts,
  cache: CacheManager,
  inFlight: InFlightManager<CoreJoin>,
): Promise<JsonResult<T>> {
  const id = request.id;

  const isAdHoc = request.source !== undefined;
  const source = isAdHoc ? normalizeSource(request.source!) : declared?.source;
  if (!id || !source) {
    return fail(request, id, 'json.unresolved', `no source declared for id '${id}'`, emptyMeta(id || ''));
  }

  const unwrap = isAdHoc ? 'none' : (declared?.unwrap ?? 'none');
  const location = locationOf(source);

  if (source.kind === 'inline') {
    return resolveInline(request, id, source, unwrap);
  }

  if (source.kind === 'http') {
    // Out of scope for J10/J11 (30-slices.md): http transport belongs to J12.
    return fail(
      request,
      id,
      'json.unresolved',
      `source '${id}' is 'http', which this build does not implement (see J12)`,
      emptyMeta(id),
    );
  }

  // file
  if (isAdHoc) {
    // I16/J11.5: an ad-hoc request.source is neither read from, written to, cached against,
    // nor joined to or against an in-flight load.
    const core = await fetchFileCore(source.path, unwrap, undefined, ports);
    return finalizeCore(request, id, core, location, null, null);
  }
  // declared is guaranteed defined here: !isAdHoc and source resolved means declared.source did.

  const cacheEligible = request.cache !== false;
  if (!cacheEligible) {
    // A per-call cache opt-out sits outside the cache-key mechanism entirely, so it neither
    // reads a cached entry nor joins an in-flight load keyed on one (mirrors I16 for the same
    // reason: no cache key, nothing to join through).
    const core = await fetchFileCore(source.path, unwrap, declared!.maxBytes, ports);
    return finalizeCore(request, id, core, location, null, null);
  }

  const check = await checkFileCache(id, source.path, location, declared!.cache, ports, cache);
  if (check.hit) {
    cache.recordHit();
    return finishFromCache(request, id, check.entry, cache);
  }
  cache.recordMiss();

  const joined = inFlight.get(id);
  if (joined) {
    const { fetch, token } = await joined;
    return finalizeCore(request, id, fetch, location, cache, token);
  }

  const token = cache.currentToken(id);
  const { fetch, token: settledToken } = await inFlight.run(id, async (): Promise<CoreJoin> => {
    const result = await fetchFileCore(source.path, unwrap, declared!.maxBytes, ports);
    if (result.ok) {
      const entry: CacheEntry = {
        data: result.value,
        source: { kind: 'file', path: source.path },
        location,
        bytes: result.bytes,
        digest: null,
        storedAt: ports.clock ? ports.clock() : null,
        stamp: declared!.cache.kind === 'mtime' ? check.stamp : null,
      };
      // J11.3/I17: on a generation mismatch this is a no-op — the result still reaches every
      // caller below, but nothing is written.
      cache.commit(id, entry, token);
    }
    return { fetch: result, token };
  });
  return finalizeCore(request, id, fetch, location, cache, settledToken);
}
