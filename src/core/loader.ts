import { checkRequiredPorts, normalizeSourceMap } from './config.js';
import { JsonError } from './errors.js';
import { runInlinePipeline } from './pipeline.js';
import type { JsonFailure, JsonLoader, JsonPorts, JsonRequest, JsonResult, SourceId, SourceMap } from './types.js';

function synthesizeRequest<T>(id: SourceId): JsonRequest<T> {
  return { id };
}

/**
 * J1 scope: the inline pipeline only. The cache, the in-flight join, and the http/file
 * provider branches are J10/J12 (30-slices.md) — `stats`, `invalidate`, and `dispose` are
 * therefore trivial here: there is nothing yet for them to report or release.
 */
export function createJsonLoader(sources: SourceMap, ports: JsonPorts = {}): JsonLoader {
  const normalized = normalizeSourceMap(sources);
  checkRequiredPorts(normalized, ports);

  async function load<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const declared = normalized.get(request.id);
    return runInlinePipeline(request, declared);
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

  function invalidate(_id?: SourceId): void {
    // No cache yet (J10). Nothing to invalidate.
  }

  function stats() {
    return { entries: 0, hits: 0, misses: 0 };
  }

  function dispose(): void {
    // No watchers registered yet (J10). Idempotent no-op.
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
