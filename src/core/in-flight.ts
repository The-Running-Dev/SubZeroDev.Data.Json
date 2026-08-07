import type { SourceId } from './types.js';

/**
 * Keyed by cache key (source id) exactly as `10-design.md` §5 describes: the first miss
 * starts the load and registers its promise here; concurrent misses for the same id join it
 * instead of issuing their own transport (I17). Never consulted for an ad-hoc `request.source`
 * (I16, J11.5) — callers on that path skip this manager entirely.
 */
export interface InFlightManager<T> {
  get(id: SourceId): Promise<T> | undefined;
  /** Registers `start()`'s promise before it can be observed by a joiner, then runs it. */
  run(id: SourceId, start: () => Promise<T>): Promise<T>;
}

export function createInFlightManager<T>(): InFlightManager<T> {
  const map = new Map<SourceId, Promise<T>>();

  return {
    get(id) {
      return map.get(id);
    },
    run(id, start) {
      const promise = start().finally(() => {
        if (map.get(id) === promise) map.delete(id);
      });
      map.set(id, promise);
      return promise;
    },
  };
}
