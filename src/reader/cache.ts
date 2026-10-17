/**
 * cache.ts — a tiny insertion-ordered LRU map (platform-free).
 *
 * Used by bookSession for raster metadata (cap ~50 entries). Eviction drops
 * only the in-memory metadata; the on-disk .webp cache is managed by the
 * Storage settings (DESIGN §6.7), not by this map.
 */

export interface LruMap<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  /** Keys from least- to most-recently used. */
  keys(): K[];
}

export function createLru<K, V>(capacity: number): LruMap<K, V> {
  if (!(capacity >= 1)) throw new Error('createLru: capacity must be >= 1');
  const map = new Map<K, V>();

  const touch = (key: K, value: V): void => {
    map.delete(key);
    map.set(key, value);
  };

  return {
    get(key: K): V | undefined {
      const value = map.get(key);
      if (value !== undefined) touch(key, value);
      return value;
    },
    set(key: K, value: V): void {
      touch(key, value);
      while (map.size > capacity) {
        const oldest = map.keys().next().value as K | undefined;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    has(key: K): boolean {
      return map.has(key);
    },
    delete(key: K): boolean {
      return map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    get size(): number {
      return map.size;
    },
    keys(): K[] {
      return [...map.keys()];
    },
  };
}
