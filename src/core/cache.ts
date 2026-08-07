import type { CacheEntry, CacheStore } from './types.js';

/**
 * Default `CacheStore` used when no `ports.cache` is supplied. Plain in-memory map — the
 * cache is per loader, per process, never persisted (`10-design.md` §5).
 */
class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.map.set(key, entry);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export function createMemoryCacheStore(): CacheStore {
  return new MemoryCacheStore();
}
