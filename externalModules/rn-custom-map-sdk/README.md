# rn-custom-map-sdk

Fabric-ready React Native map SDK with a deliberately small API surface:
`MapView`, `Marker`, `Callout`, `Polyline`, and `Circle`.

The package supports the old Paper architecture and the new Fabric architecture
through React Native Codegen.

## Install

```sh
npm install rn-custom-map-sdk
```

For iOS:

```sh
cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install
```

For Android, add your Google Maps key to the app manifest:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_API_KEY" />
```

## New Architecture

Enable `newArchEnabled=true` in `android/gradle.properties` and install pods
with `RCT_NEW_ARCH_ENABLED=1`. The package exposes:

- `spec/RNCustomMapViewNativeComponent.ts`
- `spec/NativeRNCustomMapViewManager.ts`

React Native Codegen generates the native component and TurboModule bindings.

## Usage

```tsx
import MapView, { Marker, Polyline, Circle, Callout } from 'rn-custom-map-sdk';

export default function App() {
  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: 37.78825,
        longitude: -122.4324,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
    >
      <Marker
        coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
        title="San Francisco"
        draggable
      >
        <Callout />
      </Marker>
      <Polyline
        coordinates={[
          { latitude: 37.78825, longitude: -122.4324 },
          { latitude: 37.79, longitude: -122.42 },
        ]}
      />
      <Circle
        center={{ latitude: 37.78825, longitude: -122.4324 }}
        radius={500}
      />
    </MapView>
  );
}
```

## Flicker-free markers

The SDK ships with a 3-tier pipeline that prevents the default Google /
Apple pin from ever flashing during zoom, drag, or cluster transitions:

1. **Native icon cache** (Android: `BitmapDescriptor` LRU,
   iOS: `NSCache<NSString*, UIImage*>`). Bitmaps survive across
   cluster recomputes and are released automatically under memory
   pressure (`onTrimMemory` / `UIApplicationDidReceiveMemoryWarning`).
2. **Diff-based marker updates**. `setMarkers` reuses existing native
   marker instances when ids are unchanged, so cluster transitions no
   longer destroy + recreate the underlying GMSMarker/Marker.
3. **Branded placeholder fallback** (`<MarkerPlaceholder />` JS,
   colored-disc bitmap on native). Shown as the very first icon when a
   remote image is still loading or after the 500 ms cutoff. The
   default platform pin is never used.

Add a fallback to any marker:

```tsx
<Marker
  identifier={place.id}
  coordinate={place.coordinate}
  fallback={{ color: '#1f6feb', initial: place.name.charAt(0) }}
/>
```

Drag-aware clustering is automatic: while a gesture is in flight the
cluster pipeline is paused. Exactly one recompute fires on the trailing
edge of a drag, after the camera settles. Tune via `clusterConfig`:

```tsx
clusterConfig={{
  enabled: true,
  radius: 64,
  renderThreshold: 0.5,      // skip recompute below ½ zoom step
  dragThreshold: 50,         // skip recompute under 50 px of pan
  debounceMs: 100,           // settle period after programmatic moves
  renderCluster: cluster => <ClusterBubble cluster={cluster} />,
}}
```

Programmatically warm the icon cache for known URLs (e.g. when paginating
a feed):

```tsx
import NativeMapViewManager from 'rn-custom-map-sdk/spec/NativeRNCustomMapViewManager';

NativeMapViewManager.prefetchMarkerIcons(reactTag, urls);
```
