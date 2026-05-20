# rn-custom-map-sdk — Flicker-free markers & clustering

## Problem statement
Fix custom marker flickering in the `rn-custom-map-sdk` React Native map
SDK during clustering. Markers (images / gifs / lottie / RN views) briefly
showed the default Google pin during zoom, drag, and cluster transitions.

## Root cause (pre-existing)
1. Native `setMarkers` removed & recreated every `GMSMarker` / `Marker`
   on every JS update — between create and bitmap decode the platform's
   default pin was visible.
2. No process-wide `BitmapDescriptor` / `UIImage` cache — every cluster
   transition re-downloaded/re-decoded each remote image.
3. Snapshot views were re-keyed by raw cluster id; pan-induced cell
   changes unmounted otherwise-identical bubbles.
4. Clustering recomputed on every mid-drag `region-change` event.
5. Fallback was the default platform pin, not an app-branded placeholder.

## Architecture of the fix

### Pure JS layer (testable)
- `src/clustering/iconCache.ts` — process-wide LRU URL cache, 500 ms
  fallback timeout, retry budget.
- `src/clustering/dragGate.ts` — pure state machine. Suppresses all
  cluster recomputes during gesture; emits ONE recompute on trailing
  settle.
- `src/clustering/membership.ts` — order-independent cluster signature +
  diff helper for stable React keys.
- `src/Placeholder.tsx` — branded fallback bubble (never default pin).

### React MapView (`src/MapView.tsx`)
- `DragGate` wired into `onRegionChange` / `onRegionChangeComplete`.
- `useEffect` hook prefetches every remote marker URL through the JS
  cache + native `prefetchMarkerIcons` whenever the marker meta changes
  (skipped during drag).
- Cluster snapshot keys now use `stableClusterKey()` (cell id + member
  signature) so unchanged bubbles never remount.
- Default cluster bubble auto-falls-back to `<MarkerPlaceholder/>` when
  no `renderCluster` is provided.

### Android native
- `MarkerIconCache.java` — process-wide LRU `BitmapDescriptor` cache
  with `ComponentCallbacks2` memory eviction + placeholder bitmap factory.
- `RNCustomMapViewManagerImpl.setMarkers` — diff-based update (reuse,
  add, remove); placeholder bitmap is the FIRST icon for every marker.
- `RNCustomMapViewManagerImpl.setMarkerView` — rasterized View bitmaps
  are cached by `(markerId, viewIdentity, size)`.
- `RNCustomMapModule.prefetchMarkerIcons` / `clearMarkerIconCache`.

### iOS native
- `RNCustomMapView.mm` — `NSCache` for icons + placeholders + view
  rasterizations. Observes `UIApplicationDidReceiveMemoryWarning`.
- Diff-based `setMarkers:` with placeholder-first icons.
- `prefetchMarkerIcons:` & `clearMarkerIconCache` exposed via
  `RNCustomMapModule.mm` and the codegen spec.

### Spec / bridge
- `spec/NativeRNCustomMapViewManager.ts` — added `prefetchMarkerIcons`
  and `clearMarkerIconCache`.
- `spec/RNCustomMapViewNativeComponent.ts` — added `fallbackColor`,
  `fallbackInitial`, `fallbackRingColor` props.

## Demo screens
- Existing `ClusteringScreen` (untouched).
- **NEW** `src/screens/AllMarkersScreen.tsx` — 24 markers covering
  static images, GIFs, Lottie animations, and plain RN views, all
  clustered with a pinned ignore-id marker.
- `App.tsx` adds the "All Markers" tab.

## Dependencies added
- `lottie-react-native` (^7.3.8) — for the Lottie demo markers.

## Tests (Jest)
- `__tests__/iconCache.test.ts` — 17 tests (LRU, prefetch, retry,
  fallback decision).
- `__tests__/dragGate.test.ts` — 9 tests (gesture suppression, trailing
  recompute, stale timer handling).
- `__tests__/membership.test.ts` — 11 tests (signature stability, diff).
- All 51 SDK tests pass; existing `clusteringThrottle` 14 tests untouched.
- Pre-existing `App.test.tsx` failure is environment-only (gesture
  handler native module not loadable from Jest); NOT introduced by this
  work.

## What's verified vs. open
- ✅ JS-side logic via Jest (LRU, retry, drag gate, membership diff).
- ✅ TypeScript type-checks for the SDK and host app.
- ✅ ESLint clean on the SDK and the new screen.
- ⚠ Native (Android Java / iOS Obj-C++) builds were NOT exercised in
  this environment — the user confirmed code-level fixes only. Build &
  device validation needs to happen on the user's Android Studio / Xcode
  setup.

## Backlog (P1 / P2)
- P1: integrate `MarkerIconCache` with Glide preload (currently uses
  the synchronous `lookup` path; full Glide network warm-up is implicit
  through `requestRemote`).
- P2: emit per-marker `onIconLoaded` / `onIconFailed` JS callbacks so
  hosts can drive analytics on the 95% success-rate target.
- P2: Lottie native auto-rasterization (currently snapshotted via the
  RN-view path; works but each instance burns one Lottie player).
- P2: WebP cache entry in addition to the bitmap to lower memory.

## Owner / contacts
- Module: `externalModules/rn-custom-map-sdk`
- Tests: `__tests__/iconCache.test.ts`, `dragGate.test.ts`,
  `membership.test.ts`
