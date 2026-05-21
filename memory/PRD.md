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

---

# Feature: `<AdvancedMarker>` (Jan 2026)

## Problem statement (verbatim)
Create a new, cross-platform AdvancedMarker component for `rn-custom-map-sdk`
using Google Maps Advanced Markers with full clustering support.

- New `<AdvancedMarker>` as a separate component (existing `<Marker>` untouched).
- Children → custom advanced marker (rendered as native iconView, not a bitmap).
- No children → default Google pin honoring `pinColor`, `title`, `description`.
- Must integrate with the existing `clusterConfig` pipeline.
- Android: AdvancedMarkerOptions + PinConfig, ClusterManager<AdvancedMarkerOptions>.
- iOS: GMSAdvancedMarker with iconView; GMUClusterManager available.
- Both: require a valid `mapId` (default `"DEMO_MAP_ID"`).

## What was implemented

### JS layer
- `src/AdvancedMarker.tsx` — new virtual component (forwardRef, displayName
  `RNCustomMapAdvancedMarker`).
- `src/types.ts` — `AdvancedMarkerProps`, `AdvancedMarkerMethods`,
  `NativeAdvancedMarker`; `mapId` added to `MapViewProps`.
- `src/MapView.tsx` — extends `parseChildren` to detect both `<Marker>`
  and `<AdvancedMarker>` separately. Builds a parallel pipeline:
  separate clusterable / passthrough split, separate cluster cache, and a
  separate snapshot root that calls the new `setAdvancedMarkerView` so
  children are bound as native iconView (no bitmap rasterization). Cluster
  bubble ids use the `acluster:` prefix; marker press dispatcher recognises
  both prefixes.
- `index.tsx` / `index.d.ts` — re-export `AdvancedMarker`.

### Codegen spec
- `spec/RNCustomMapViewNativeComponent.ts` — adds `advancedMarkers`
  array and `mapId` props on the native component.
- `spec/NativeRNCustomMapViewManager.ts` — adds `setAdvancedMarkerView`
  TurboModule command.

### Android
- `android/src/main/java/com/rncustommap/RNAdvancedMarkers.java` — new
  pipeline class. Lazily creates a `ClusterManager<RNAdvancedClusterItem>`
  from `com.google.maps.android:android-maps-utils:3.8.2` (per spec) and
  routes advanced markers through its `MarkerManager.Collection` so click
  semantics are preserved. JS pre-clusters; the renderer's
  `setMinClusterSize(Integer.MAX_VALUE)` prevents native re-clustering.
- `RNCustomMapView.java` — constructs the `MapView` with `GoogleMapOptions().mapId("DEMO_MAP_ID")`,
  hosts the `advancedState`, splits marker click handling into a composite
  router that restores classic clicks after `ClusterManager` grabs the
  listener.
- `RNCustomMapViewManagerImpl.java` — adds `setAdvancedMarkers` /
  `setMapId` delegates.
- `RNCustomMapViewManager.java` — registers `@ReactProp("advancedMarkers")`
  and `@ReactProp("mapId")`.
- `RNCustomMapModule.java` — implements `setAdvancedMarkerView` calling
  into `RNAdvancedMarkers.setIconView`.
- `android/build.gradle` — adds `com.google.maps.android:android-maps-utils:3.8.2`.

### iOS
- `RNCustomMapView.h` / `.mm` — adds `advancedMarkersById`,
  `advancedIconViews`, `currentMapId`. The `GMSMapView` is now constructed
  via `GMSMapViewOptions` with `mapID` set (iOS 14+); legacy fallback on
  older iOS. New methods: `setMapId:`, `setAdvancedMarkers:`,
  `setAdvancedMarkerView:markerId:`, `advancedDefaultPinForItem:`. Fabric
  `updateProps` marshals the new struct via `RNCustomMapAdvancedMarkersArray`.
- `RNCustomMapViewManager.mm` — registers `advancedMarkers` array prop
  and `mapId` custom prop on the legacy (Paper) view manager.
- `RNCustomMapModule.mm` — adds the bridge method `setAdvancedMarkerView`.
- `ios/RNCustomMap.podspec` + `rn-custom-map-sdk.podspec` — bump platform
  to iOS 14, add `Google-Maps-iOS-Utils` dep (per spec).

### Docs
- `README.md` — full `<AdvancedMarker>` section: usage, requirements,
  clustering behavior, prop table.

## Design decisions
- **Parallel JS pipeline** for advanced markers (separate cluster pass,
  separate snapshot root) — avoids touching the existing classic-marker
  flow. Both pipelines share `clusterConfig` so consumers only configure
  clustering once.
- **JS pre-clusters, native renders** — keeps `renderCluster` a single
  cross-platform implementation. The native ClusterManager is still used
  to host the marker collection (per spec) but its own clustering algo
  is disabled (`setMinClusterSize(Integer.MAX_VALUE)`).
- **iconView vs bitmap** — Android `AdvancedMarkerOptions.iconView(View)`
  and iOS `GMSAdvancedMarker.iconView` accept the React-rendered view
  directly, so Lottie / animated content keeps animating (no rasterization).
- **mapId defaulted to `"DEMO_MAP_ID"`** — Advanced Markers require a
  cloud-styled mapId; the default lets apps start without provisioning one.

## Verification
- ✅ TypeScript: `tsc -p externalModules/rn-custom-map-sdk/tsconfig.json --noEmit` clean.
- ✅ ESLint: SDK clean.
- ✅ Existing Jest tests: 57 pass (5 suites green; the `App.test.tsx`
  failure is the pre-existing gesture-handler native-module mock issue
  unrelated to this change).
- ⚠ Native Android Gradle / iOS Xcode builds were NOT exercised in this
  environment (no Android SDK / Xcode). Compile & device validation must
  happen on the consumer's machine.

## Backlog (P1 / P2)
- P1: full native ClusterManager-driven clustering (Android + iOS) where
  the cluster bubble itself is also an AdvancedMarker rendered by the
  utility library — currently the JS engine produces the bubble and the
  native ClusterManager is used purely as a marker collection holder.
- P2: emit `onAdvancedMarkerDragStart/Drag/DragEnd` via dedicated bubbling
  events instead of routing through `onMarkerDrag*`.
- P2: support iconView animation lifecycle hooks (pause/resume on tab blur).

