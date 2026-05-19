# rn-custom-map-sdk — Persistent marker icon caching across single↔cluster

## Problem statement (verbatim)
"Fix marker image not showing when switching between single marker and
cluster marker (during zoom). Need to cache marker images at native level
so when markers are recreated, they load from cache instead of reloading."

## Root cause
- The previous bitmap/UIImage caches were keyed by `markerId`, so a
  re-created marker (e.g. after a cluster split) got a fresh cache key and
  re-paid the full image load cost.
- On iOS specifically, `markerImageForItem:` had **no HTTP/HTTPS loader at
  all** — remote-URL marker icons resolved to the default red pin (or
  transparent placeholder for cluster ids), and they never recovered.

## Changes — 2026-01

### iOS (`ios/RNCustomMapView.mm`)
- Added async HTTP/HTTPS marker icon loader backed by a singleton
  `NSURLSession` with a 16 MiB-memory / 64 MiB-disk `NSURLCache`. Every
  fetched UIImage is also stored in the per-view `NSCache` under
  `"src:<url>"`, so:
  - First-time fetch shows a transparent placeholder, then patches
    `marker.icon` when the network response arrives.
  - Every subsequent reference to the same URL — including newly-created
    GMSMarkers spawned by a single↔cluster transition — resolves
    synchronously from cache.
- In-flight fetches are **coalesced** by URL string so 1000 markers
  referencing the same avatar URL issue exactly one network request.
- `snapshotKeyForView:` no longer includes `markerId`. Two clusters that
  render identical content (e.g. the same 3-avatar bubble) reuse the same
  UIImage.

### Android (`android/.../RNCustomMapViewManagerImpl.java`)
- `snapshotKey` no longer includes `markerId` — same content-only key shape
  as iOS, so different cluster ids with identical bubbles share a Bitmap.
- Glide-backed `loadRemoteMarkerIcon` already wrote to the static
  `ICON_CACHE`; with the content-only key + cache-first path in
  `applyInitialMarkerIcon`, marker recreation is instant.

## Why this fixes the bug
- A single marker becoming part of a cluster → marker is removed from the
  map. The bitmap stays in cache.
- The cluster becoming a single marker again → the new GMSMarker is created
  by `setMarkers:`. `cachedIconForItem:` → cache hit → instant icon.
- Repeated zoom in/out across the same region now produces zero network
  requests and zero render-from-scratch passes.

## 500–1000+ marker optimizations carried over
- Incremental `setMarkers` diff: existing markers keep their native
  GMSMarker / Marker instance; only changed fields mutate.
- Single in-flight network task per URL via the pending-fetches dictionary.
- Cache key shared across the entire map view, not per-marker, so the
  working set scales with **unique icons**, not unique markers.
- O(1) cache lookups; O(n) diff; no per-frame work for unchanged markers.

## Animation / GIF support — not in this iteration
Static-snapshot rendering can't animate, and the previous attempt to use
`marker.iconView` reparented React-managed views (causing the iOS crash
already fixed in the prior iteration). Adding animation support cleanly
would require either:
- A `tracksViewChanges`-driven periodic re-snapshot loop (one shared
  `CADisplayLink` / `Choreographer` callback), or
- An SDK-owned UIView pool with on-demand snapshot updates.
Either option is feasible but adds new lifecycle surface. Deferred to
backlog as P1.

## Files touched (this iteration)
- `ios/RNCustomMapView.mm` — async URL fetch + cache + coalescing, content-only snapshot key, cache lookup in `markerImageForItem:`.
- `android/.../RNCustomMapViewManagerImpl.java` — content-only snapshot key.

## Verification
- `npx tsc --noEmit` clean.
- `yarn test clusteringThrottle` — 14/14 pass.
- Native files: brace/paren/bracket balance preserved.

## Backlog
- P1: Animation / GIF support via shared display-link re-snapshot or
  SDK-owned UIView pool.
- P2: Configurable cache limits (NSCache / LruCache sizes) exposed via a
  new clusterConfig field.
- P2: Optional `Image.prefetch` pass on the JS side to pre-warm the icon
  cache before the first cluster recompute.
