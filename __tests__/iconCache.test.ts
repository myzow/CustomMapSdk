/**
 * @format
 */

import {
  IconCache,
  shouldShowPlaceholder,
  ICON_CACHE_DEFAULTS,
} from '../externalModules/rn-custom-map-sdk/src/clustering/iconCache';

describe('IconCache', () => {
  test('starts empty', () => {
    const cache = new IconCache();
    expect(cache.size()).toBe(0);
    expect(cache.get('https://x.png')).toBeUndefined();
  });

  test('beginPrefetch records a pending entry on first call', () => {
    const cache = new IconCache();
    expect(cache.beginPrefetch('a', 1000)).toBe(true);
    const e = cache.get('a')!;
    expect(e.state).toBe('pending');
    expect(e.attempts).toBe(1);
    expect(e.startedAt).toBe(1000);
  });

  test('beginPrefetch is a no-op when entry is already loaded', () => {
    const cache = new IconCache();
    cache.beginPrefetch('a', 1000);
    cache.markLoaded('a', 1100);
    expect(cache.beginPrefetch('a', 2000)).toBe(false);
    const e = cache.get('a')!;
    expect(e.state).toBe('loaded');
    expect(e.attempts).toBe(1); // no extra attempt
  });

  test('beginPrefetch is a no-op when a pending request is in flight', () => {
    const cache = new IconCache();
    cache.beginPrefetch('a', 1000);
    expect(cache.beginPrefetch('a', 1050)).toBe(false);
    const e = cache.get('a')!;
    expect(e.attempts).toBe(1);
  });

  test('beginPrefetch after a failure switches state to retrying and bumps attempts', () => {
    const cache = new IconCache();
    cache.beginPrefetch('a', 1000);
    cache.markFailed('a', 1100);
    expect(cache.beginPrefetch('a', 2000)).toBe(true);
    const e = cache.get('a')!;
    expect(e.state).toBe('retrying');
    expect(e.attempts).toBe(2);
  });

  test('retriableUrls lists only failures within the attempt budget', () => {
    const cache = new IconCache({ maxAttempts: 2 });
    cache.beginPrefetch('a', 1000);
    cache.markFailed('a', 1100); // attempts=1 → still retriable
    cache.beginPrefetch('b', 1000);
    cache.markLoaded('b', 1100);
    expect(cache.retriableUrls()).toEqual(['a']);
    cache.beginPrefetch('a', 1200); // now attempts=2 → at the limit
    cache.markFailed('a', 1300);
    expect(cache.retriableUrls()).toEqual([]);
  });

  test('LRU eviction kicks in past maxEntries', () => {
    const cache = new IconCache({ maxEntries: 2 });
    cache.beginPrefetch('a', 1);
    cache.beginPrefetch('b', 2);
    cache.beginPrefetch('c', 3);
    expect(cache.size()).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  test('get() promotes an entry to most-recently-used', () => {
    const cache = new IconCache({ maxEntries: 2 });
    cache.beginPrefetch('a', 1);
    cache.beginPrefetch('b', 2);
    // Touch 'a' to promote it; then add 'c' — 'b' should be evicted.
    cache.get('a');
    cache.beginPrefetch('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  test('clear() wipes everything', () => {
    const cache = new IconCache();
    cache.beginPrefetch('a', 1);
    cache.beginPrefetch('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  test('stats() reports counts per state', () => {
    const cache = new IconCache();
    cache.beginPrefetch('a', 1); // pending
    cache.beginPrefetch('b', 1); // pending
    cache.markLoaded('b', 2);    // → loaded
    cache.beginPrefetch('c', 1);
    cache.markFailed('c', 2);    // → failed
    const stats = cache.stats();
    expect(stats.size).toBe(3);
    expect(stats.loaded).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(1);
  });
});

describe('shouldShowPlaceholder', () => {
  const fallbackMs = ICON_CACHE_DEFAULTS.fallbackTimeoutMs; // 500

  test('no entry → show placeholder', () => {
    expect(shouldShowPlaceholder(undefined, 1000, fallbackMs)).toBe(true);
  });

  test('loaded entry → never placeholder', () => {
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'loaded', startedAt: 0, attempts: 1 },
        9999,
        fallbackMs,
      ),
    ).toBe(false);
  });

  test('failed entry → placeholder', () => {
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'failed', startedAt: 0, attempts: 1 },
        100,
        fallbackMs,
      ),
    ).toBe(true);
  });

  test('pending under the deadline → real icon (no placeholder)', () => {
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'pending', startedAt: 1000, attempts: 1 },
        1200, // 200 ms elapsed
        fallbackMs,
      ),
    ).toBe(false);
  });

  test('pending past the deadline → placeholder', () => {
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'pending', startedAt: 1000, attempts: 1 },
        1600, // 600 ms elapsed
        fallbackMs,
      ),
    ).toBe(true);
  });

  test('retrying state respects the same deadline', () => {
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'retrying', startedAt: 1000, attempts: 2 },
        1100,
        fallbackMs,
      ),
    ).toBe(false);
    expect(
      shouldShowPlaceholder(
        { url: 'x', state: 'retrying', startedAt: 1000, attempts: 2 },
        1700,
        fallbackMs,
      ),
    ).toBe(true);
  });
});
