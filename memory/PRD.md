# rn-custom-map-sdk — Native fixes (Issue 1 + Issue 2)

## Problem statements (verbatim)
**Issue 1 (iOS):** crash "Attempt to unmount a view which is mounted inside
different view" on zoom/drag. Cause: marker snapshot UIViews reparented onto
GMSMapView, then unmounted from the wrong parent on the React side.

**Issue 2 (Android & iOS):** custom markers briefly show the default Google
Maps pin before swapping to the custom icon on every zoom/cluster recompute.
Single markers should not re-render at all on zoom; clustered markers should
re-render but show the custom icon instantly.

## Architecture / changes — 2026-01

### iOS (`ios/RNCustomMapView.mm`)
- **Issue 1 fix**: `setMarkerView:` no longer assigns `marker.iconView`. It
  takes a `UIImage` snapshot of the React view (`drawViewHierarchyInRect`)
  and assigns it to `marker.icon`. The React view stays under its original
  parent, so reconciler unmounts are safe.
- **Issue 2 fix**: rewrote `setMarkers:` from full destroy-and-rebuild to an
  incremental id-based diff. Existing markers keep their GMSMarker instance;
  only position/title/icon-on-key-change are mutated. Singleton markers
  therefore stay visually frozen on zoom.
- New `NSCache<NSString *, UIImage *> markerIconCache` keyed by
  `"src:<source>"` / `"pin:<color>"` / `"cluster:placeholder"` /
  `"view:<markerId>:<sig>"`. Cache eliminates the redraw cost.
- Cluster synthetic markers (id starts with `cluster:`) spawn with a static
  transparent 1×1 placeholder image so the GMS default pin never flashes
  while the JS snapshot is being painted.
- Snapshot key uses geometry + subview signature — re-clustering at the same
  zoom level reuses the cached bitmap.

### Android (`android/.../RNCustomMapViewManagerImpl.java`)
- Static `LruCache<String, Bitmap> ICON_CACHE` (4 MiB) with the same key
  shape as iOS.
- Rewrote `setMarkers` to the same id-based incremental diff: keep, update
  position only when changed, only call `setIcon` when the icon cache key
  changes.
- `loadRemoteMarkerIcon` now applies cached bitmaps synchronously when
  available, then skips Glide; populates the cache on first fetch. Re-mounts
  of clustered markers therefore appear with the correct image immediately.
- `setMarkerView` caches the rendered bitmap by `view:<markerId>:<sig>` and
  only calls `setIcon` when the snapshot signature actually changed.
- Cluster-prefixed markers receive a transparent 1×1 placeholder bitmap on
  spawn (mirrors the iOS placeholder).
- `RNCustomMapView` gains a `markerIconKeys: Map<String,String>` field used
  by the ManagerImpl to decide whether `setIcon` is needed on a diff pass.

### JS layer
- No changes required. The existing id stability for passthrough markers
  combined with native incremental diffing already gives "single markers
  never re-render on zoom".

## Files touched (this iteration)
- `externalModules/rn-custom-map-sdk/ios/RNCustomMapView.mm`
- `externalModules/rn-custom-map-sdk/android/src/main/java/com/rncustommap/RNCustomMapView.java`
- `externalModules/rn-custom-map-sdk/android/src/main/java/com/rncustommap/RNCustomMapViewManagerImpl.java`

## Verification
- `npx tsc --noEmit` ✓ clean (no JS-side ripples).
- `yarn test clusteringThrottle` ✓ 14/14 still pass.
- Bracket / paren balance check passes on both native files.
- Native compilation requires a real Xcode / Android Studio toolchain (not
  available in this sandbox); the changes follow existing patterns in the
  file and use only documented SDK APIs (`UIGraphicsImageRenderer`,
  `drawViewHierarchyInRect`, `LruCache`, `BitmapDescriptorFactory`,
  `MarkerOptions.getIcon`).

## Backlog
- P1: Add an LRU eviction signal so very long-running maps don't grow the
  iOS NSCache forever (currently bounded only by `countLimit = 256`).
- P2: Pre-warm remote icon bitmaps on the JS side before clusters update
  (e.g. an `Image.prefetch(...)` pass on visible markers).
- P2: Cluster bitmap *content* cache (independent of marker id) so two
  different cluster ids holding identical content reuse the same Bitmap.
