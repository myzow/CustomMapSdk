# Android Map Fixes — rn-custom-map-sdk

Complete drop-in fixes for two Android-only bugs that hit React Native 0.83.4
(New Architecture) projects using bottom-tabs navigation with multiple
Google Maps `MapView` instances.

---

## Issue 6 — Animations frozen on `<AdvancedMarker>` children (Lottie, Animated.View, ActivityIndicator)

**Root cause #1 (frozen content).** The Issue 3/4 fix rasterized children to a static bitmap. Anything that animated after first layout — pulsing dots, Lottie, ActivityIndicators, Reanimated transforms, rotating vehicle icons — appeared frozen.

**Root cause #2 (the obvious fix crashes).** The obvious cure — call `parent.removeView(view); wrapper.addView(view)` to reparent the React snapshot view into an SDK-owned wrapper that GMS can attach as `iconView` — also crashes, but later and more loudly. React Native's Fabric mount layer tracks every view's parent and aborts the app the next time it tries to mutate the snapshot root with a stale child list:

```
iOS:     "Attempt to unmount a view which is mounted inside different view."
Android: "addViewAt: failed to insert view [N] into parent [M] at index K"
```

**Fix — bitmap pumping at 60 FPS, vsync-locked.** The React view is left exactly where React put it (the off-screen snapshot subtree) and we snapshot its visual content into a bitmap that GMS displays as the marker icon. The pump runs at the display's refresh rate so the sampled animation state matches what the display can show — eliminates the every-other-frame stair-step that produced the visible "blinking" at 30 FPS.

- **Android (`RNAdvancedMarkers.java`)**: a single per-view `Choreographer.FrameCallback` iterates the `liveMarkers` set every ~16ms (60 FPS, vsync-locked). For each id, the React snapshot view's current visual is captured via `View.draw(Canvas)` into a per-marker reusable `Bitmap`, wrapped in a fresh `BitmapDescriptor`, and pushed to the marker via `setIcon`. The pump auto-starts when the first live marker arrives and auto-stops when the last is removed.

- **iOS (`RNCustomMapView.mm`)**: same design with `CADisplayLink` running at the device's native refresh rate (`preferredFrameRateRange = (30, 60, 60)`). The pump tick issues **one** synchronous `CATransaction flush` at the start of the frame, then snapshots every live marker with the cheap `drawViewHierarchyInRect:afterScreenUpdates:NO` — model layer is already in sync from the flush, so each per-marker capture reflects the current presentation state (including useNativeDriver transforms) without paying for a per-marker CA commit. Net: one global commit per frame for the whole map instead of N per-marker commits.

- **`tracksViewChanges` (boolean, default `true`)**: opt out to the cached static-bitmap path with content-signature dedup (one rasterization, reused forever). Recommended for dense scenes (500+ markers) where individual markers don't animate.

- **Unmount safety**: JS dispatches a `-1` sentinel to `setAdvancedMarkerView` when React's ref returns null. Native drops the cached snapshot reference before RN deallocates the UIView/View, so the pump never tries to draw against a zombie pointer.

- **Gesture-aware pump (Issue 8)**. Calling `marker.setIcon` while GMS is in the middle of a zoom/pinch/drag animation interleaves marker texture updates with map composition — the visible result is a flicker on each new frame. Fixed by gating the pump on a `cameraMoving` / `advancedCameraMoving` flag set in `OnCameraMoveStartedListener` (Android) / `mapView:willMove:` (iOS) and cleared in `OnCameraIdleListener` / `mapView:idleAtCameraPosition:`. The React animations on the snapshot views keep running in the background; the next pump tick after camera idle resumes from the current animation state seamlessly.

- **No reparenting of React views — at all.** RN-Fabric-safe by construction.

---

## Issue 7 — `<View>` wrappers around `<AdvancedMarker>` weren't detected

**Root cause.** `parseChildren` only walked direct children of `<MapView>`. The common pattern

```jsx
<MapView>
  {users.map(user => (
    <View key={user.userId}>
      <AdvancedMarker coordinate={user.coords}>
        <UserPin user={user} />
      </AdvancedMarker>
    </View>
  ))}
</MapView>
```

silently produced zero markers because the parser saw the `<View>`s and stopped.

**Fix.** `parseChildren` is now a depth-first recursive walker. When it encounters an element that isn't a known map type (`<AdvancedMarker>` / `<Marker>` / `<Polyline>` / `<Circle>`), it recurses into that element's `children` prop. Fragments, `<View>` wrappers, and any plain pass-through component are now transparent. Known marker elements are NOT recursed into — their children belong to the marker's custom view, not to the map's child set.


---

## Issue 3 — Android crashes when `<AdvancedMarker>` has React children

**Root causes.**

1. **`MapsInitializer.initialize(..., Renderer.LATEST, ...)` was never called.**
   Advanced Markers are only available on the LATEST renderer; without
   the explicit init the Maps SDK falls back to the legacy renderer and
   any `AdvancedMarkerOptions` usage throws `UnsupportedOperationException`.

2. **`AdvancedMarkerOptions.iconView(view)` cannot accept an
   already-parented View.** The React-managed snapshot subtree always has
   a parent (the off-screen `markerSnapshotRoot`), so attaching it as the
   marker's iconView triggers
   `IllegalStateException: The specified child already has a parent`.

**Fix.**

- `RNCustomMapView` now calls
  `MapsInitializer.initialize(ctx, Renderer.LATEST, callback)` from the
  constructor, before `mapView.getMapAsync(...)`. Maps SDK queues the
  callback until the renderer is ready, so by the time `onMapReady` fires
  the LATEST renderer is active and `AdvancedMarkerOptions` works.

- `RNAdvancedMarkers` was rewritten to use the bitmap path
  (`AdvancedMarkerOptions.icon(BitmapDescriptor)`) which is also Google's
  recommended high-performance Advanced Markers strategy. The React
  snapshot View is rasterized once via `View.draw(Canvas)` and the
  resulting bitmap is reused — no re-rasterization, no re-parenting, no
  crash. Defensive `try/catch` around marker creation logs and skips
  rather than tearing the map down.

---

## Issue 4 — iOS unmounting error / crash on `<AdvancedMarker>` children

**Root cause.** Assigning `GMSAdvancedMarker.iconView = markerView` retained
a strong reference to a React-managed `UIView`. When React unmounts the
snapshot (during a cluster transition, key change, screen blur, etc), the
underlying `UIView` is deallocated but `GMSMarker` still references it —
classic dangling pointer leading to the "view has been unmounted from the
React Native view hierarchy" crash.

**Fix.** `-setAdvancedMarkerView:markerId:` now rasterizes the `UIView` to
a `UIImage` (via `UIGraphicsImageRenderer`) and assigns it to
`marker.icon`. The image is cached by (markerId, view-pointer, size) so
cluster recomputes that don't actually change marker content are
short-circuited. No strong reference to the React `UIView` is held.

---

## Issue 5 — Severe jank during pan/zoom

**Root cause.** Every cluster recompute (which happens on the trailing
edge of any gesture) re-emits `setMarkerView` / `setAdvancedMarkerView`
for **all** snapshots, and the native side called `marker.setIcon(...)`
even when the bitmap was unchanged. Each `setIcon` triggers a Google Maps
renderer commit — multiplied across hundreds of markers, this is the
single biggest source of mid-drag stutter.

**Fix.**

- JS-side: `MapView.tsx` now gates the two snapshot-rebind effects on
  `isDragging`. While the user is actively gesturing, no native rebind
  calls are issued; the effects fire once when the gesture settles.

- Android native: `RNAdvancedMarkers` keeps a per-marker
  `(content-signature → BitmapDescriptor)` cache. `setIconView` early-
  returns when the signature is unchanged, so no `marker.setIcon` call
  is made.

- iOS native: `-setAdvancedMarkerView:markerId:` performs an identity
  check on the cached `UIImage` and skips `marker.icon =` when the same
  image is already on the marker.

Result: redundant marker re-renders during camera moves drop from
`O(visibleMarkers)` per frame to `O(0)`, restoring the 60 FPS pan/zoom
target.


---

## Issue 1 — `mapRef.current.animateToRegion()` silently no-ops from edge indicators

**Root cause.** The module's view lookup went through
`UIManagerHelper.resolveView(reactTag)`. Under Fabric, callbacks that fire
*before* the UIManager finishes committing the shadow tree — exactly when
on-map edge indicators emit their `onPress` — race the resolver and get
`null` back, which is logged but otherwise silently dropped. Buttons mounted
outside the map don't hit this race because they fire well after commit.

**Fix.** A static, synchronized `viewRegistry: HashMap<Integer, RNCustomMapView>`
lives on `RNCustomMapView` itself and is populated **synchronously inside
`setId(int)`**, which RN calls on the UI thread immediately after
`createViewInstance` returns. Edge-indicator callbacks now find the view
through `RNCustomMapView.findViewByTag(tag)` 100% of the time. UIManager
remains as a tier-2 fallback for reparented views.

### Files touched
| File | What changed |
| --- | --- |
| `android/.../RNCustomMapView.java` | Added `viewRegistry`, `findViewByTag()`, `setId()` override |
| `android/.../RNCustomMapModule.java` | `resolveMap()` now checks `viewRegistry` first |
| `android/.../RNCustomMapViewManagerImpl.java` | Old `WeakHashMap` removed; helpers delegate to the new registry |
| `src/MapView.tsx` | `getReactTag()` no longer throws when `findNodeHandle` returns null (edge-indicator first-frame guard) |

---

## Issue 2 — Blank white map on Android API 30 / 33 inside bottom tabs

**Root cause.** Google's `MapView` is a manual-lifecycle widget. The old
constructor called `onCreate/onStart/onResume` exactly once and never again.
`@react-navigation/bottom-tabs` keeps every tab mounted but detaches inactive
tabs from the window — which destroys the GL surface on API 30/33. When the
user returns to that tab, the view re-attaches but the MapView is still in
"resumed without surface" state, so it paints white. API 34+ uses a different
SurfaceView allocation path that auto-recovers, which is why iOS and API 34+
work fine.

**Fix.** Three coordinated pieces:

1. **Lifecycle-driven `RNCustomMapView`**
   - Constructor now only calls `onCreate(...)`. Subsequent `onStart`/`onResume`
     happen automatically from `onAttachedToWindow()`.
   - `onDetachedFromWindow()` calls `onPause`/`onStop` cleanly.
   - Public `onHostResume()`, `onHostPause()`, `forceRedraw()` allow the JS
     side to drive the lifecycle independent of attach state.
   - `forceRedraw()` on API < 34 also bounces the map type for one frame,
     which forces Google's renderer to re-acquire its GL context — this is
     the actual workaround for the white tiles.

2. **New native commands**
   `setActive(reactTag, active: boolean)` and `forceRedraw(reactTag)` are
   exposed through `RNCustomMapModule`. Both honor the New Arch TurboModule
   contract via the updated `spec/NativeRNCustomMapViewManager.ts`.

3. **JS hook `useMapTabLifecycle`**
   Soft-imports `useFocusEffect` from `@react-navigation/native` (no hard
   dependency). On focus → `setActive(true)` + `forceRedraw()` after
   interactions settle. On blur → `setActive(false)`. iOS is a no-op.

### Files touched
| File | What changed |
| --- | --- |
| `android/.../RNCustomMapView.java` | Lifecycle bookkeeping, `onHostResume/Pause`, `forceRedraw`, attach/detach hooks |
| `android/.../RNCustomMapModule.java` | New `setActive` + `forceRedraw` commands |
| `spec/NativeRNCustomMapViewManager.ts` | Added `setActive`, `forceRedraw` to TurboModule spec |
| `src/MapView.tsx` | `MapViewMethods` now exposes `setActive` / `forceRedraw` / `__getReactTag` |
| `src/hooks/useMapTabLifecycle.ts` | New file — the actual hook |
| `src/types.ts` | Type additions for the new ref methods |
| `index.tsx` / `index.d.ts` | Export `useMapTabLifecycle` |

---

## Using the fix in your app

```tsx
import { useRef } from 'react';
import MapView, { useMapTabLifecycle, type MapViewMethods } from 'rn-custom-map-sdk';

export default function MyTabScreen() {
  const mapRef = useRef<MapViewMethods>(null);

  // One line. Wires native lifecycle to react-navigation focus state.
  useMapTabLifecycle(mapRef);

  return (
    <MapView
      ref={mapRef}
      provider="google"
      initialRegion={{ latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      style={{ flex: 1 }}
    />
  );
}
```

Edge indicators / overlays calling `mapRef.current?.animateToRegion(...)` now
work without any additional setup — the native viewRegistry takes care of
the lookup.

---

## Build steps after pulling these changes

```bash
# Install the new navigation dependencies (already added to package.json)
yarn

# Regenerate New Arch codegen (picks up setActive + forceRedraw)
cd android && ./gradlew clean && cd ..

# Run
yarn android
```

Codegen regenerates `NativeRNCustomMapViewManagerSpec` from the updated
`.ts` spec; the abstract `setActive` / `forceRedraw` methods are already
implemented in `RNCustomMapModule.java`.

---

## Verifying the fixes

**Issue 1.** Tap one of the four edge indicators (▲ N, ▼ S, ◀ W, ▶ E)
overlaid on any tab. The map should animate smoothly to the offset region.
Before the fix you'd see no movement and a warning in logcat:
`RNCustomMapModule: animateToRegion: no view for tag=...`.

**Issue 2.** On an API 30 or API 33 emulator, switch through the three tabs
(SF → NYC → Tokyo) in any order, multiple times. Maps should remain visible
on every revisit. Before the fix the second/third visit produced a white
canvas where the map had been.

---

## Files in this PR

```
externalModules/rn-custom-map-sdk/
├── android/src/main/java/com/rncustommap/
│   ├── RNCustomMapView.java               (rewritten — viewRegistry + lifecycle)
│   ├── RNCustomMapModule.java             (rewritten — registry lookup + new commands)
│   └── RNCustomMapViewManagerImpl.java    (registry shim)
├── spec/NativeRNCustomMapViewManager.ts   (+ setActive, + forceRedraw)
├── src/
│   ├── MapView.tsx                        (safer getReactTag, new ref methods)
│   ├── hooks/useMapTabLifecycle.ts        (new)
│   └── types.ts                           (MapViewMethods extended)
├── index.tsx / index.d.ts                 (export useMapTabLifecycle)
src/screens/TabbedMapScreen.tsx            (new — demo screen with edge indicators)
App.tsx                                    (rewritten — 3-tab demo)
package.json                               (+ @react-navigation/*, gesture-handler, screens, safe-area)
```
