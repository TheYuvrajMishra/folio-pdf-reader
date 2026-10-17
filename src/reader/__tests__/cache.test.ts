/**
 * cache.test.ts — LRU eviction behavior.
 */
import { createLru } from '../cache';

describe('createLru', () => {
  it('evicts the least-recently-used entry past capacity', () => {
    const lru = createLru<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.set('d', 4); // evicts 'a'
    expect(lru.has('a')).toBe(false);
    expect(lru.has('b')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.has('d')).toBe(true);
    expect(lru.size).toBe(3);
  });

  it('a get() refreshes recency', () => {
    const lru = createLru<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.get('a')).toBe(1); // 'a' now most recent
    lru.set('d', 4); // evicts 'b'
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
    expect(lru.keys()).toEqual(['c', 'a', 'd']);
  });

  it('re-setting an existing key refreshes it without growing', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 10); // refresh, no eviction
    expect(lru.size).toBe(2);
    expect(lru.get('a')).toBe(10);
    lru.set('c', 3); // evicts 'b'
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
  });

  it('get() on a missing key returns undefined without side effects', () => {
    const lru = createLru<string, number>(2);
    expect(lru.get('nope')).toBeUndefined();
    expect(lru.size).toBe(0);
  });

  it('delete() and clear() work', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.delete('a')).toBe(true);
    expect(lru.has('a')).toBe(false);
    expect(lru.delete('a')).toBe(false);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.keys()).toEqual([]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => createLru(0)).toThrow();
  });

  it('keys() reports least- to most-recently-used order', () => {
    const lru = createLru<string, number>(4);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.get('b');
    expect(lru.keys()).toEqual(['a', 'c', 'b']);
  });
});
