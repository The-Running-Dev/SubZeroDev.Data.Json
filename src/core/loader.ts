import { createCacheManager } from './cache-manager.js';
import { checkRequiredPorts, normalizeSourceMap } from './config.js';
import { JsonError } from './errors.js';
import { createInFlightManager } from './in-flight.js';
import { runPipeline } from './pipeline.js';
import type { CoreJoin } from './pipeline.js';
import type { JsonFailure, JsonLoader, JsonPorts, JsonRequest, JsonResult, SourceId, SourceMap } from './types.js';

function synthesizeRequest<T>(id: SourceId): JsonRequest<T> {
  return { id };
}

/**
 * J1 scope was the inline pipeline only. J10 added the cache and file sources through
 * `ports.fs`, and J11 adds single-flight coalescing with a generation guard (30-slices.md).
 * http transport (J12) remains out of scope here.
 */
export function createJsonLoader(sources: SourceMap, ports: JsonPorts = {}): JsonLoader {
  const normalized = normalizeSourceMap(sources);
  checkRequiredPorts(normalized, ports);

  const cache = createCacheManager(ports);
  const inFlight = createInFlightManager<CoreJoin>();

  // I26/D31: a watch is registered lazily, on the first successful read of a file entry
  // declaring an `mtime` policy, never at construction.
  const watchedIds = new Set<SourceId>();
  const unsubscribers: Array<() => void> = [];

  function maybeRegisterWatch(id: SourceId, request: JsonRequest<unknown>, result: JsonResult<unknown>): void {
    if (!result.ok || result.meta.cached || result.meta.provider !== 'file') return;
    if (request.source !== undefined) return; // ad-hoc sources are never cached, so never watched
    if (watchedIds.has(id)) return;
    const declared = normalized.get(id);
    if (!declared || declared.cache.kind !== 'mtime' || declared.source.kind !== 'file') return;
    if (!ports.fs?.watch) return;

    watchedIds.add(id);
    const unsubscribe = ports.fs.watch(declared.source.path, () => cache.dropOne(id));
    unsubscribers.push(unsubscribe);
  }

  async function load<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const declared = normalized.get(request.id);
    const result = await runPipeline(request, declared, ports, cache, inFlight);
    maybeRegisterWatch(request.id, request, result);
    return result;
  }

  async function loadById<T>(id: SourceId): Promise<JsonResult<T>> {
    return load(synthesizeRequest<T>(id));
  }

  async function loadMany(ids: readonly SourceId[]): Promise<Readonly<Record<SourceId, JsonResult<unknown>>>> {
    const results = await Promise.all(ids.map((id) => loadById<unknown>(id)));
    const out: Record<SourceId, JsonResult<unknown>> = {};
    ids.forEach((id, i) => {
      out[id] = results[i]!;
    });
    return out;
  }

  async function preload(ids: readonly SourceId[]): Promise<void> {
    const results = await Promise.all(ids.map((id) => loadById<unknown>(id)));
    const failures: JsonFailure[] = [];
    ids.forEach((id, i) => {
      const result = results[i]!;
      if (!result.ok) {
        failures.push({ id, reason: result.reason, message: result.message });
      }
    });
    if (failures.length > 0) {
      throw new JsonError(
        'preload.failed',
        `preload failed for ${failures.length} source(s): ${failures.map((f) => f.id).join(', ')}`,
        failures,
      );
    }
  }

  function invalidate(id?: SourceId): void {
    if (id !== undefined) {
      cache.dropOne(id);
    } else {
      cache.dropAll();
    }
  }

  function stats() {
    return { entries: cache.entries, hits: cache.hits, misses: cache.misses };
  }

  function dispose(): void {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    watchedIds.clear();
    cache.dropAll();
  }

  const loader: JsonLoader = {
    load,
    loadById,
    loadMany,
    preload,
    invalidate,
    stats,
    dispose,
    [Symbol.dispose]: dispose,
  };

  return loader;
}
