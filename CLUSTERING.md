# Marker Clustering — rn-custom-map-sdk

Native-accelerated clustering with a JS fallback, added on top of the
existing rn-custom-map-sdk. Markers carry arbitrary `data` (alias `userData`)
that flows untouched into `renderCluster` so cluster bubbles can show images,
names, badges, anything.

## API

### `<MapView clusterConfig={...}>`

```ts
type ClusterConfig = {
  enabled?: boolean;                          // default true
  ignoreClusterIds?: ReadonlyArray<string>;   // never folded into a cluster
  radius?: number;                            // px, default 60
  renderCluster?: (cluster: Cluster) => React.ReactNode;
  onClusterPress?: (cluster: Cluster) => void;
  forceJS?: boolean;                          // bypass native acceleration
};

type Cluster = {
  id: string;
  coordinate: { latitude: number; longitude: number };
  pointCount: number;
  markerIds: string[];
  markers: Array<{
    id: string;
    coordinate: { latitude: number; longitude: number };
    data?: any;                               // your payload, untouched
    title?: string;
  }>;
};
```

### `<Marker data={...}>` (alias `userData`)

```tsx
<Marker
  identifier="cafe-12"
  coordinate={coord}
  title="Blue Bottle"
  data={{ avatar: 'https://…', category: 'coffee', rating: 4.8 }}
/>
```

`data` is JS-only — never bridged to native, so there's no serialization cost
and no shape restriction. It surfaces unchanged at `cluster.markers[i].data`.

## Architecture: native-accelerated with JS fallback

```
                ┌───────────────────────────────────┐
                │  MapView.tsx                      │
                │   • tracks region + viewport      │
                │   • collects parsed.markerMeta    │
                │     (data lives JS-side only)     │
                └───────────────────────────────────┘
                            │
              recompute() on markers/region change
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌─────────────────────┐     ┌─────────────────────┐
   │  NATIVE             │     │  JS FALLBACK        │
   │  computeClusters()  │     │  clusterPoints()    │
   │                     │     │                     │
   │  Android: uses      │     │  Pure JS pixel-grid │
   │   GoogleMap         │     │  bucketing.         │
   │   .getProjection()  │     │                     │
   │                     │     │  Used when:         │
   │  iOS: uses          │     │   • forceJS=true    │
   │   GMSMapView        │     │   • native throws   │
   │   .projection       │     │   • not RN platform │
   │                     │     │                     │
   │  Returns id groups  │     │  Returns full       │
   │  + cluster centers  │     │  Cluster objects    │
   └──────────┬──────────┘     └──────────┬──────────┘
              │                           │
              └────────── enrich ──────────┘
                            │
              (JS joins ids → data via parsed.markerMeta)
                            │
                            ▼
              ┌───────────────────────────┐
              │  Render clusters as       │
              │  synthetic markers w/     │
              │  renderCluster() output   │
              │  in the snapshot layer    │
              └───────────────────────────┘
```

Native only computes id groupings + cluster centers, never carries `data`
across the bridge. JS joins each id back to its `Marker.data` from
`parsed.markerMeta`. Result: renderCluster gets full payload access with
zero bridge cost for that payload.

## Example: image-rendering cluster bubble

See `src/screens/ClusteringScreen.tsx` (wired as the 4th bottom-tab in
`App.tsx`). Highlights:

```tsx
<MapView
  ref={mapRef}
  clusterConfig={{
    enabled: true,
    radius: 70,
    ignoreClusterIds: ['place-0', 'place-1'],  // anchors stay solo
    renderCluster: cluster => <ClusterBubble cluster={cluster} />,
    onClusterPress: cluster => {
      if (cluster.pointCount === 1) {
        const place = cluster.markers[0].data as Place;
        Alert.alert(place.name, place.category);
      } else {
        // cluster.markers[i].data has full image + name access
      }
    },
  }}
>
  {places.map(p => (
    <Marker
      key={p.id}
      identifier={p.id}
      coordinate={p.coordinate}
      title={p.name}
      data={p}                                  // ← any shape
    />
  ))}
</MapView>
```

`ClusterBubble` renders **up to 3 stacked avatars** drawn from
`cluster.markers[i].data.avatar` plus a count badge — exactly the
"image rendering in cluster" pattern from the prompt.

## Files

```
externalModules/rn-custom-map-sdk/
├── spec/NativeRNCustomMapViewManager.ts       (+ computeClusters)
├── src/clustering/cluster.ts                  (new — JS engine)
├── src/MapView.tsx                            (clustering pipeline)
├── src/types.ts                               (Cluster, ClusterConfig, data/userData)
├── android/src/main/java/com/rncustommap/
│   └── RNCustomMapModule.java                 (+ computeClusters native impl)
├── ios/
│   ├── RNCustomMapView.h / .mm                (+ computeClustersWithPoints:radius:)
│   └── RNCustomMapModule.mm                   (+ RCT_EXPORT_METHOD computeClusters)
└── index.tsx / index.d.ts                     (export clusterPoints)

src/screens/ClusteringScreen.tsx                (new — image-bubble demo)
App.tsx                                        (+ 4th tab)
```

## Build steps

```bash
yarn
cd android && ./gradlew clean && cd ..      # codegen picks up the new spec method
yarn android   # or yarn ios
```

The new `computeClusters` method on the TurboModule spec generates a fresh
abstract method on `NativeRNCustomMapViewManagerSpec` — the Java module
already overrides it, and iOS exposes it via `RCT_EXPORT_METHOD`. No further
manual wiring required.

## Verification

- **TypeScript**: `npx tsc --noEmit` ✓ clean
- **ESLint**: all changed JS/TS files ✓ clean
- **Behavior**: open the **Clustering** tab; you should see ~35 markers
  collapsing into avatar-stacked bubbles. Pinch out to see individual avatars,
  pinch in to recluster. `place-0` and `place-1` always render as solo
  markers (ignoreClusterIds). Tapping a multi-point cluster lists members;
  tapping a singleton shows its category.
