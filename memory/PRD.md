# PRD — Android Map Fixes for rn-custom-map-sdk

## Original problem statement
> React Native custom map has 2 Android issues:
> 1. `mapRef.current.animateToRegion()` doesn't work when called from edge
>    indicators (works fine from buttons).
> 2. Map shows blank white screen on Android API 30 & 33 when using bottom
>    tabs (3 tabs with map on each). Works on iOS and API 34+.
>
> Setup: custom native map SDK (rn-custom-map-sdk), bottom tabs with 3
> separate MapView instances. Files: MapView.tsx (forwardRef),
> RNCustomMapView.java, RNCustomMapModule.java.

## User choices
- React Native 0.83.4, **New Architecture (Fabric / TurboModules)** enabled
- Navigation: `@react-navigation/bottom-tabs`
- Underlying map: **Google Maps**
- Delivery: complete drop-in files including the JS-side `MapView.tsx` patch

## What was implemented (Jan 2026)

### Issue 1 — `viewRegistry` for edge-indicator-driven refs
- `RNCustomMapView.java` now owns a synchronized static `viewRegistry`
  populated inside `setId(int)`. New static `findViewByTag(int)` for
  module-side lookup.
- `RNCustomMapModule.java` uses a two-tier resolver: registry first (lock-free,
  immune to Fabric commit races), `UIManagerHelper.resolveView` as fallback.
- `RNCustomMapViewManagerImpl.java` legacy WeakHashMap removed, helpers
  delegate to the new registry.
- `src/MapView.tsx` `getReactTag()` no longer throws when `findNodeHandle`
  returns null on first frame — returns -1 sentinel and the native
  resolver short-circuits + warns.

### Issue 2 — Lifecycle for bottom-tab focus
- `RNCustomMapView.java` constructor: only `onCreate(...)`. Subsequent
  `onStart`/`onResume` driven from `onAttachedToWindow`.
- `onDetachedFromWindow` cleanly calls `onPause`/`onStop` (does **not** destroy).
- New public methods: `onHostResume()`, `onHostPause()`, `forceRedraw()`.
- `forceRedraw()` on API < 34 bounces map type to force GL surface re-acquisition
  (the actual fix for the white tiles).
- Module: new `setActive(reactTag, boolean)` and `forceRedraw(reactTag)`
  commands wired through the TurboModule spec.
- New hook `useMapTabLifecycle(ref)`: soft-imports `useFocusEffect` from
  `@react-navigation/native`. Activates+redraws on focus, deactivates on blur.
- `MapViewMethods` extended with `setActive()`, `forceRedraw()`, `__getReactTag()`.

### Demo wiring
- `App.tsx` rewritten as a 3-tab `createBottomTabNavigator` example.
- New `src/screens/TabbedMapScreen.tsx` with four edge indicators (▲ N, ▼ S, ◀ W, ▶ E)
  that exercise the Issue-1 codepath, plus `useMapTabLifecycle(mapRef)` that
  exercises the Issue-2 codepath.
- `package.json`: added `@react-navigation/native`, `@react-navigation/bottom-tabs`,
  `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler`.

## Verification status
- TypeScript: `npx tsc --noEmit` ✓ clean
- ESLint: all changed JS/TS files ✓ clean
- Java compilation: requires `./gradlew clean` (codegen regen for new spec
  methods) then `yarn android` — **must be run on the user's machine** since
  this preview environment has no Android SDK / emulator.

## Architecture notes
- View registry is per-process and survives view reparenting because we
  re-key on every `setId` call.
- `forceRedraw` is gated on `Build.VERSION.SDK_INT < UPSIDE_DOWN_CAKE` (API 34)
  so it's a free no-op on devices that don't need it.
- Hook is opt-in — existing single-screen apps that don't use bottom tabs
  pay zero cost.

## Backlog / future improvements
- P2: iOS counterpart for `setActive`/`forceRedraw` (currently no-op; iOS
  does not exhibit the bug, but symmetric API would simplify cross-platform
  code).
- P2: codegen-generated typed `setActive`/`forceRedraw` methods on the
  Fabric view component itself (would let users skip the module roundtrip).
- P3: integration test that mounts 3 maps in a tab navigator and asserts
  no `null` resolution warnings in logcat.

## Files
- `externalModules/rn-custom-map-sdk/android/src/main/java/com/rncustommap/RNCustomMapView.java`
- `externalModules/rn-custom-map-sdk/android/src/main/java/com/rncustommap/RNCustomMapModule.java`
- `externalModules/rn-custom-map-sdk/android/src/main/java/com/rncustommap/RNCustomMapViewManagerImpl.java`
- `externalModules/rn-custom-map-sdk/spec/NativeRNCustomMapViewManager.ts`
- `externalModules/rn-custom-map-sdk/src/MapView.tsx`
- `externalModules/rn-custom-map-sdk/src/hooks/useMapTabLifecycle.ts`
- `externalModules/rn-custom-map-sdk/src/types.ts`
- `externalModules/rn-custom-map-sdk/index.tsx`, `index.d.ts`
- `src/screens/TabbedMapScreen.tsx`
- `App.tsx`
- `package.json`
- `FIXES.md` (full write-up)
