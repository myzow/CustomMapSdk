/**
 * OverlaySyncScreen — focused test bed for the native-synced overlay
 * architecture (Uber / Life360 / Lyft model).
 *
 * What this screen exercises:
 *
 *  1. Live driver tracking — 5 markers whose coordinates animate every
 *     500ms via setInterval. Native re-projects the new lat/lng on the
 *     next camera frame so the overlay tracks both the data updates
 *     AND the map's own pan/zoom simultaneously.
 *
 *  2. Continuous animations — every marker plays a different live
 *     animation (Animated.View pulse, ActivityIndicator, Lottie if
 *     linked, rotating arrow). All animations must keep running
 *     smoothly during pan/zoom — that's the entire point of the
 *     overlay architecture vs the bitmap-pump approach.
 *
 *  3. Touch propagation — each overlay marker has its own onPress;
 *     tapping empty space between markers must still pan the map
 *     (pointerEvents="box-none" on the overlay layer).
 *
 *  4. Clustering compatibility — there's a dense cluster of 12 nearby
 *     markers at the bottom that exercises the cluster-bubble path on
 *     the overlay pipeline.
 *
 *  5. Pixel-perfect sync — during fast pinch-zoom and quick pan the
 *     marker must remain pinned to its geographic coordinate, not lag
 *     behind. This is the "Uber/Life360 quality" the user asked for.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  AdvancedMarker,
  useMapTabLifecycle,
  type MapViewMethods,
} from 'rn-custom-map-sdk';

// Lottie is optional — host apps that haven't linked it fall back to
// an Animated.View pulse so this screen works in any environment.
let LottieView: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  LottieView = require('lottie-react-native').default;
} catch {
  LottieView = null;
}

const SF_CENTER = { latitude: 37.7749, longitude: -122.4194 };

// ---------------------------------------------------------------------------
// Live "driver" data — 5 cabs that wander every 500ms
// ---------------------------------------------------------------------------
type Driver = {
  id: string;
  label: string;
  color: string;
  kind: 'pulse' | 'spinner' | 'lottie' | 'rotate' | 'avatar';
  coordinate: { latitude: number; longitude: number };
};

const INITIAL_DRIVERS: Driver[] = [
  { id: 'd-1', label: 'Uber 4231', color: '#7ee787', kind: 'pulse',
    coordinate: { latitude: 37.7799, longitude: -122.4194 } },
  { id: 'd-2', label: 'Lyft 9087', color: '#ff7b72', kind: 'spinner',
    coordinate: { latitude: 37.7720, longitude: -122.4250 } },
  { id: 'd-3', label: 'Driver C', color: '#79c0ff', kind: 'lottie',
    coordinate: { latitude: 37.7770, longitude: -122.4120 } },
  { id: 'd-4', label: 'Driver D', color: '#d2a8ff', kind: 'rotate',
    coordinate: { latitude: 37.7700, longitude: -122.4140 } },
  { id: 'd-5', label: 'Driver E', color: '#f0883e', kind: 'avatar',
    coordinate: { latitude: 37.7755, longitude: -122.4230 } },
];

// 12-marker dense cluster — exercises clustering on the overlay pipeline.
const CLUSTER_BASE = { latitude: 37.7600, longitude: -122.4180 };
const CLUSTER_DRIVERS: Driver[] = Array.from({ length: 12 }, (_, i) => ({
  id: `c-${i}`,
  label: `Pin ${i + 1}`,
  color: i % 2 ? '#7ee787' : '#79c0ff',
  kind: i % 3 === 0 ? 'pulse' : 'avatar',
  coordinate: {
    latitude: CLUSTER_BASE.latitude + (Math.random() - 0.5) * 0.006,
    longitude: CLUSTER_BASE.longitude + (Math.random() - 0.5) * 0.006,
  },
}));

// ---------------------------------------------------------------------------
// Per-kind marker view (always-animating — proves the overlay layer
// keeps live animations playing rather than freezing them as bitmaps)
// ---------------------------------------------------------------------------
function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  const pulseScale = scale.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const pulseOpacity = scale.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View style={styles.markerWrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          { backgroundColor: color, transform: [{ scale: pulseScale }], opacity: pulseOpacity },
        ]}
      />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

function SpinnerMarker({ color }: { color: string }) {
  return (
    <View style={[styles.markerWrap, styles.spinnerCard, { borderColor: color }]}>
      <ActivityIndicator size="small" color={color} />
    </View>
  );
}

// Tiny inline Lottie — a bouncing dot. Inline so this screen has no
// external asset dependency; if the host hasn't linked lottie-react-native
// we degrade gracefully to the Animated.View pulse.
const INLINE_LOTTIE = {
  v: '5.7.4', fr: 30, ip: 0, op: 60, w: 60, h: 60, nm: 'bounce', ddd: 0,
  assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: 'dot', sr: 1,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
      p: { a: 1, k: [
        { i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 }, t: 0, s: [30, 20] },
        { i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 }, t: 30, s: [30, 40] },
        { t: 60, s: [30, 20] },
      ]},
      a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
    },
    shapes: [{
      ty: 'gr', it: [
        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [16, 16] } },
        { ty: 'fl', c: { a: 0, k: [0.498, 0.906, 0.529, 1] }, o: { a: 0, k: 100 } },
        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ],
    }],
    ip: 0, op: 60, st: 0, bm: 0,
  }],
};

function LottieMarker({ color }: { color: string }) {
  if (!LottieView) return <PulseDot color={color} />;
  return (
    <View style={styles.lottieWrap}>
      <LottieView autoPlay loop style={{ width: 56, height: 56 }} source={INLINE_LOTTIE} />
    </View>
  );
}

function RotatingArrow({ color }: { color: string }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      style={[styles.arrow, { borderBottomColor: color, transform: [{ rotate: spin }] }]}
    />
  );
}

function AvatarPin({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.avatarPin, { borderColor: color }]}>
      <Text style={[styles.avatarText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MarkerContent({ kind, color, label }: {
  kind: Driver['kind']; color: string; label: string;
}) {
  switch (kind) {
    case 'pulse': return <PulseDot color={color} />;
    case 'spinner': return <SpinnerMarker color={color} />;
    case 'lottie': return <LottieMarker color={color} />;
    case 'rotate': return <RotatingArrow color={color} />;
    case 'avatar': default: return <AvatarPin label={label} color={color} />;
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function OverlaySyncScreen() {
  const mapRef = useRef<MapViewMethods>(null);
  useMapTabLifecycle(mapRef);

  // Mutable driver coordinates — re-rendered every 500ms so the overlay
  // layer must re-emit the new lat/lng to native. Native then re-projects
  // on the next camera frame.
  const [drivers, setDrivers] = useState<Driver[]>(INITIAL_DRIVERS);
  const [tickEnabled, setTickEnabled] = useState(true);

  useEffect(() => {
    if (!tickEnabled) return;
    const interval = setInterval(() => {
      setDrivers(prev =>
        prev.map(d => ({
          ...d,
          coordinate: {
            latitude: d.coordinate.latitude + (Math.random() - 0.5) * 0.0006,
            longitude: d.coordinate.longitude + (Math.random() - 0.5) * 0.0006,
          },
        })),
      );
    }, 500);
    return () => clearInterval(interval);
  }, [tickEnabled]);

  const allDrivers = useMemo(
    () => [...drivers, ...CLUSTER_DRIVERS],
    [drivers],
  );

  const handleMarkerPress = useCallback((d: Driver) => {
    Alert.alert('Marker pressed', `${d.label}\n${d.coordinate.latitude.toFixed(4)}, ${d.coordinate.longitude.toFixed(4)}`);
  }, []);

  /**
   * Wrapped-component pattern — exercises the Context-based
   * AdvancedMarker registration. The map's child walker can't see
   * inside this functional component, but the AdvancedMarker inside
   * still registers itself with the parent MapView via context.
   *
   * Both this and the inline pattern (below) must render markers
   * correctly.
   */
  const WrappedPin = useCallback(
    ({ driver }: { driver: Driver }) => (
      <AdvancedMarker
        identifier={`wrapped-${driver.id}`}
        coordinate={driver.coordinate}
        data={driver}
        title={`(wrapped) ${driver.label}`}
        onPress={() => handleMarkerPress(driver)}
      >
        <MarkerContent kind={driver.kind} color={driver.color} label={driver.label} />
      </AdvancedMarker>
    ),
    [handleMarkerPress],
  );

  const recenter = useCallback(() => {
    mapRef.current?.animateToRegion(
      {
        latitude: SF_CENTER.latitude,
        longitude: SF_CENTER.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      },
      { duration: 500 },
    );
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Overlay Sync + HOC Test</Text>
        <Text style={styles.bannerSub}>
          5 inline drivers + 2 wrapped-in-HOC drivers + 12-pin cluster.
          Both patterns must render and stay pinned to the map at 60fps.
        </Text>
      </View>

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider="google"
        initialRegion={{
          latitude: SF_CENTER.latitude,
          longitude: SF_CENTER.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        clusterConfig={{ enabled: true, radius: 60 }}
      >
        {/* Inline pattern: AdvancedMarker as a direct child of MapView */}
        {allDrivers.map(d => (
          <AdvancedMarker
            key={d.id}
            identifier={d.id}
            coordinate={d.coordinate}
            data={d}
            title={d.label}
            onPress={() => handleMarkerPress(d)}
          >
            <MarkerContent kind={d.kind} color={d.color} label={d.label} />
          </AdvancedMarker>
        ))}

        {/*
          Wrapped pattern: an AdvancedMarker nested inside a custom
          component. The map's child walker can't see inside WrappedPin
          (it's a functional component), but AdvancedMarker registers
          via React Context and the map renders it correctly.
        */}
        {drivers.slice(0, 2).map(d => (
          <WrappedPin
            key={`w-${d.id}`}
            driver={{
              ...d,
              // Offset slightly so the wrapped pins don't overlap the
              // inline ones — visually clear that both are rendered.
              coordinate: {
                latitude: d.coordinate.latitude + 0.005,
                longitude: d.coordinate.longitude,
              },
            }}
          />
        ))}
      </MapView>

      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          onPress={() => setTickEnabled(t => !t)}
          style={[
            styles.controlBtn,
            { backgroundColor: tickEnabled ? '#7ee787' : '#1f6feb' },
          ]}
          testID="overlay-sync-toggle-tick-btn"
        >
          <Text style={styles.controlText}>
            {tickEnabled ? 'Pause Live Movement' : 'Resume Live Movement'}
          </Text>
        </Pressable>
        <Pressable
          onPress={recenter}
          style={[styles.controlBtn, { backgroundColor: '#1f242b' }]}
          testID="overlay-sync-recenter-btn"
        >
          <Text style={styles.controlText}>Recenter</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(13,17,23,0.88)',
    borderColor: '#1f242b',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bannerTitle: { color: '#7ee787', fontWeight: '700', fontSize: 14 },
  bannerSub: { color: '#c9d1d9', fontSize: 11, marginTop: 4, lineHeight: 15 },

  controls: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: {
    color: '#0d1117',
    fontWeight: '700',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Marker visuals -------------------------------------------------------
  markerWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#0d1117',
  },
  spinnerCard: {
    backgroundColor: 'rgba(13,17,23,0.92)',
    borderWidth: 1.5,
    borderRadius: 18,
    width: 36,
    height: 36,
  },
  lottieWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  avatarPin: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#0d1117',
    borderWidth: 1.5,
    borderRadius: 12,
  },
  avatarText: {
    fontSize: 10,
    fontWeight: '700',
    maxWidth: 80,
  },
});
