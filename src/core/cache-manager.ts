import { createMemoryCacheStore } from './cache.js';
import type { CacheEntry, CacheStore, JsonPorts, SourceId } from './types.js';

/**
 * Namespaces one loader's cache keys within a possibly-shared `CacheStore` (D35, I29): a
 * per-instance id plus an epoch that `invalidate()` (no id) bumps. Bumping the epoch orphans
 * every existing key this loader owns — including one for an id that never finished writing
 * an entry — without needing `CacheStore` to expose enumeration (D35 rejected `keys()`).
 *
 * `generation` adds the per-id half of the same idea for J11: `invalidate(id)` bumps one id's
 * generation without touching the epoch, so a load that captured a token before either kind of
 * invalidate can tell, at commit time, that it lost the race (I17).
 */
export interface CacheManager {
  readonly store: CacheStore;
  lookup(id: SourceId): CacheEntry | undefined;
  write(id: SourceId, entry: CacheEntry): void;
  /** The token an in-flight load stamps itself with before starting transport (I17). */
  currentToken(id: SourceId): CacheToken;
  /** Writes only if `token` still matches; returns whether it wrote. */
  commit(id: SourceId, entry: CacheEntry, token: CacheToken): boolean;
  dropOne(id: SourceId): void;
  dropAll(): void;
  recordHit(): void;
  recordMiss(): void;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
}

export interface CacheToken {
  readonly epoch: number;
  readonly generation: number;
}

let nextInstanceId = 0;

export function createCacheManager(ports: JsonPorts): CacheManager {
  const store = ports.cache ?? createMemoryCacheStore();
  const instanceId = nextInstanceId++;
  let epoch = 0;
  const owned = new Set<SourceId>();
  const generations = new Map<SourceId, number>();
  let hits = 0;
  let misses = 0;

  const generationOf = (id: SourceId): number => generations.get(id) ?? 0;
  const keyOf = (id: SourceId): string => `${instanceId}:${epoch}:${generationOf(id)}:${id}`;

  return {
    store,
    lookup(id) {
      return store.get(keyOf(id));
    },
    write(id, entry) {
      store.set(keyOf(id), entry);
      owned.add(id);
    },
    currentToken(id) {
      return { epoch, generation: generationOf(id) };
    },
    commit(id, entry, token) {
      if (token.epoch !== epoch || token.generation !== generationOf(id)) return false;
      store.set(keyOf(id), entry);
      owned.add(id);
      return true;
    },
    dropOne(id) {
      store.delete(keyOf(id));
      owned.delete(id);
      generations.set(id, generationOf(id) + 1);
    },
    dropAll() {
      for (const id of owned) store.delete(keyOf(id));
      owned.clear();
      generations.clear();
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
