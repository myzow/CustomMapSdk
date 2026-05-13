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
