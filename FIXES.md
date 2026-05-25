# Android Map Fixes — rn-custom-map-sdk

Complete drop-in fixes for two Android-only bugs that hit React Native 0.83.4
(New Architecture) projects using bottom-tabs navigation with multiple
Google Maps `MapView` instances.

---

## Issue 13 — `tracksViewChanges={false}` markers still re-rendering on every parent render

**Symptom.** Even with `tracksViewChanges={false}`, the marker's React subtree re-rendered every time the parent re-rendered (e.g., during pan/zoom, when handler closures like `onPress={() => onPressMarker(user)}` are recreated). Each re-render fired the `ref` callback → emitted `setAdvancedMarkerView` → triggered a layout / image-source-reload cycle that produced a visible micro-flicker.

**Fix.** Wrapped the static-bitmap snapshot in a new `<FrozenSnapshot>` component that uses `React.memo(Component, () => true)` plus `useState(() => initialChildren)` to capture children on first mount and **never re-render** after. The component is functionally inert for the rest of its lifetime — its native bitmap is rasterized exactly once and the React subtree never touches it again. Coordinate updates still flow through the `advancedMarkers` prop on the `<NativeMapView>` (separate code path), so the marker still moves around the map correctly while the visual stays frozen.

### Trade-off
With `tracksViewChanges={false}` the marker is frozen at first mount. If the visual data later changes (e.g., the user's `profileIcon` URL changes), the bitmap will NOT update. To swap to a different visual, briefly flip `tracksViewChanges` to `true` (forcing a re-mount in the live path), then flip back. This matches react-native-maps' semantics for the same prop.

### Files touched
- `externalModules/rn-custom-map-sdk/src/MapView.tsx` — adds `FrozenSnapshot`, replaces inline static-bitmap render with it.

---

## Issue 14 — `ignoreClusterIds: ['user-location']` no longer matches

**Symptom.**
```jsx
<MapView clusterConfig={{ ignoreClusterIds: ['user-location'] }}>
  <SingleMarker key="user-location" userData={undefined} ... />
</MapView>
```
The user-location marker still got swept into clusters — `ignoreClusterIds` was silently a no-op.

**Root cause.** The React `key="user-location"` is not visible to child components. Inside `SingleMarker` the AdvancedMarker is configured as `identifier={userData?.userId || ''}` — and since `userData` is `undefined`, identifier becomes the empty string. The SDK auto-generates a stable id (e.g., `auto-adv-3`) for empty identifiers, so `'user-location'` in `ignoreClusterIds` never matches.

**Fix (two paths, pick whichever fits your codebase better).**

1. **Pass an explicit `identifier`** through your wrapper. Cleanest for known-identity markers:
   ```jsx
   // SingleMarker.tsx — accept an override
   type SingleMarkerProps = { identifier?: string; userData?: MapMember; ... };
   <AdvancedMarker identifier={identifier ?? userData?.userId ?? ''} ... />

   // Usage
   <SingleMarker identifier="user-location" userData={undefined} ... />
   ```
2. **Use the new function-predicate form of `ignoreClusterIds`** — match by any property, not just id:
   ```jsx
   clusterConfig={{
     enabled: true,
     ignoreClusterIds: (marker) =>
       marker.data === undefined || marker.data?.kind === 'user-location',
   }}
   ```
   The predicate receives `{ id, data, title, coordinate }` per marker. Backwards-compatible with the existing `string[]` form.

### Files touched
- `externalModules/rn-custom-map-sdk/src/types.ts` — `ignoreClusterIds` widened to `ReadonlyArray<string> | ((marker) => boolean)`.
- `externalModules/rn-custom-map-sdk/src/MapView.tsx` — `shouldIgnoreFromCluster` predicate replaces the old `ignoreSet`.

---

## Issue 12 — `<AdvancedMarker>` wrapped in a custom component renders nothing

**Symptom.**

```jsx
const MyPin = ({ user }) => (
  <AdvancedMarker identifier={user.id} coordinate={...}>
    <Avatar uri={user.avatar} />
  </AdvancedMarker>
);

// Inside the consumer:
<MapView>
  {users.map(u => <MyPin key={u.id} user={u} />)}
</MapView>
```

Zero markers are drawn even though the data is correct.

**Root cause.** `<AdvancedMarker>` is a virtual node (returns `null`)
and the parent `<MapView>` discovers markers by walking the JSX tree
inside `parseChildren`. The walker can transparently descend through
`<View>` and `<Fragment>` wrappers because those expose their tree via
`props.children`, but it **cannot descend into a custom functional or
forwardRef component**: the component's render output is opaque from
the parent's perspective (functions can use hooks; calling them
outside React's reconciler corrupts hook state). `MyPin.props.children`
is undefined → the walker has nothing to recurse into → no marker.

**Fix.** Added a React Context (`MapContext`) exported by the parent
`<MapView>`. `<AdvancedMarker>` now does both things:

1. Returns `null` (unchanged — its visual content is hoisted into the
   MapView's overlay / bitmap subtree, as before).
2. Registers itself with the context on mount, re-registers on
   primitive prop changes, unregisters on unmount.

`<MapView>` maintains a state Map of registered markers, merges it
with the inline `parseChildren` result (registry wins on id collision
because it has the most up-to-date children reference), and renders
from the merged data. The consumer's JSX is rendered inside an
invisible host (`registryHost`, `0x0` clipped) so any descendant
`<AdvancedMarker>` mounts and runs its registration effect.

### Both patterns now work
```jsx
// Inline children — handled by parseChildren on the first render
<MapView>
  <AdvancedMarker coordinate={...}>
    <View />
  </AdvancedMarker>
</MapView>

// Wrapped in ANY HOC / fragment / conditional render — handled by
// context registration after the first effect flush
<MapView>
  {users.map(u => <MyPin key={u.id} user={u} />)}
</MapView>
```

### Files touched
- `externalModules/rn-custom-map-sdk/src/AdvancedMarkerContext.ts` — new file: context + types.
- `externalModules/rn-custom-map-sdk/src/AdvancedMarker.tsx` — full rewrite: registers via context.
- `externalModules/rn-custom-map-sdk/src/MapView.tsx` — adds state Map + context provider + merge logic + invisible registryHost that mounts `children`.
- `externalModules/rn-custom-map-sdk/index.tsx` — re-exports `MapContext`.
- `src/screens/OverlaySyncScreen.tsx` — adds a wrapped-pin demo.

### Notes
- Inline pattern still renders on the first frame (parseChildren handles it).
- Wrapped pattern shows markers after the first effect flush (one extra render cycle — typically ~1 frame).
- Empty / missing `identifier` falls back to an auto-generated stable id.

---

## Issue 11 — `tracksViewChanges={false}` markers still flickering after overlay refactor

**Symptom.** A consumer sets `tracksViewChanges={false}` on an
`<AdvancedMarker>` containing animated children (e.g.
`<CustomActivityIndicator/>`) and still sees flicker / jitter during
pan/zoom.

**Root cause.** Issue 10's native-synced overlay refactor unconditionally
routed every advanced-marker subtree into the React overlay layer —
ignoring the marker's `tracksViewChanges` prop. The result was two
concurrent visuals per marker:

1. A hidden GMS marker (`opacity=0`, `pendingReveal=YES`) — never
   revealed because `setAdvancedMarkerView` was never called after the
   refactor. So far so good.
2. The React overlay UIView/Android View in an absolute-positioned
   layer above the map. Repositioned via `setMarkerOverlay` in
   `didChangeCameraPosition:` / `onCameraMove(...)`.

The flicker comes from #2. The map renders on its own GL surface; the
React overlay sits in the UIKit / Android view compositor. Even though
native sets `view.center` (iOS) / `setTranslationX/Y` (Android)
synchronously inside the camera-move callback, those property writes
are committed on the **next** display refresh — so during fast pan/zoom
the overlay lags the map by ~1 frame and appears to swim.

`tracksViewChanges={false}` was supposed to provide an opt-out into the
GMS-side bitmap path (rendered on the same GL surface as the map tiles,
zero compositor lag). After the refactor the opt-out was a no-op.

**Fix.** `MapView.tsx` now splits advanced-marker snapshots into two
buckets based on `tracksViewChanges`:

| Bucket | Path | Renders | Trade-off |
|---|---|---|---|
| `liveOverlaySnapshots` (default, `tracksViewChanges !== false`) | Overlay layer above the map | Real React views, live animations at native frame rate | Up to ~1 frame of compositor lag during very fast pan/zoom |
| `staticBitmapSnapshots` (`tracksViewChanges === false` + all cluster bubbles) | GMS-side bitmap (BitmapDescriptor / UIImage) via `setAdvancedMarkerView` | Static snapshot rendered on the map's own GL surface | Zero compositor lag, perfectly synced with map; no live animations |

Cluster bubbles now also carry `tracksViewChanges: false` explicitly so
the synthetic cluster marker rides the bitmap path (no pump churn on
cluster recompute).

### Files touched
- `externalModules/rn-custom-map-sdk/src/MapView.tsx` —
  - new `advancedTracksChanges` lookup,
  - new split into `liveOverlaySnapshots` / `staticBitmapSnapshots`,
  - JSX now renders **two** subtrees: the overlay layer + the
    off-screen advanced-marker bitmap root,
  - cluster bubble factory emits `tracksViewChanges: false`.

### How to choose
- "I want my marker glued to the map at 60FPS, no animation" →
  `tracksViewChanges={false}` (recommended for driver dots, avatar pins,
  static labels — the user's case in this thread).
- "I want my marker to play a live animation (pulse, Lottie, spinner,
  Reanimated)" → leave `tracksViewChanges` at default (`true`).

---

## Issue 10 — Uber/Life360 quality: native-synced overlay markers

**Previous approaches and their limits.**

| Approach | Problem |
|---|---|
| Live `iconView(view)` with React reparenting | Fabric mount layer crash (Issue 6 root #2) |
| Bitmap pump at 60 FPS with `setIcon(...)` per frame | Even with `CATransaction flush` + `cameraMoving` gate, leaves a brief moment between marker create / destroy on cluster recompute where the user can perceive a flicker. Also costs N × 60 GPU texture uploads per second. |
| Disable animation entirely | Defeats the purpose. |

**Final approach — native-synced overlay views (the architecture Uber / Lyft / Life360 / Zomato actually use).** The React-rendered marker view is mounted as a **normal sibling of the native map** (a child of an absolute-positioned overlay layer over the MapView). It never gets reparented — React owns it from mount to unmount, so Fabric is happy. On every camera frame native projects the marker's lat/lng to screen pixels and writes `view.setTranslationX/Y(...)` (Android) / `view.center = ...` (iOS) directly. The translation write lands inside the same UI-thread frame as the map's camera composition, so the overlay tracks the map pixel-perfectly during drag/zoom.

What this delivers:
- **Zero flicker** on drag/zoom end — the marker view is a React-managed native view that already exists; cluster recompute just re-registers its coordinate, native repositions on the next frame. No bitmap creation, no setIcon, no default-pin flash.
- **Genuine 60 FPS animations** — Animated.View / Lottie / ActivityIndicator / Reanimated run in their actual native view (no per-frame rasterization), at the device's native refresh rate, with full useNativeDriver path intact.
- **Pixel-perfect sync** — the per-frame translation write happens in the camera-move callback (Android `OnCameraMoveListener.onCameraMove()`, iOS `mapView:didChangeCameraPosition:`), both of which fire on the main thread synchronously with the map's own rendering, before the surface is composited.
- **Cluster recompute on drag/zoom-idle is silent** — overlay views remount with the new cluster bubble's coordinate; the previous singleton overlays unmount cleanly. The GMS markers underneath (still created for API compatibility) stay at alpha=0 and contribute zero visuals.

### Files added / changed
- **NEW** `externalModules/rn-custom-map-sdk/android/.../RNMarkerOverlay.java` — overlay state + `set` / `remove` / `onCameraMove` projecting `Projection.toScreenLocation(...)` to view translation
- `externalModules/rn-custom-map-sdk/android/.../RNCustomMapView.java` — added `overlayState` field, `RNMarkerOverlay.onCameraMove(this)` call from `OnCameraMoveListener` and `OnCameraIdleListener`
- `externalModules/rn-custom-map-sdk/android/.../RNCustomMapModule.java` — new `setMarkerOverlay(reactTag, markerId, viewTag, lat, lng, ax, ay)` TurboModule method
- `externalModules/rn-custom-map-sdk/ios/RNCustomMapView.h` + `.mm` — added `overlayEntries` dict, `-setMarkerOverlayView:markerId:coordinate:anchorX:anchorY:` + `applyOverlayPositions` + `applyOverlayEntry:`, hooks in `mapView:didChangeCameraPosition:` and `mapView:idleAtCameraPosition:`
- `externalModules/rn-custom-map-sdk/ios/RNCustomMapModule.mm` — new `setMarkerOverlay` `RCT_EXPORT_METHOD`
- `externalModules/rn-custom-map-sdk/spec/NativeRNCustomMapViewManager.ts` — `setMarkerOverlay` added to the TurboModule spec
- `externalModules/rn-custom-map-sdk/src/MapView.tsx` — added overlay layer JSX (replaces the old off-screen snapshot root), per-marker `setOverlayView` ref handler, coordinate-sync effect, `onPress` Pressable wrapper preserving the existing AdvancedMarker `onPress` API.


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

- **Post-gesture marker reveal (Issue 9 — the red-pin flash)**. Cluster recomputes on drag/zoom-idle destroy and recreate markers (bucket IDs change with zoom). There's then a 50–200ms gap before React mounts the new snapshot view and the first `setAdvancedMarkerView` callback lands. During that gap an `alpha=1` marker shows whatever icon the SDK provides — sometimes our transparent placeholder, sometimes (on Android, depending on internal renderer state) the default red pin. Fixed by creating every new custom-view marker at `alpha=0` and tracking it in a `pendingReveal` set. The first call to `rasterizeOnce` / `rasterizeAdvancedMarker:` removes the id from the set and restores the user's requested opacity. Result: markers are simply invisible during the load gap — no red pin, no placeholder, no flash. They fade in (well, snap in at full opacity) the instant the first real icon is ready.

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
