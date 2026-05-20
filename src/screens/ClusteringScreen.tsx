import React, { useMemo, useRef } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, {
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
  // Show up to 3 avatars from the members; userData carries the image.
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
        initialRegion={{
          latitude: 37.7749,
          longitude: -122.4194,
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
            // Tip: you can zoom in on tap with mapRef.current?.animateToRegion(...)
            // using cluster.coordinate as the new center.
          },
        }}
      >
        {places.map(place => (
          <Marker
            key={place.id}
            identifier={place.id}
            coordinate={place.coordinate}
            title={place.name}
            // The line that powers everything: arbitrary payload that
            // travels with the marker into Cluster.markers[i].data.
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
      </MapView>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Clustering demo</Text>
        <Text style={styles.legendText}>
          {places.length} markers · pinch to zoom · tap clusters & singletons
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
