import React, { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  AdvancedMarker,
  Marker,
  useMapTabLifecycle,
  type Cluster,
  type MapViewMethods,
} from 'rn-custom-map-sdk';

/**
 * Sample dataset — 35 "places" scattered around the Bay Area. Each item
 * carries an image + display name + category, which travel along on the
 * marker.data prop, surface inside Cluster.markers[i].data, and are picked
 * up by renderCluster() to draw a stacked-avatar bubble.
 */
type Place = {
  id: string;
  name: string;
  category: 'food' | 'coffee' | 'park' | 'museum';
  avatar: string;
  coordinate: { latitude: number; longitude: number };
};

const AVATARS = [
  'https://i.pravatar.cc/100?img=12',
  'https://i.pravatar.cc/100?img=23',
  'https://i.pravatar.cc/100?img=34',
  'https://i.pravatar.cc/100?img=45',
  'https://i.pravatar.cc/100?img=56',
  'https://i.pravatar.cc/100?img=67',
  'https://i.pravatar.cc/100?img=8',
  'https://i.pravatar.cc/100?img=15',
];

const CATEGORY_COLORS: Record<Place['category'], string> = {
  food: '#ff7b72',
  coffee: '#d2a8ff',
  park: '#7ee787',
  museum: '#79c0ff',
};

function buildPlaces(): Place[] {
  // Deterministic pseudo-random for stable demo positions.
  const base = { lat: 37.7749, lng: -122.4194 };
  const cats: Place['category'][] = ['food', 'coffee', 'park', 'museum'];
  const out: Place[] = [];
  for (let i = 0; i < 35; i++) {
    const angle = (i * 137.5 * Math.PI) / 180;
    const distance = 0.005 + (i % 11) * 0.004;
    out.push({
      id: `place-${i}`,
      name: `Spot ${i + 1}`,
      category: cats[i % cats.length],
      avatar: AVATARS[i % AVATARS.length],
      coordinate: {
        latitude: base.lat + Math.sin(angle) * distance,
        longitude: base.lng + Math.cos(angle) * distance,
      },
    });
  }
  return out;
}

// ---- Advanced marker samples (positioned offset from the main cluster) ----

type AdvancedSample = {
  id: string;
  variant: 'avatar' | 'branded' | 'pulse';
  coordinate: { latitude: number; longitude: number };
  label: string;
  avatar?: string;
  accent: string;
  icon?: string;
};

const ADVANCED_SAMPLES: AdvancedSample[] = [
  {
    id: 'adv-avatar-1',
    variant: 'avatar',
    coordinate: { latitude: 37.795, longitude: -122.412 },
    label: 'Maya',
    avatar: 'https://i.pravatar.cc/120?img=47',
    accent: '#7ee787',
  },
  {
    id: 'adv-avatar-2',
    variant: 'avatar',
    coordinate: { latitude: 37.792, longitude: -122.398 },
    label: 'Alex',
    avatar: 'https://i.pravatar.cc/120?img=68',
    accent: '#79c0ff',
  },
  {
    id: 'adv-branded-1',
    variant: 'branded',
    coordinate: { latitude: 37.785, longitude: -122.4 },
    label: 'Blue Bottle',
    icon: '☕',
    accent: '#d2a8ff',
  },
  {
    id: 'adv-branded-2',
    variant: 'branded',
    coordinate: { latitude: 37.778, longitude: -122.41 },
    label: 'Ferry Building',
    icon: '🏛',
    accent: '#ff7b72',
  },
  {
    id: 'adv-pulse-1',
    variant: 'pulse',
    coordinate: { latitude: 37.787, longitude: -122.422 },
    label: 'Live',
    accent: '#7ee787',
  },
];

// ---- Cluster renderers ----

function ClusterBubble({ cluster }: { cluster: Cluster }) {
  // pointCount === 1 → singleton marker. Render the place itself.
  if (cluster.pointCount === 1) {
    const place = cluster.markers[0].data as Place | undefined;
    if (!place) {
      return (
        <View style={styles.singletonFallback}>
          <Text style={styles.singletonFallbackText}>•</Text>
        </View>
      );
    }
    return (
      <View
        style={[
          styles.singleton,
          { borderColor: CATEGORY_COLORS[place.category] },
        ]}
      >
        <Image source={{ uri: place.avatar }} style={styles.singletonAvatar} />
      </View>
    );
  }

  // Multi-point cluster → stacked avatars + count badge.
  const previews = cluster.markers.slice(0, 3);
  return (
    <View style={styles.cluster}>
      <View style={styles.clusterStack}>
        {previews.map((m, idx) => {
          const place = m.data as Place | undefined;
          return (
            <Image
              key={m.id}
              source={{ uri: place?.avatar ?? AVATARS[0] }}
              style={[
                styles.clusterAvatar,
                {
                  left: idx * 14,
                  zIndex: previews.length - idx,
                  borderColor: place
                    ? CATEGORY_COLORS[place.category]
                    : '#1f6feb',
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.clusterCountBadge}>
        <Text style={styles.clusterCountText}>{cluster.pointCount}</Text>
      </View>
    </View>
  );
}

// ---- Advanced-marker child views ----

/**
 * Live-pulsing dot rendered as Animated.View. The native side rasterizes
 * the View once per layout signature, so the animation itself runs in
 * React; the marker icon updates only when the content actually changes
 * (which for a static-size pulse is one-time on mount).
 */
function PulseMarker({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.4,
            duration: 1100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.9,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <View style={styles.pulseContainer}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            backgroundColor: color,
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

function AdvancedSampleMarker({ sample }: { sample: AdvancedSample }) {
  switch (sample.variant) {
    case 'avatar':
      return (
        <View style={[styles.advAvatar, { borderColor: sample.accent }]}>
          <Image
            source={{ uri: sample.avatar }}
            style={styles.advAvatarImage}
          />
          <View
            style={[styles.advAvatarDot, { backgroundColor: sample.accent }]}
          />
        </View>
      );
    case 'branded':
      return (
        <View style={[styles.advBranded, { borderColor: sample.accent }]}>
          <Text style={styles.advBrandedIcon}>{sample.icon}</Text>
          <Text style={styles.advBrandedLabel} numberOfLines={1}>
            {sample.label}
          </Text>
        </View>
      );
    case 'pulse':
      return <PulseMarker color={sample.accent} />;
  }
}

// ---- Screen ----

export default function ClusteringScreen() {
  const mapRef = useRef<MapViewMethods>(null);
  useMapTabLifecycle(mapRef);

  const places = useMemo(buildPlaces, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider="google"
        // mapId is required for Advanced Markers. The SDK defaults to
        // DEMO_MAP_ID for development; pass your own in production.
        mapId="DEMO_MAP_ID"
        initialRegion={{
          latitude: 37.7849,
          longitude: -122.41,
          latitudeDelta: 0.12,
          longitudeDelta: 0.12,
        }}
        clusterConfig={{
          enabled: true,
          radius: 70,
          // Two "anchor" places never cluster — they stay as ordinary markers.
          ignoreClusterIds: ['place-0', 'place-1'],
          renderCluster: cluster => <ClusterBubble cluster={cluster} />,
          onClusterPress: cluster => {
            if (cluster.pointCount === 1) {
              const p = cluster.markers[0].data as Place | undefined;
              Alert.alert(
                p?.name ?? 'Place',
                `category: ${p?.category}\nid: ${cluster.markerIds[0]}`,
              );
              return;
            }
            const names = cluster.markers
              .map(m => (m.data as Place | undefined)?.name)
              .filter(Boolean)
              .slice(0, 5)
              .join(', ');
            Alert.alert(
              `${cluster.pointCount} places`,
              `${names}${cluster.pointCount > 5 ? ', …' : ''}`,
            );
          },
        }}
      >
        {places.map(place => (
          <Marker
            key={place.id}
            identifier={place.id}
            coordinate={place.coordinate}
            title={place.name}
            data={place}
          >
            <View
              style={{
                borderColor: 'white',
                borderWidth: 1,
                borderRadius: 10,
                width: 50,
                height: 50,
                padding: 3,
              }}
            >
              <Image
                source={{ uri: place.avatar }}
                style={{ width: '100%', height: '100%', borderRadius: 10 }}
              />
            </View>
          </Marker>
        ))}

        {/*
          AdvancedMarker samples — these render via Google Maps' Advanced
          Markers pipeline (Android: AdvancedMarkerOptions on a map with a
          mapId; iOS: GMSAdvancedMarker). The React children below are
          rasterized to a Bitmap/UIImage on the native side and used as
          the marker's icon — the recommended high-performance path from
          the Google Maps Platform blog.
        */}
        {ADVANCED_SAMPLES.map(sample => (
          <AdvancedMarker
            key={sample.id}
            identifier={sample.id}
            coordinate={sample.coordinate}
            title={sample.label}
            data={sample}
            onPress={() => {
              Alert.alert(
                'AdvancedMarker',
                `${sample.label} (${sample.variant})`,
              );
            }}
          >
            <AdvancedSampleMarker sample={sample} />
          </AdvancedMarker>
        ))}
      </MapView>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Clustering + Advanced Markers</Text>
        <Text style={styles.legendText}>
          {places.length} clustered · {ADVANCED_SAMPLES.length} advanced
          (avatar · branded · pulse)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  map: { flex: 1 },

  // Singleton (cluster of 1)
  singleton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: '#0d1117',
    padding: 1.5,
  },
  singletonAvatar: { width: '100%', height: '100%', borderRadius: 17 },
  singletonFallback: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1f6feb',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  singletonFallbackText: { color: '#fff', fontWeight: '700' },

  // Multi-point cluster
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,17,23,0.92)',
    paddingVertical: 4,
    paddingHorizontal: 6,
    paddingRight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  clusterStack: {
    width: 14 * 2 + 28,
    height: 28,
  },
  clusterAvatar: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: '#1f242b',
  },
  clusterCountBadge: {
    position: 'absolute',
    right: 4,
    top: 4,
    bottom: 4,
    minWidth: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#1f6feb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clusterCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Advanced marker — avatar
  advAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    backgroundColor: '#0d1117',
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  advAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
  },
  advAvatarDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#0d1117',
  },

  // Advanced marker — branded (icon + text)
  advBranded: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 2,
  },
  advBrandedIcon: {
    color: '#fff',
    fontSize: 16,
    marginRight: 6,
  },
  advBrandedLabel: {
    color: '#e7ecf2',
    fontWeight: '700',
    fontSize: 12,
    maxWidth: 110,
  },

  // Advanced marker — pulse (Animated.View)
  pulseContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  pulseDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#0d1117',
  },

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
