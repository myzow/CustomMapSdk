import React, { useMemo, useRef } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  MarkerPlaceholder,
  useMapTabLifecycle,
  type Cluster,
  type MapViewMethods,
} from 'rn-custom-map-sdk';

// Lottie is optional — if the host app hasn't linked it (or in a unit
// test environment) we just render the placeholder. We require it lazily
// so this screen still type-checks and renders in JS-only sandboxes.
let LottieView: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  LottieView = require('lottie-react-native').default;
} catch {
  LottieView = null;
}

/**
 * AllMarkersScreen — exercises every marker type the SDK now supports
 * reliably, with caching and placeholder fallback:
 *
 *   - Static image markers (remote URLs → BitmapDescriptor / UIImage cache)
 *   - GIF markers (first frame; <Image /> with cached source)
 *   - Lottie animation markers (rendered as React-view, snapshotted +
 *     cached bitmap on the native side)
 *   - Plain React-View markers (text bubble with badge)
 *   - Clustered + ignored markers in the same scene
 *
 * The same `clusterConfig` powers all of them. Every marker has a
 * `fallback` so the user sees a styled placeholder during zoom/cluster
 * transitions — never the default Google pin.
 */
type MarkerKind = 'image' | 'gif' | 'lottie' | 'view';

type Demo = {
  id: string;
  name: string;
  kind: MarkerKind;
  coordinate: { latitude: number; longitude: number };
  image?: string;
  badge?: string;
  accent: string;
};

const REMOTE_AVATARS = [
  'https://i.pravatar.cc/120?img=11',
  'https://i.pravatar.cc/120?img=22',
  'https://i.pravatar.cc/120?img=33',
  'https://i.pravatar.cc/120?img=44',
  'https://i.pravatar.cc/120?img=55',
  'https://i.pravatar.cc/120?img=66',
];

// Public GIF used purely for demo (any working GIF URL will do).
const DEMO_GIF =
  'https://media.giphy.com/media/3o7TKr3nzbh5WgCFxe/giphy.gif';

// Tiny embedded Lottie (a single bouncing dot) so the screen has
// something to animate even when the host app isn't providing its own.
const DEMO_LOTTIE = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 60,
  h: 60,
  nm: 'pulse',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'dot',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [30, 30, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [60, 60, 100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
            { t: 30, s: [120, 120, 100], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
            { t: 60, s: [60, 60, 100] },
          ],
        },
      },
      ao: 0,
      shapes: [
        {
          ty: 'el',
          d: 1,
          s: { a: 0, k: [22, 22] },
          p: { a: 0, k: [0, 0] },
          nm: 'circle',
        },
        {
          ty: 'fl',
          c: { a: 0, k: [1, 0.482, 0.447, 1] },
          o: { a: 0, k: 100 },
          r: 1,
          nm: 'fill',
        },
      ],
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    },
  ],
};

function buildDemos(): Demo[] {
  const center = { lat: 37.7749, lng: -122.4194 };
  const kinds: MarkerKind[] = ['image', 'gif', 'lottie', 'view'];
  const accents = ['#ff7b72', '#79c0ff', '#7ee787', '#d2a8ff'];
  const out: Demo[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i * 137.5 * Math.PI) / 180;
    const distance = 0.005 + (i % 7) * 0.004;
    const kind = kinds[i % kinds.length];
    out.push({
      id: `demo-${i}`,
      name: `Spot ${i + 1}`,
      kind,
      coordinate: {
        latitude: center.lat + Math.sin(angle) * distance,
        longitude: center.lng + Math.cos(angle) * distance,
      },
      image: kind === 'image' ? REMOTE_AVATARS[i % REMOTE_AVATARS.length] : undefined,
      badge: kind === 'view' ? String((i % 9) + 1) : undefined,
      accent: accents[i % accents.length],
    });
  }
  return out;
}

function DemoMarker({ demo }: { demo: Demo }) {
  switch (demo.kind) {
    case 'image':
      // Real bitmap; <Image /> renders the cached URI inside a styled
      // bubble. The native side rasterizes this view ONCE and reuses the
      // bitmap on subsequent cluster transitions.
      return (
        <View style={[styles.bubble, { borderColor: demo.accent }]}>
          <Image source={{ uri: demo.image! }} style={styles.bubbleImage} />
        </View>
      );
    case 'gif':
      // First frame is captured by the snapshot pipeline; on iOS GIFs
      // render natively, on Android only the first frame is shown
      // (matches the user's spec).
      return (
        <View style={[styles.bubble, { borderColor: demo.accent }]}>
          <Image source={{ uri: DEMO_GIF }} style={styles.bubbleImage} />
        </View>
      );
    case 'lottie':
      if (!LottieView) {
        return <MarkerPlaceholder fallback={{ color: demo.accent }} size={36} />;
      }
      return (
        <View style={[styles.lottieBubble, { borderColor: demo.accent }]}>
          <LottieView
            autoPlay
            loop
            source={DEMO_LOTTIE}
            style={styles.lottie}
          />
        </View>
      );
    case 'view':
      return (
        <View style={[styles.viewBubble, { backgroundColor: demo.accent }]}>
          <Text style={styles.viewBubbleText} numberOfLines={1}>
            {demo.name}
          </Text>
          {demo.badge ? (
            <View style={styles.viewBubbleBadge}>
              <Text style={styles.viewBubbleBadgeText}>{demo.badge}</Text>
            </View>
          ) : null}
        </View>
      );
  }
}

function ClusterBubble({ cluster }: { cluster: Cluster }) {
  if (cluster.pointCount === 1) {
    const demo = cluster.markers[0].data as Demo | undefined;
    if (!demo) return <MarkerPlaceholder />;
    return <DemoMarker demo={demo} />;
  }
  return (
    <View style={styles.cluster}>
      <Text style={styles.clusterCount}>{cluster.pointCount}</Text>
      <Text style={styles.clusterLabel}>spots</Text>
    </View>
  );
}

export default function AllMarkersScreen() {
  const mapRef = useRef<MapViewMethods>(null);
  useMapTabLifecycle(mapRef);
  const demos = useMemo(buildDemos, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider="google"
        initialRegion={{
          latitude: 37.7749,
          longitude: -122.4194,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        clusterConfig={{
          enabled: true,
          radius: 64,
          // The first marker stays as a singleton no matter the zoom — handy
          // for "you are here" pins and pinned content.
          ignoreClusterIds: ['demo-0'],
          renderCluster: c => <ClusterBubble cluster={c} />,
        }}
      >
        {demos.map(d => (
          <Marker
            key={d.id}
            identifier={d.id}
            coordinate={d.coordinate}
            title={d.name}
            data={d}
            // Branded fallback — what the user sees while the bitmap loads
            // (or if the load fails). NEVER the default Google pin.
            fallback={{
              color: d.accent,
              initial: d.name.charAt(0),
            }}
          />
        ))}
      </MapView>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>All marker types</Text>
        <Text style={styles.legendText}>
          static · gif · lottie · custom view · clustered + pinned · 24 markers
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  map: { flex: 1 },

  bubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    backgroundColor: '#0d1117',
    padding: 1.5,
  },
  bubbleImage: { width: '100%', height: '100%', borderRadius: 17 },

  lottieBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottie: { width: 36, height: 36 },

  viewBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    paddingRight: 24,
    borderRadius: 16,
    minHeight: 30,
  },
  viewBubbleText: {
    color: '#0d1117',
    fontWeight: '700',
    fontSize: 12,
    maxWidth: 110,
  },
  viewBubbleBadge: {
    position: 'absolute',
    right: 3,
    top: 3,
    bottom: 3,
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewBubbleBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },

  cluster: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(13,17,23,0.92)',
    borderWidth: 2,
    borderColor: '#7ee787',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clusterCount: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  clusterLabel: { color: '#8b949e', fontSize: 10, marginTop: 1 },

  legend: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(13,17,23,0.92)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  legendTitle: { color: '#e7ecf2', fontWeight: '700', marginBottom: 2 },
  legendText: { color: '#8b949e', fontSize: 12 },
});
