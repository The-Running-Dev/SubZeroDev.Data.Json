import { createMemoryCacheStore } from './cache.js';
import type { CacheEntry, CacheStore, JsonPorts, SourceId } from './types.js';

/**
 * Namespaces one loader's cache keys within a possibly-shared `CacheStore` (D35, I29): a
 * per-instance id plus an epoch that `invalidate()` (no id) bumps. Bumping the epoch orphans
 * every existing key this loader owns — including one for an id that never finished writing
 * an entry — without needing `CacheStore` to expose enumeration (D35 rejected `keys()`).
 */
export interface CacheManager {
  readonly store: CacheStore;
  lookup(id: SourceId): CacheEntry | undefined;
  write(id: SourceId, entry: CacheEntry): void;
  dropOne(id: SourceId): void;
  dropAll(): void;
  recordHit(): void;
  recordMiss(): void;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
}

let nextInstanceId = 0;

export function createCacheManager(ports: JsonPorts): CacheManager {
  const store = ports.cache ?? createMemoryCacheStore();
  const instanceId = nextInstanceId++;
  let epoch = 0;
  const owned = new Set<SourceId>();
  let hits = 0;
  let misses = 0;

  const keyOf = (id: SourceId): string => `${instanceId}:${epoch}:${id}`;

  return {
    store,
    lookup(id) {
      return store.get(keyOf(id));
    },
    write(id, entry) {
      store.set(keyOf(id), entry);
      owned.add(id);
    },
    dropOne(id) {
      store.delete(keyOf(id));
      owned.delete(id);
    },
    dropAll() {
      for (const id of owned) store.delete(keyOf(id));
      owned.clear();
      epoch++;
    },
    recordHit() {
      hits++;
    },
    recordMiss() {
      misses++;
    },
    get entries() {
      return owned.size;
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
  };
}
