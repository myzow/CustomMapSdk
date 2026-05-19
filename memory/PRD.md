# rn-custom-map-sdk — Clustering perf & press behavior

## Problem statement (verbatim)
Fix cluster re-rendering and add cluster press behavior in the React Native
map SDK. Stop constant re-renders during drag, add zoom-on-press behavior
with override + max-zoom auto-expand.

## Architecture / changes — 2026-01
- New pure-JS module `src/clustering/throttle.ts` with `regionToZoom`,
  `pixelDistance`, `shouldRecompute`, `zoomBucketKey`.
- `src/MapView.tsx` clustering pipeline rewritten:
  - `liveRegionRef` tracks the camera during gestures; cluster compute is
    NEVER triggered mid-drag.
  - `onRegionChangeComplete` schedules a `debounceMs` timer; the timer
    checks `renderThreshold` (Δzoom) and `dragThreshold` (Δpixels) before
    bumping `regionForCompute`.
  - `clusterCacheRef: Map<zoomBucket, Cluster[]>` reuses prior results when
    the user revisits a zoom level. Cache resets on points / radius / viewport
    change.
  - Cluster taps default to "zoom in by `zoomStepOnPress` (=2)" via
    `NativeMapViewManager.animateToRegion`. At `maxZoomLevel`, taps fall back
    to `fitToCoordinates(cluster.markers)` to spread out the members.
  - `customOnPress` fully overrides the default; legacy `onClusterPress` is
    still fired for backwards compatibility.
- `src/types.ts` `ClusterConfig` extended with the 5 new props.

## Files touched
- externalModules/rn-custom-map-sdk/src/clustering/throttle.ts (new)
- externalModules/rn-custom-map-sdk/src/clustering/cluster.ts (unchanged)
- externalModules/rn-custom-map-sdk/src/MapView.tsx
- externalModules/rn-custom-map-sdk/src/types.ts
- __tests__/clusteringThrottle.test.ts (new — 14 tests)

## Verification
- `npx tsc --noEmit` ✓ clean
- `yarn test clusteringThrottle` ✓ 14/14 passing
- ESLint ✓ clean on all touched files

## Backlog
- P1: Document new clusterConfig props in CLUSTERING.md.
- P2: Add an integration test exercising the debounce timer with fake timers.
- P2: Surface `recompute()` as an imperative method for consumers who want to
  force a refresh.
