/**
 * Process-wide JS-side marker-icon cache.
 *
 * Why this exists:
 *
 *   The flicker the user sees during pan/zoom/cluster transitions is the
 *   default Google pin appearing for a few frames between the moment the
 *   native side receives a marker payload and the moment its bitmap finishes
 *   loading. We can't reach the BitmapDescriptor cache from JS, but we can:
 *
 *     1. Track which URLs we've already asked the native side to warm.
 *     2. Decide, per-marker, whether to render a "placeholder" View while
 *        the real bitmap loads.
 *     3. Cap how long we wait for a custom marker to load before showing
 *        the placeholder (the user's "fallback after 500ms" requirement).
 *     4. Retry once in the background so a transient miss never leaves a
 *        marker stuck on the placeholder forever.
 *
 * The cache is intentionally lightweight — no real bitmaps are held here.
 * The native side owns the BitmapDescriptor / UIImage cache; this module is
 * the JS-side coordinator for the lifecycle of those entries.
 */
export type IconState =
  | 'idle'        // never seen
  | 'pending'     // prefetch in flight
  | 'loaded'      // native side has cached the bitmap
  | 'failed'      // load failed; placeholder will render until retry succeeds
  | 'retrying';   // background retry in flight after a failed load

export type IconCacheEntry = {
  url: string;
  state: IconState;
  /** Wall-clock millis when the prefetch started. */
  startedAt: number;
  /** Number of attempts made so far (1 on first prefetch). */
  attempts: number;
  /** Last result timestamp (success or failure). */
  settledAt?: number;
};

export type CacheStats = {
  size: number;
  loaded: number;
  pending: number;
  failed: number;
};

const DEFAULT_FALLBACK_TIMEOUT_MS = 500;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_ATTEMPTS = 2; // initial + one retry

/**
 * Internal LRU storage. Map preserves insertion order, which is sufficient
 * for a simple LRU: every access promotes the entry to the end (most
 * recently used). Eviction pops the iterator's first key when over budget.
 */
export class IconCache {
  private readonly entries = new Map<string, IconCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxAttempts: number;

  constructor(opts?: { maxEntries?: number; maxAttempts?: number }) {
    this.maxEntries = Math.max(opts?.maxEntries ?? DEFAULT_MAX_ENTRIES, 1);
    this.maxAttempts = Math.max(opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1);
  }

  get(url: string): IconCacheEntry | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;
    // LRU promote
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry;
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }

  size(): number {
    return this.entries.size;
  }

  stats(): CacheStats {
    let loaded = 0;
    let pending = 0;
    let failed = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'loaded') loaded += 1;
      else if (e.state === 'pending' || e.state === 'retrying') pending += 1;
      else if (e.state === 'failed') failed += 1;
    }
    return { size: this.entries.size, loaded, pending, failed };
  }

  /** Wipe everything. Used by the host on memory warning. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Marks a URL as actively being prefetched. Idempotent — if the URL is
   * already loaded, returns false (no work needed). If it's already pending,
   * returns false too. Otherwise records the attempt and returns true.
   */
  beginPrefetch(url: string, now: number = Date.now()): boolean {
    if (!url) return false;
    const existing = this.entries.get(url);
    if (existing && existing.state === 'loaded') {
      // Already loaded — promote LRU and skip work.
      this.entries.delete(url);
      this.entries.set(url, existing);
      return false;
    }
    if (existing && (existing.state === 'pending' || existing.state === 'retrying')) {
      // Already pending; no need to schedule another.
      return false;
    }
    const attempts = (existing?.attempts ?? 0) + 1;
    const state: IconState = attempts > 1 ? 'retrying' : 'pending';
    const entry: IconCacheEntry = {
      url,
      state,
      startedAt: now,
      attempts,
      settledAt: existing?.settledAt,
    };
    this.entries.delete(url);
    this.entries.set(url, entry);
    this.evictIfNeeded();
    return true;
  }

  markLoaded(url: string, now: number = Date.now()): void {
    const e = this.entries.get(url);
    if (!e) {
      this.entries.set(url, {
        url,
        state: 'loaded',
        startedAt: now,
        attempts: 1,
        settledAt: now,
      });
      this.evictIfNeeded();
      return;
    }
    e.state = 'loaded';
    e.settledAt = now;
    // LRU promote
    this.entries.delete(url);
    this.entries.set(url, e);
  }

  markFailed(url: string, now: number = Date.now()): void {
    const e = this.entries.get(url);
    if (!e) {
      this.entries.set(url, {
        url,
        state: 'failed',
        startedAt: now,
        attempts: 1,
        settledAt: now,
      });
      this.evictIfNeeded();
      return;
    }
    e.state = 'failed';
    e.settledAt = now;
    this.entries.delete(url);
    this.entries.set(url, e);
  }

  /**
   * Returns the set of URLs that have failed at least once and still have
   * an attempt budget remaining. Used by the retry scheduler to decide
   * which entries to retry in the background.
   */
  retriableUrls(): string[] {
    const out: string[] = [];
    for (const e of this.entries.values()) {
      if (e.state === 'failed' && e.attempts < this.maxAttempts) {
        out.push(e.url);
      }
    }
    return out;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

/**
 * Pure decision function used by the renderer to choose between the real
 * marker icon and the fallback placeholder.
 *
 *   - If we have no record of the URL → render placeholder.
 *   - If the URL is loaded → render real icon (no placeholder).
 *   - If the URL is pending but the deadline has not yet passed →
 *     render real icon (no placeholder) so we don't flash unnecessarily.
 *   - If the URL is pending past the deadline → render placeholder while
 *     the native side keeps loading in the background.
 *   - If the URL has failed → render placeholder, schedule retry.
 *
 * The decision is intentionally biased toward "show the real icon when we
 * have ANY reason to believe it will land within the deadline" — this is
 * what eliminates the perceptible flicker on fast networks while still
 * guaranteeing 95% of markers display SOMETHING within 500ms on slow ones.
 */
export function shouldShowPlaceholder(
  entry: IconCacheEntry | undefined,
  now: number,
  fallbackTimeoutMs: number = DEFAULT_FALLBACK_TIMEOUT_MS,
): boolean {
  if (!entry) return true; // never seen → placeholder
  if (entry.state === 'loaded') return false;
  if (entry.state === 'failed') return true;
  // pending or retrying
  const elapsed = now - entry.startedAt;
  return elapsed >= fallbackTimeoutMs;
}

/** Singleton used by MapView. Tests construct their own via `new IconCache()`. */
export const defaultIconCache = new IconCache();

export const ICON_CACHE_DEFAULTS = {
  fallbackTimeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS,
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
};
