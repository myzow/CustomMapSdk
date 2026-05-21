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

## `<AdvancedMarker>` — Google Maps Advanced Markers

The SDK ships a separate `<AdvancedMarker>` component built on Google
Maps' Advanced Markers APIs. It is fully cross-platform, integrates with
the same `clusterConfig` pipeline, and exists alongside the classic
`<Marker>` (no breaking change).

### Two rendering modes

| Children supplied? | Renders as |
| --- | --- |
| Yes (React tree)   | **Custom advanced marker.** Children are attached as the native `iconView` directly (Android `AdvancedMarkerOptions.iconView`, iOS `GMSAdvancedMarker.iconView`). |
| No                 | **Default advanced marker** (standard Google Maps pin honoring `pinColor`, `title`, `description`). |

### Requirements

- **Android**: Google Maps SDK 18.2.0+ (already declared). Advanced Markers
  require the host map to be created with a valid `mapId`. The SDK
  defaults to `"DEMO_MAP_ID"` for development; supply your own via the
  `mapId` prop on `<MapView>` for production builds.
  - Adds `com.google.maps.android:android-maps-utils:3.8.2` for
    `ClusterManager`.
- **iOS**: GoogleMaps SDK 9.0+ on iOS 14+ (the podspec bumps the platform
  to 14.0 and declares `Google-Maps-iOS-Utils` for `GMUClusterManager`).
  `mapID` is set on the `GMSMapView` at construction via `GMSMapViewOptions`.

### Usage

```tsx
import MapView, { AdvancedMarker } from 'rn-custom-map-sdk';

<MapView
  style={{ flex: 1 }}
  mapId="DEMO_MAP_ID" // or your own Cloud-styled mapId
  initialRegion={region}
  clusterConfig={{ enabled: true, radius: 60 }}
>
  {/* Custom advanced marker — children render as the native iconView */}
  <AdvancedMarker
    identifier="user-42"
    coordinate={{ latitude: 37.78, longitude: -122.43 }}
    title="Custom user"
  >
    <View style={styles.bubble}>
      <Image source={{ uri: user.avatar }} style={styles.avatar} />
    </View>
  </AdvancedMarker>

  {/* Default advanced marker — standard pin tinted via pinColor */}
  <AdvancedMarker
    identifier="poi-7"
    coordinate={{ latitude: 37.79, longitude: -122.42 }}
    title="Coffee shop"
    pinColor="#1f6feb"
  />
</MapView>
```

### Clustering

`<AdvancedMarker>` participates in the **same** `clusterConfig` as classic
markers — singleton clusters fall back to the original advanced marker
(custom view or default pin), multi-clusters are rendered via the
`renderCluster` callback you already use.

Per the spec, the native side uses:
  - **Android** — `ClusterManager<AdvancedMarkerOptions>` from
    `com.google.maps.android:android-maps-utils` to host the marker
    collection. The cluster engine itself runs in JS so `renderCluster`
    remains a single cross-platform implementation.
  - **iOS** — `GMSAdvancedMarker` instances mounted on the GMSMapView,
    with `Google-Maps-iOS-Utils` available for future native cluster
    rendering.

### Required props

| Prop          | Type                                | Required | Notes |
| ------------- | ----------------------------------- | -------- | ----- |
| `coordinate`  | `{ latitude; longitude }`           | Yes      | Position |
| `identifier`  | `string`                            | Yes      | Unique id used for clustering / refs |
| `children`    | `ReactNode`                         | No       | Presence triggers custom marker mode |
| `title`       | `string`                            | No       | Info-window title |
| `description` | `string`                            | No       | Info-window description |
| `pinColor`    | `string` (CSS color)                | No       | Default-marker tint |
| `draggable`   | `boolean`                           | No       | Allow drag |
| `flat`        | `boolean`                           | No       | Attach to map plane |
| `rotation`    | `number`                            | No       | Degrees |
| `opacity`     | `number` (0-1)                      | No       |       |
| `anchor`      | `{ x; y }`                          | No       | Anchor point |
| `zIndex`      | `number`                            | No       | Stack order |

